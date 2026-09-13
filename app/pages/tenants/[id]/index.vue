<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { formatDate, formatShortDate, money, yearsSince } from '~/utils/format'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/** Tenant Profile — the resident record: rent, deposit, support and care. */
const route = useRoute()
const tenantId = computed(() => route.params.id as Id<'tenants'>)

const { data: tenant, isLoading } = useConvexQuery(api.tenants.get, () => ({
  tenantId: tenantId.value,
}))

usePageHeader(() => ({
  eyebrow: tenant.value ? `${tenant.value.buildingName} · Room ${tenant.value.room}` : '',
  title: tenant.value?.name ?? 'Tenant',
}))

const depositShort = computed(() =>
  tenant.value ? tenant.value.depositHeldCents < tenant.value.depositRequiredCents : false,
)

const depositPct = computed(() => {
  if (!tenant.value || tenant.value.depositRequiredCents === 0) return 0
  return Math.min(
    100,
    (tenant.value.depositHeldCents / tenant.value.depositRequiredCents) * 100,
  )
})

const DESCRIPTION: Record<string, string> = {
  charge: 'Rent charge',
  payment: 'Rent received',
  credit: 'Credit applied',
}

const METHOD: Record<string, string> = {
  cheque: 'Cheque',
  cash: 'Cash',
  eft: 'Direct deposit',
  'money-order': 'Money order',
}

const { me, can, denied } = useMe()

const { data: profile } = useConvexQuery(api.profile.get, () => ({
  tenantId: tenantId.value,
}))
const { data: shiftNotes } = useConvexQuery(api.profile.shiftNotes, () => ({
  tenantId: tenantId.value,
}))
const { data: overnightGuests } = useConvexQuery(api.visitors.overnightFor, () => ({
  tenantId: tenantId.value,
  now: Date.now(),
  tzOffsetMinutes: new Date().getTimezoneOffset(),
}))

/** `[0,6]` → `Weekends`. Same vocabulary as the visitor desk. */
function overnightDays(days: number[]): string {
  const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  if (!days.length || days.length === 7) return 'any night'
  if (days.length === 2 && days.includes(0) && days.includes(6)) return 'weekends'
  return days.map((d) => SHORT[d]!).join(', ')
}

const { mutate: generateUploadUrl } = useConvexMutation(api.profile.generatePhotoUploadUrl)
const { mutate: setPhoto } = useConvexMutation(api.profile.setPhoto)
const { mutate: removePhoto } = useConvexMutation(api.profile.removePhoto)
const { mutate: removeContact } = useConvexMutation(api.profile.removeContact)

const canSeeSin = computed(() => can('money') || can('config'))
const sinRevealed = ref(false)
const { data: fullSin } = useConvexQuery(api.profile.revealSin, () =>
  sinRevealed.value && canSeeSin.value ? { tenantId: tenantId.value } : null,
)

/**
 * The record splits three ways. Bio data is what a worker reads before
 * knocking; rent is the account; shift reports are what happened. Keeping them
 * apart means the page opens on the care information rather than on money.
 */
const tab = ref<'bio' | 'rent' | 'shifts'>('bio')

const bioOpen = ref(false)
const contactOpen = ref(false)
const photoInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

const HEALTH_SECTIONS = [
  {
    title: 'Physical health',
    icon: 'user-check',
    items: [
      { key: 'careRxProgram', label: 'On CareRX medication programme' },
      { key: 'mobilityIssues', label: 'Mobility issues' },
      { key: 'developmentalDisabilities', label: 'Developmental disabilities' },
      { key: 'physicalDisabilities', label: 'Physical disabilities' },
      { key: 'hivAids', label: 'HIV / AIDS' },
      { key: 'dnrOrder', label: 'Valid DNR order' },
    ],
  },
  {
    title: 'Mental health',
    icon: 'heart',
    items: [
      { key: 'schizophrenia', label: 'Schizophrenia' },
      { key: 'receivesImShot', label: 'Receives IM shot' },
    ],
  },
  {
    title: 'Substance use',
    icon: 'pill',
    items: [
      { key: 'substanceUse', label: 'Substance use' },
      { key: 'overdoseAlert', label: 'Overdose alert' },
      { key: 'onSubstanceTreatment', label: 'On substance-use treatment' },
    ],
  },
] as const

const HEALTH_DETAILS = [
  { key: 'conditions', label: 'Medical conditions' },
  { key: 'allergies', label: 'Allergies' },
  { key: 'medications', label: 'Medications' },
  { key: 'mobilityAids', label: 'Mobility aids' },
  { key: 'careNotes', label: 'Notes for responders' },
] as const

const INTAKE_ROWS = [
  { key: 'sourceOfIncome', label: 'Source of income' },
  { key: 'employmentType', label: 'Employment type' },
  { key: 'mhrOffice', label: 'MHR office' },
  { key: 'gaNumber', label: 'GA number' },
  { key: 'housingNeeds', label: 'Housing needs' },
  { key: 'subsidyInformation', label: 'Subsidy information' },
] as const

const DOCUMENT_ROWS = [
  { key: 'intentToRent', label: 'Intent to rent given' },
  { key: 'signedTenancyAgreement', label: 'Signed tenancy agreement' },
  { key: 'covRoomRegistration', label: 'COV room registration' },
  { key: 'releaseOfInformation', label: 'Release of information signed' },
] as const

/** yes / no / not recorded — a blank must never read as a "no". */
function tri(value: unknown) {
  if (value === true) return { label: 'Yes', class: 'text-[var(--rose-600)] font-bold' }
  if (value === false) return { label: 'No', class: 'text-[var(--text-body)]' }
  return { label: 'Not recorded', class: 'text-[var(--text-subtle)]' }
}

/** The alerts a responder acts on first, mirrored from the printed sheet. */
const responderAlerts = computed(() => {
  const health = profile.value?.health
  if (!health) return []
  const out: string[] = []
  if (health.dnrOrder) out.push('Valid DNR order on file')
  if (health.overdoseAlert) out.push('Overdose alert')
  if (health.mobilityIssues) out.push('Mobility issues — may not reach the door')
  return out
})

async function uploadPhoto(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return

  uploading.value = true
  try {
    const url = await generateUploadUrl({})
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    })
    if (!response.ok) throw new Error('Upload failed.')
    const { storageId } = (await response.json()) as { storageId: Id<'_storage'> }
    await setPhoto({ tenantId: tenantId.value, storageId })
    toast.success('Photo updated')
  } catch (e) {
    toast.error('Could not upload the photo', { description: (e as Error).message })
  } finally {
    uploading.value = false
    if (photoInput.value) photoInput.value.value = ''
  }
}

async function clearPhoto() {
  if (!window.confirm('Remove this resident’s photo?')) return
  try {
    await removePhoto({ tenantId: tenantId.value })
    toast.success('Photo removed')
  } catch (e) {
    toast.error('Could not remove the photo', { description: (e as Error).message })
  }
}

async function deleteContact(contactId: Id<'tenantContacts'>, name: string) {
  if (!window.confirm(`Remove ${name} from this resident's contacts?`)) return
  try {
    await removeContact({ contactId })
    toast.success('Contact removed')
  } catch (e) {
    toast.error('Could not remove the contact', { description: (e as Error).message })
  }
}

const rentDialogOpen = ref(false)
const editOpen = ref(false)
const levelOpen = ref(false)
const needOpen = ref(false)
const depositOpen = ref(false)

/** The shape each dialog expects, built once from the profile record. */
const editTenant = computed(() =>
  tenant.value
    ? {
        _id: tenant.value._id,
        buildingId: tenant.value.buildingId,
        name: tenant.value.name,
        room: tenant.value.room,
        roomId: tenant.value.roomId,
        dob: tenant.value.dob,
        intakeDate: tenant.value.intakeDate,
        status: tenant.value.status,
        monthlyRentCents: tenant.value.monthlyRentCents,
        depositRequiredCents: tenant.value.depositRequiredCents,
        depositHeldCents: tenant.value.depositHeldCents,
        balanceCents: tenant.value.balanceCents,
        notes: tenant.value.notes,
      }
    : null,
)

const levelTenant = computed(() =>
  tenant.value
    ? {
        _id: tenant.value._id,
        name: tenant.value.name,
        room: tenant.value.room,
        supportLevel: tenant.value.supportLevel,
      }
    : null,
)

const depositTenant = computed(() =>
  tenant.value
    ? {
        _id: tenant.value._id,
        name: tenant.value.name,
        room: tenant.value.room,
        heldCents: tenant.value.depositHeldCents,
        requiredCents: tenant.value.depositRequiredCents,
        shortCents: Math.max(
          0,
          tenant.value.depositRequiredCents - tenant.value.depositHeldCents,
        ),
      }
    : null,
)

const dialogTenant = computed(() =>
  tenant.value
    ? {
        _id: tenant.value._id,
        name: tenant.value.name,
        room: tenant.value.room,
        monthlyRentCents: tenant.value.monthlyRentCents,
        balanceCents: tenant.value.balanceCents,
      }
    : null,
)
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- The way back out is the breadcrumb in the shell's second band now; a
         "Back to tenants" link directly under "Dodson Rooms › Tenants" was the
         same door twice. -->
    <TsLoadingState v-if="isLoading" label="Loading resident record…" :rows="6" />

    <template v-else-if="tenant">
      <!--
        Who this is stays on screen while you work through the record.

        The identity and bio used to be a band across the top and a card inside
        the Bio tab, which meant that reading a rent ledger or a shift note put
        the person out of view entirely — the exact moment you most want to be
        reminded who you are reading about. Both now live in one column on the
        right that sticks below the topbar and scrolls inside itself, and it is
        the same card on every tab.
      -->
      <div class="record-layout">
        <aside class="record-summary" aria-label="Resident bio">
          <div class="record-summary__header">
            <div class="shrink-0">
              <div
                v-if="profile?.photoUrl"
                class="size-[66px] overflow-hidden rounded-lg border border-border bg-[var(--surface-sunken)]"
              >
                <img :src="profile.photoUrl" :alt="tenant.name" class="size-full object-cover" >
              </div>
              <DsPersonAvatar
                v-else
                :name="tenant.name"
                size="xl"
                :status="tenant.critical ? 'alert' : 'online'"
              />
              <input
                ref="photoInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="uploadPhoto"
              >
              <div class="mt-1.5 flex justify-center gap-1">
                <button
                  type="button"
                  class="cursor-pointer border-none bg-transparent p-0 text-2xs font-semibold text-muted-foreground hover:text-[var(--text-strong)] disabled:opacity-50"
                  :disabled="!can('tenancy') || uploading"
                  :title="denied('tenancy') ?? 'Upload a photo'"
                  @click="photoInput?.click()"
                >
                  {{ uploading ? 'Uploading…' : profile?.photoUrl ? 'Replace' : 'Add photo' }}
                </button>
                <button
                  v-if="profile?.photoUrl && can('tenancy')"
                  type="button"
                  class="cursor-pointer border-none bg-transparent p-0 text-2xs font-semibold text-muted-foreground hover:text-destructive"
                  @click="clearPhoto"
                >
                  · Remove
                </button>
              </div>
            </div>

            <div class="min-w-0">
              <Badge v-if="tenant.balanceCents > 0" variant="warning" dot>Rent Due</Badge>
              <Badge v-else variant="success" dot>All Clear</Badge>
              <!-- h2: the shell's second band already carries this page's h1. -->
              <h2 class="record-summary__name">{{ tenant.name }}</h2>
              <p class="record-summary__where">
                <span class="mono">Room {{ tenant.room }}</span> · {{ tenant.buildingName }}
              </p>
            </div>
          </div>

          <div class="record-summary__flags">
            <Badge v-if="tenant.critical" variant="rose">
              <DsIcon name="heart-pulse" :size="12" :stroke-width="2.5" />
              Critical Needs
            </Badge>
            <Badge
              v-for="guest in overnightGuests ?? []"
              :key="guest._id"
              variant="violet"
              :title="`Approved to stay ${overnightDays(guest.days)}`"
            >
              <DsIcon name="moon" :size="12" :stroke-width="2.5" />
              {{ guest.name }} · {{ overnightDays(guest.days) }}
            </Badge>
            <DsSupportMeter :level="tenant.supportLevel" size="sm" />
          </div>

          <TsConditionBar v-if="profile" :flags="profile.flags" class="record-summary__conditions" />

          <dl v-if="profile" class="record-summary__fields">
            <div>
              <dt>Preferred name</dt>
              <dd>{{ profile.preferredName ?? 'Not recorded' }}</dd>
            </div>
            <div>
              <dt>Pronouns</dt>
              <dd>{{ profile.pronouns ?? 'Not recorded' }}</dd>
            </div>
            <div>
              <dt>Date of birth</dt>
              <dd>
                {{ formatDate(profile.dob) }}
                <span v-if="profile.dob" class="font-normal text-muted-foreground">
                  ({{ yearsSince(profile.dob) }})
                </span>
              </dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd class="mono">{{ profile.phone ?? 'Not recorded' }}</dd>
            </div>
            <div>
              <dt>Language</dt>
              <dd>{{ profile.languages ?? 'English' }}</dd>
            </div>
            <div>
              <dt>Population group</dt>
              <dd>{{ profile.populationGroup ?? 'Not recorded' }}</dd>
            </div>
            <div>
              <dt>Floor</dt>
              <dd>{{ profile.floor ?? 'Not recorded' }}</dd>
            </div>
            <div>
              <dt>Resident since</dt>
              <dd>{{ formatDate(tenant.intakeDate) }}</dd>
            </div>
            <div>
              <dt>SIN</dt>
              <dd v-if="!profile.sin" class="text-muted-foreground">Not recorded</dd>
              <dd v-else-if="!canSeeSin" class="text-muted-foreground">Restricted</dd>
              <dd v-else class="flex flex-wrap items-center gap-2">
                <span class="mono">
                  {{ sinRevealed && fullSin ? fullSin : profile.sin.masked }}
                </span>
                <button
                  type="button"
                  class="cursor-pointer border-none bg-transparent p-0 text-2xs font-semibold text-muted-foreground hover:text-[var(--text-strong)]"
                  @click="sinRevealed = !sinRevealed"
                >
                  {{ sinRevealed ? 'Hide' : 'Reveal' }}
                </button>
              </dd>
            </div>
          </dl>

          <div v-if="profile?.writeUp" class="record-summary__writeup">
            <span class="eyebrow">Write-up</span>
            <p>{{ profile.writeUp }}</p>
          </div>

          <div class="record-summary__actions">
            <Button
              variant="secondary"
              size="sm"
              :disabled="!can('tenancy')"
              :title="denied('tenancy') ?? 'Edit the record'"
              @click="bioOpen = true"
            >
              <DsIcon name="pencil" :size="15" />
              Edit information
            </Button>
            <Button
              variant="secondary"
              size="sm"
              title="Print the responder sheet — no rent, no notes"
              @click="navigateTo(`/tenants/${tenantId}/print`)"
            >
              <DsIcon name="printer" :size="15" />
              Responder sheet
            </Button>
          </div>
        </aside>

        <div class="record-main">
          <!--
            Two even columns on a phone with the primary action spanning both;
            a plain wrapping row once there is width for it.
          -->
          <div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Button
              variant="secondary"
              :disabled="!can('care')"
              :title="denied('care') ?? 'Change support level'"
              @click="levelOpen = true"
            >
              <DsIcon name="traffic-cone" :size="17" />
              Support level
            </Button>
            <Button
              variant="secondary"
              :disabled="!can('care')"
              :title="denied('care') ?? 'Open a case'"
              @click="needOpen = true"
            >
              <DsIcon name="heart-pulse" :size="17" />
              Open a case
            </Button>
            <Button
              variant="secondary"
              :disabled="!can('money')"
              :title="denied('money') ?? 'Adjust the deposit'"
              @click="depositOpen = true"
            >
              <DsIcon name="lock" :size="17" />
              Deposit
            </Button>
            <Button
              variant="secondary"
              :disabled="!can('tenancy')"
              :title="denied('tenancy') ?? 'Edit the record, move rooms, end the tenancy'"
              @click="editOpen = true"
            >
              <DsIcon name="pencil" :size="17" />
              Edit
            </Button>
            <Button
              variant="primary"
              class="col-span-2 sm:col-span-1"
              :disabled="!can('money')"
              :title="denied('money') ?? 'Receive rent'"
              @click="rentDialogOpen = true"
            >
              <DsIcon name="dollar-sign" :size="17" />
              Receive Rent
            </Button>
          </div>

          <Alert v-if="responderAlerts.length" variant="danger">
            <DsIcon name="alert-octagon" :size="17" :stroke-width="2" />
            <div>
              <AlertTitle>Before entering</AlertTitle>
              <AlertDescription>{{ responderAlerts.join(' · ') }}</AlertDescription>
            </div>
          </Alert>

          <Tabs v-model="tab" class="w-full">
        <TabsList>
          <TabsTrigger value="bio">
            <DsIcon name="user" :size="15" />
            Bio data
          </TabsTrigger>
          <TabsTrigger value="rent">
            <DsIcon name="dollar-sign" :size="15" />
            Rent &amp; deposits
          </TabsTrigger>
          <TabsTrigger value="shifts">
            <DsIcon name="file-text" :size="15" />
            Shift reports
            <span
              v-if="shiftNotes?.length"
              class="tnum rounded-full bg-[var(--slate-200)] px-1.5 text-xs font-bold text-[var(--text-body)]"
            >{{ shiftNotes.length }}</span>
          </TabsTrigger>
        </TabsList>

        <!-- ==================================================== Bio data -->
        <TabsContent value="bio" class="mt-5 flex flex-col gap-5">
          <!--
            Identity and bio fields are not repeated here: they live in the
            summary column on the right, where they stay visible on every tab.
            What is left is everything a worker acts on rather than reads off.

            Critical needs lead. They were the last card on the tab, under
            everything a worker reads at leisure — the wrong end for the one
            thing that changes how you knock on the door.
          -->
            <Card>
              <CardHeader>
                <span class="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-[var(--surface-sunken)] text-muted-foreground">
                  <DsIcon name="heart-pulse" :size="18" />
                </span>
                <div class="flex min-w-0 flex-col gap-px">
                  <span class="eyebrow">Care</span>
                  <CardTitle>Critical needs &amp; case notes</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div v-if="tenant.criticalNeeds.length" class="flex flex-col items-start gap-2.5">
                  <Alert v-for="need in tenant.criticalNeeds" :key="need._id" variant="warning">
                    <DsIcon name="alert-triangle" :size="17" :stroke-width="2" />
                    <div>
                      <AlertTitle>{{ need.summary }}</AlertTitle>
                      <AlertDescription>
                        {{ need.detail }}
                        <template v-if="need.caseManager">
                          Case manager: {{ need.caseManager }}.
                        </template>
                      </AlertDescription>
                    </div>
                  </Alert>
                  <Button variant="soft" size="sm" disabled>
                    <DsIcon name="clipboard-plus" :size="15" />
                    Open case management form
                  </Button>
                </div>
                <div v-else class="flex items-center gap-2.5 text-muted-foreground">
                  <DsIcon name="check-circle-2" :size="18" class="text-[var(--success)]" />
                  No active critical needs on file.
                </div>
              </CardContent>
            </Card>

          <!--
            Two columns of roughly even weight, not a two-up grid. Health is
            three times the height of the contacts card, so as sibling grid
            cells they left a column of empty card beside it.
          -->
          <div v-if="profile" class="grid items-start gap-5 xl:grid-cols-2">
            <div class="flex min-w-0 flex-col gap-5">
              <Card>
                <CardHeader>
                  <span class="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-[var(--rose-50)] text-[var(--rose-600)]">
                    <DsIcon name="heart-pulse" :size="18" />
                  </span>
                  <div class="flex min-w-0 flex-col gap-px">
                    <span class="eyebrow">For responders</span>
                    <CardTitle>Health information</CardTitle>
                  </div>
                  <CardAction>
                    <Button
                      variant="secondary"
                      size="sm"
                      :disabled="!can('care')"
                      :title="denied('care') ?? 'Record health information'"
                      @click="bioOpen = true"
                    >
                      <DsIcon name="pencil" :size="15" />
                      Update
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent class="flex flex-col gap-4">
                  <div v-for="section in HEALTH_SECTIONS" :key="section.title" class="flex flex-col gap-1">
                    <span class="eyebrow">{{ section.title }}</span>
                    <div
                      v-for="item in section.items"
                      :key="item.key"
                      class="flex items-baseline justify-between gap-3 border-b border-[var(--border-subtle)] py-1.5 text-sm last:border-0"
                    >
                      <span class="text-[var(--text-body)]">{{ item.label }}</span>
                      <span :class="tri(profile.health[item.key]).class">
                        {{ tri(profile.health[item.key]).label }}
                      </span>
                    </div>
                  </div>

                  <div class="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-3">
                    <div v-for="detail in HEALTH_DETAILS" :key="detail.key" class="text-sm">
                      <span class="eyebrow">{{ detail.label }}</span>
                      <p class="text-[var(--text-body)]">
                        {{ profile.health[detail.key] || 'Not recorded' }}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

            </div>

            <div class="flex min-w-0 flex-col gap-5">
              <Card>
                <CardHeader>
                  <span class="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-[var(--surface-sunken)] text-muted-foreground">
                    <DsIcon name="user-plus" :size="18" />
                  </span>
                  <div class="flex min-w-0 flex-col gap-px">
                    <span class="eyebrow">Who to call</span>
                    <CardTitle>Next of kin &amp; contacts</CardTitle>
                  </div>
                  <CardAction>
                    <Button
                      variant="secondary"
                      size="icon-sm"
                      aria-label="Add a contact"
                      :disabled="!can('tenancy')"
                      :title="denied('tenancy') ?? 'Add a contact'"
                      @click="contactOpen = true"
                    >
                      <DsIcon name="plus" :size="15" />
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <p v-if="!profile.contacts.length" class="text-base text-muted-foreground">
                    No contacts on file. A resident with nobody to call is worth chasing at the next
                    review.
                  </p>
                  <div
                    v-for="contact in profile.contacts"
                    :key="contact._id"
                    class="flex items-start gap-3 border-b border-[var(--border-subtle)] py-2.5 last:border-0"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="font-semibold text-[var(--text-strong)]">{{ contact.name }}</span>
                        <Badge v-if="contact.isNextOfKin" variant="brand">Next of kin</Badge>
                      </div>
                      <div class="text-sm text-muted-foreground">{{ contact.relationship }}</div>
                      <div v-if="contact.phone" class="mono text-sm font-semibold text-[var(--text-strong)]">
                        {{ contact.phone }}
                      </div>
                      <div v-if="contact.email" class="truncate text-xs text-muted-foreground">
                        {{ contact.email }}
                      </div>
                      <div v-if="contact.note" class="text-xs text-[var(--text-subtle)]">
                        {{ contact.note }}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove contact"
                      :disabled="!can('tenancy')"
                      @click="deleteContact(contact._id, contact.name)"
                    >
                      <DsIcon name="trash" :size="15" />
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <span class="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-[var(--surface-sunken)] text-muted-foreground">
                    <DsIcon name="clipboard-list" :size="18" />
                  </span>
                  <div class="flex min-w-0 flex-col gap-px">
                    <span class="eyebrow">Paperwork</span>
                    <CardTitle>Intake &amp; documents</CardTitle>
                  </div>
                </CardHeader>
                <CardContent class="flex flex-col gap-4">
                  <dl class="flex flex-col gap-1.5">
                    <div
                      v-for="row in INTAKE_ROWS"
                      :key="row.key"
                      class="flex items-baseline justify-between gap-3 border-b border-[var(--border-subtle)] py-1.5 text-sm last:border-0"
                    >
                      <dt class="text-muted-foreground">{{ row.label }}</dt>
                      <dd class="text-right font-semibold text-[var(--text-strong)]">
                        {{ profile.intake[row.key] ?? 'Not entered' }}
                      </dd>
                    </div>
                  </dl>

                  <div class="flex flex-col gap-1.5 border-t border-[var(--border-subtle)] pt-3">
                    <span class="eyebrow">Documents</span>
                    <div
                      v-for="row in DOCUMENT_ROWS"
                      :key="row.key"
                      class="flex items-center justify-between gap-3 text-sm"
                    >
                      <span class="text-[var(--text-body)]">{{ row.label }}</span>
                      <span
                        class="inline-flex items-center gap-1.5 font-semibold"
                        :class="profile.documents[row.key] ? 'text-[var(--success)]' : 'text-[var(--text-subtle)]'"
                      >
                        <DsIcon
                          :name="profile.documents[row.key] ? 'check-circle-2' : 'minus'"
                          :size="14"
                        />
                        {{ profile.documents[row.key] ? 'Yes' : 'No' }}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <!-- ============================================= Rent & deposits -->
        <TabsContent value="rent" class="mt-5 flex flex-col gap-5">
          <Alert v-if="depositShort" variant="danger">
            <DsIcon name="alert-octagon" :size="17" :stroke-width="2" />
            <div>
              <AlertTitle>Security deposit shortfall</AlertTitle>
              <AlertDescription>
                Deposit on file is {{ money(tenant.depositHeldCents) }} of
                {{ money(tenant.depositRequiredCents) }} required —
                {{ money(tenant.depositRequiredCents - tenant.depositHeldCents) }} short.
              </AlertDescription>
            </div>
          </Alert>

            <div class="grid items-start gap-5 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader>
                <span class="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-[var(--surface-sunken)] text-muted-foreground">
                  <DsIcon name="dollar-sign" :size="18" />
                </span>
                <div class="flex min-w-0 flex-col gap-px">
                  <span class="eyebrow">Account</span>
                  <CardTitle>Rent ledger</CardTitle>
                </div>
                <CardAction>
                  <Badge v-if="tenant.balanceCents > 0" variant="danger">
                    Balance {{ money(tenant.balanceCents) }}
                  </Badge>
                  <Badge v-else variant="success">Paid up</Badge>
                </CardAction>
              </CardHeader>

              <CardContent class="p-4">
                <Table dense container-class="rounded-md">
                  <TableHeader>
                    <TableRow>
                      <TableHead class="w-[90px]">Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead class="w-[110px] text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow v-for="entry in tenant.ledger" :key="entry._id">
                      <TableCell>
                        <span class="mono text-xs">{{ formatShortDate(entry.postedAt) }}</span>
                      </TableCell>
                      <TableCell>
                        {{ DESCRIPTION[entry.kind] ?? entry.kind }}
                        <span v-if="entry.method" class="text-muted-foreground">
                          · {{ METHOD[entry.method] ?? entry.method }}
                        </span>
                        <span v-if="entry.reference" class="mono ml-1.5 text-[11px] text-[var(--text-subtle)]">
                          {{ entry.reference }}
                        </span>
                      </TableCell>
                      <TableCell class="tnum text-right font-semibold">
                        <span :class="entry.kind === 'charge' ? 'text-[var(--text-body)]' : 'text-[var(--success)]'">
                          {{ entry.kind === 'charge' ? '−' : '+' }}{{ money(entry.amountCents) }}
                        </span>
                      </TableCell>
                    </TableRow>
                    <TableRow v-if="tenant.ledger.length === 0">
                      <TableCell colspan="3" class="py-8 text-center text-muted-foreground">
                        No ledger entries yet.
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <span class="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-[var(--surface-sunken)] text-muted-foreground">
                  <DsIcon name="info" :size="18" />
                </span>
                <div class="flex min-w-0 flex-col gap-px">
                  <span class="eyebrow">Tenancy</span>
                  <CardTitle>Account summary</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <dl class="grid grid-cols-2 gap-4">
                  <div class="flex flex-col gap-1">
                    <dt class="eyebrow">Monthly rent</dt>
                    <dd class="tnum font-semibold text-[var(--text-strong)]">
                      {{ money(tenant.monthlyRentCents) }}
                    </dd>
                  </div>
                  <div class="flex flex-col gap-1">
                    <dt class="eyebrow">Balance</dt>
                    <dd
                      class="tnum font-semibold"
                      :class="tenant.balanceCents > 0 ? 'text-destructive' : 'text-[var(--text-strong)]'"
                    >
                      {{ money(tenant.balanceCents) }}
                    </dd>
                  </div>
                  <div class="flex flex-col gap-1">
                    <dt class="eyebrow">Years housed</dt>
                    <dd class="tnum font-semibold text-[var(--text-strong)]">
                      {{ yearsSince(tenant.intakeDate) ?? '—' }} yrs
                    </dd>
                  </div>
                  <div class="flex flex-col gap-1">
                    <dt class="eyebrow">Support level</dt>
                    <dd><DsSupportMeter :level="tenant.supportLevel" size="sm" /></dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <span class="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-[var(--surface-sunken)] text-muted-foreground">
                  <DsIcon name="lock" :size="18" />
                </span>
                <div class="flex min-w-0 flex-col gap-px">
                  <span class="eyebrow">Held</span>
                  <CardTitle>Security deposit</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div class="flex flex-wrap items-baseline gap-2">
                  <span
                    class="tnum text-2xl font-bold"
                    :class="depositShort ? 'text-destructive' : 'text-[var(--text-strong)]'"
                  >
                    {{ money(tenant.depositHeldCents) }}
                  </span>
                  <span class="text-base text-muted-foreground">
                    of {{ money(tenant.depositRequiredCents) }} required
                  </span>
                </div>

                <Progress
                  :model-value="depositPct"
                  class="mt-3 h-2 bg-[var(--surface-sunken)]"
                  :class="depositShort ? '[&>div]:bg-destructive' : '[&>div]:bg-[var(--cyan-600)]'"
                />

                <template v-if="tenant.depositEntries.length">
                  <Separator class="my-4" />
                  <ul class="flex flex-col gap-1.5">
                    <li
                      v-for="entry in tenant.depositEntries"
                      :key="entry._id"
                      class="flex justify-between gap-3 text-xs text-muted-foreground"
                    >
                      <span>{{ entry.reason }}</span>
                      <span class="tnum">{{ money(entry.amountCents) }}</span>
                    </li>
                  </ul>
                </template>
              </CardContent>
            </Card>
            </div>
        </TabsContent>

        <!-- ================================================ Shift reports -->
        <TabsContent value="shifts" class="mt-5">
          <Card>
            <CardHeader>
              <span class="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-[var(--indigo-50)] text-[var(--indigo-600)]">
                <DsIcon name="file-text" :size="18" />
              </span>
              <div class="flex min-w-0 flex-col gap-px">
                <span class="eyebrow">From submitted shift reports</span>
                <CardTitle>Shift notes</CardTitle>
              </div>
              <CardAction>
                <Badge variant="neutral">{{ shiftNotes?.length ?? 0 }}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <p v-if="!shiftNotes?.length" class="text-base text-muted-foreground">
                Nothing logged about this resident yet. Incidents and wellness-check notes appear
                here once a shift report is submitted.
              </p>

              <div
                v-for="note in shiftNotes ?? []"
                :key="note._id"
                class="flex gap-3 border-b border-[var(--border-subtle)] py-3 last:border-0"
              >
                <span
                  class="inline-flex size-8 shrink-0 items-center justify-center rounded-md"
                  :class="
                    note.significant
                      ? 'bg-[var(--rose-50)] text-[var(--rose-600)]'
                      : note.kind === 'event'
                        ? 'bg-[var(--amber-50)] text-[var(--amber-700)]'
                        : note.kind === 'interaction'
                          ? 'bg-[var(--teal-50)] text-[var(--teal-700)]'
                          : 'bg-[var(--surface-sunken)] text-muted-foreground'
                  "
                >
                  <DsIcon
                    :name="
                      note.kind === 'interaction'
                        ? 'users'
                        : note.kind === 'event'
                          ? 'alert-triangle'
                          : 'clipboard-check'
                    "
                    :size="16"
                  />
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-sm font-semibold capitalize text-[var(--text-strong)]">
                      {{ note.title }}
                    </span>
                    <Badge v-if="note.significant" variant="danger">Significant</Badge>
                    <Badge v-if="note.cameraReview" variant="violet">Camera review</Badge>
                    <span class="ml-auto text-xs text-muted-foreground">
                      {{ formatShortDate(note.at) }} · <span class="capitalize">{{ note.shift }}</span>
                      <template v-if="note.by"> · {{ note.by }}</template>
                    </span>
                  </div>
                  <p v-if="note.body" class="mt-0.5 text-sm text-[var(--text-body)]">{{ note.body }}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
          </Tabs>
        </div>
      </div>
    </template>

    <DsEmptyState
      v-else
      icon="user"
      title="Resident not found"
      description="This record may have been removed."
    />

    <TsReceiveRentDialog
      :open="rentDialogOpen"
      :tenant="dialogTenant"
      @close="rentDialogOpen = false"
    />

    <TsTenantEditDialog :open="editOpen" :tenant="editTenant" @close="editOpen = false" />

    <TsSupportLevelDialog :open="levelOpen" :tenant="levelTenant" @close="levelOpen = false" />

    <TsAdjustDepositDialog
      :open="depositOpen"
      :tenant="depositTenant"
      @close="depositOpen = false"
    />

    <TsBioEditDialog
      :open="bioOpen"
      :tenant-id="tenantId"
      :profile="profile ?? null"
      :can-see-sin="canSeeSin"
      @close="bioOpen = false"
    />

    <TsContactDialog
      :open="contactOpen"
      :tenant-id="tenantId"
      :name="tenant?.name ?? ''"
      @close="contactOpen = false"
    />

    <TsCriticalNeedDialog
      :open="needOpen"
      :residents="[]"
      :need="null"
      :tenant-id="tenant?._id ?? null"
      @close="needOpen = false"
    />
  </div>
</template>

<style scoped>
/*
  The record is one row: work on the left, the person on the right. The
  summary is written second in the source but placed first in the grid, so a
  narrow screen — where the grid collapses to a column — gets the identity
  before the tabs rather than after them.
*/
.record-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 330px;
  gap: 26px;
  align-items: start;
}

.record-main {
  display: flex;
  flex-direction: column;
  gap: 20px;
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
}

.record-summary {
  grid-column: 2;
  grid-row: 1;
  position: sticky;
  /* Clears the sticky nav, with the page's own top padding under it.
     `--nav-h` is measured by the shell; the topbar height is the fallback for
     the frame before the observer has reported. */
  top: calc(var(--nav-h, var(--topbar-h)) + var(--space-4));
  max-height: calc(100dvh - var(--nav-h, var(--topbar-h)) - var(--space-10));
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface-card);
}

.record-summary__header {
  display: flex;
  align-items: center;
  gap: 17px;
  padding: 22px 20px 18px;
}

.record-summary__name {
  margin: 9px 0 6px;
  font-family: var(--font-display);
  font-size: 25px;
  font-weight: 500;
  line-height: 1.12;
  letter-spacing: -0.7px;
  color: var(--text-strong);
  overflow-wrap: anywhere;
}

.record-summary__where {
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-muted);
}

.record-summary__flags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  margin: 0 20px 12px;
  padding-bottom: 13px;
  border-bottom: 1px solid var(--border);
}

.record-summary__conditions {
  margin: 0 20px 12px;
}

.record-summary__fields {
  padding: 0 20px;
}

.record-summary__fields > div {
  display: flex;
  justify-content: space-between;
  gap: 15px;
  padding: 12px 0;
  font-size: 11px;
  line-height: 1.6;
  border-bottom: 1px solid var(--border-subtle);
}

.record-summary__fields > div:last-child {
  border-bottom: 0;
}

.record-summary__fields dt {
  flex-shrink: 0;
  color: var(--text-muted);
}

.record-summary__fields dd {
  text-align: right;
  font-weight: 600;
  color: var(--text-strong);
  overflow-wrap: anywhere;
}

.record-summary__writeup {
  margin: 4px 20px 0;
  padding-top: 13px;
  border-top: 1px solid var(--border);
}

.record-summary__writeup p {
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-body);
}

.record-summary__actions {
  display: flex;
  gap: 9px;
  padding: 16px 20px 20px;
}

.record-summary__actions > * {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
}

@media (min-width: 1600px) {
  .record-layout {
    grid-template-columns: minmax(0, 1fr) 360px;
    gap: 30px;
  }
}

@media (max-width: 1180px) {
  .record-layout {
    grid-template-columns: minmax(0, 1fr) 290px;
    gap: 20px;
  }
}

/* Under ~1000px there is no room for a second column, so the summary stops
   being a rail and becomes the page's header — in document order, unpinned. */
@media (max-width: 1000px) {
  .record-layout {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  .record-summary {
    position: static;
    max-height: none;
    overflow: visible;
    width: 100%;
  }
}

/* A printed record is read top to bottom on paper; nothing sticks. */
@media print {
  .record-layout {
    display: block;
  }

  .record-summary {
    position: static;
    max-height: none;
    overflow: visible;
  }
}
</style>
