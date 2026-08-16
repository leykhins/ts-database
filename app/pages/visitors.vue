<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { formatDate, formatShortDate } from '~/utils/format'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * The visitor desk.
 *
 * Signing a returning guest in is two taps: find them, say who they are here
 * to see. Registering somebody new is a short form once. Bans and overnight
 * approvals are a manager's call and are read-only for everyone else — but
 * they are *shown* to everyone, because the person on the desk is the one who
 * has to act on them.
 */
const { selected } = useSelectedBuilding()
const { can, denied } = useMe()

const tz = new Date().getTimezoneOffset()
const now = ref(Date.now())
const timer = setInterval(() => (now.value = Date.now()), 60_000)
onScopeDispose(() => clearInterval(timer))

const { data, isLoading } = useConvexQuery(api.visitors.board, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
  now: now.value,
  tzOffsetMinutes: tz,
}))

usePageHeader(() => ({
  eyebrow: data.value?.building.name ?? '',
  title: 'Visitors',
}))

const { mutate: register, pending: registering } = useConvexMutation(api.visitors.register)
const { mutate: signIn, pending: signingIn } = useConvexMutation(api.visitors.signIn)
const { mutate: signOut } = useConvexMutation(api.visitors.signOut)
const { mutate: setBan } = useConvexMutation(api.visitors.setBan)
const { mutate: authorizeOvernight, pending: authorizing } = useConvexMutation(
  api.visitors.authorizeOvernight,
)
const { mutate: revokeOvernight } = useConvexMutation(api.visitors.revokeOvernight)
const { mutate: generateUploadUrl } = useConvexMutation(api.visitors.generatePhotoUploadUrl)
const { mutate: setPhoto } = useConvexMutation(api.visitors.setPhoto)

const WEEKDAYS = [
  { value: 0, short: 'Sun' },
  { value: 1, short: 'Mon' },
  { value: 2, short: 'Tue' },
  { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' },
  { value: 5, short: 'Fri' },
  { value: 6, short: 'Sat' },
]

const tab = ref('desk')
const buildingId = computed(() => selected.value ?? data.value?.building._id ?? null)

/* ------------------------------------------------------------- Sign in -- */
const search = ref('')
const chosenVisitor = ref<string>('')
const chosenResident = ref<string>('')
const overnight = ref(false)
const newVisitorOpen = ref(false)

const matches = computed(() => {
  const all = data.value?.visitors ?? []
  const q = search.value.trim().toLowerCase()
  if (!q) return all.slice(0, 8)
  return all.filter((visitor) => visitor.name.toLowerCase().includes(q)).slice(0, 12)
})

const visitor = computed(
  () => data.value?.visitors.find((v) => v._id === chosenVisitor.value) ?? null,
)

/** Whether tonight's stay is covered — the badge the desk reads before ticking. */
const approvedTonight = computed(() => {
  if (!visitor.value || !chosenResident.value || !data.value) return false
  return data.value.overnightTonight.some(
    (row) => row.visitorId === visitor.value!._id && row.tenantId === chosenResident.value,
  )
})

// Somebody almost always comes for the same resident — offer that first.
watch(chosenVisitor, (id) => {
  const match = data.value?.visitors.find((v) => v._id === id)
  const usual = data.value?.residents.find((r) => r.name === match?.usuallyVisits)
  chosenResident.value = usual?.tenantId ?? ''
  overnight.value = false
})

async function doSignIn() {
  if (!chosenVisitor.value || !chosenResident.value) {
    toast.error('Pick a visitor and who they are here to see')
    return
  }
  try {
    const result = await signIn({
      visitorId: chosenVisitor.value as Id<'visitors'>,
      tenantId: chosenResident.value as Id<'tenants'>,
      overnight: overnight.value,
      now: Date.now(),
      tzOffsetMinutes: tz,
    })
    if (overnight.value && !result.authorized) {
      toast.warning('Signed in — overnight stay is not authorised', {
        description: 'Recorded as unauthorised. A manager needs to approve it.',
      })
    } else {
      toast.success('Signed in')
    }
    chosenVisitor.value = ''
    chosenResident.value = ''
    overnight.value = false
    search.value = ''
  } catch (e) {
    toast.error('Not signed in', { description: (e as Error).message })
  }
}

async function doSignOut(visitId: Id<'visits'>, name: string) {
  try {
    await signOut({ visitId, now: Date.now() })
    toast.success(`${name} signed out`)
  } catch (e) {
    toast.error('Could not sign out', { description: (e as Error).message })
  }
}

/* -------------------------------------------------------- New visitor -- */
const draft = reactive({ name: '', dob: '', idNumber: '', note: '' })
const photoFile = ref<File | null>(null)
const photoInput = ref<HTMLInputElement | null>(null)

async function createVisitor() {
  if (!buildingId.value) return
  try {
    const visitorId = await register({
      buildingId: buildingId.value,
      name: draft.name,
      dob: draft.dob || undefined,
      idNumber: draft.idNumber || undefined,
      note: draft.note || undefined,
    })

    if (photoFile.value) {
      const url = await generateUploadUrl({})
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': photoFile.value.type },
        body: photoFile.value,
      })
      if (response.ok) {
        const { storageId } = (await response.json()) as { storageId: Id<'_storage'> }
        await setPhoto({ visitorId, storageId })
      }
    }

    toast.success(`${draft.name.trim()} registered`, {
      description: 'Next time it is just their name and who they are seeing.',
    })
    chosenVisitor.value = visitorId
    Object.assign(draft, { name: '', dob: '', idNumber: '', note: '' })
    photoFile.value = null
    if (photoInput.value) photoInput.value.value = ''
    newVisitorOpen.value = false
  } catch (e) {
    toast.error('Could not register', { description: (e as Error).message })
  }
}

/* ---------------------------------------------------------------- Bans -- */
async function ban(visitorId: Id<'visitors'>, name: string) {
  const reason = window.prompt(`Why is ${name} banned from this site?`)
  if (!reason) return
  const until = window.prompt('Until when? YYYY-MM-DD, or leave blank for indefinitely.') ?? ''
  try {
    await setBan({
      visitorId,
      banned: true,
      reason,
      until: until.trim() || undefined,
      now: Date.now(),
    })
    toast.success(`${name} banned`)
  } catch (e) {
    toast.error('Could not ban', { description: (e as Error).message })
  }
}

async function lift(visitorId: Id<'visitors'>, name: string) {
  if (!window.confirm(`Lift the ban on ${name}?`)) return
  try {
    await setBan({ visitorId, banned: false, now: Date.now() })
    toast.success(`Ban on ${name} lifted`)
  } catch (e) {
    toast.error('Could not lift the ban', { description: (e as Error).message })
  }
}

/* ------------------------------------------------------ Overnight rules -- */
const grant = reactive({ visitorId: '', tenantId: '', days: [0, 6] as number[], note: '' })

function toggleDay(day: number) {
  grant.days = grant.days.includes(day)
    ? grant.days.filter((d) => d !== day)
    : [...grant.days, day].sort()
}

async function approve() {
  if (!grant.visitorId || !grant.tenantId) {
    toast.error('Pick a guest and the resident they may stay with')
    return
  }
  try {
    await authorizeOvernight({
      visitorId: grant.visitorId as Id<'visitors'>,
      tenantId: grant.tenantId as Id<'tenants'>,
      days: grant.days,
      note: grant.note || undefined,
      now: Date.now(),
    })
    toast.success('Overnight stay approved')
    Object.assign(grant, { visitorId: '', tenantId: '', days: [0, 6], note: '' })
  } catch (e) {
    toast.error('Could not approve', { description: (e as Error).message })
  }
}

async function revoke(authorizationId: Id<'overnightAuthorizations'>) {
  if (!window.confirm('Withdraw this overnight approval?')) return
  try {
    await revokeOvernight({ authorizationId, now: Date.now() })
    toast.success('Approval withdrawn')
  } catch (e) {
    toast.error('Could not withdraw', { description: (e as Error).message })
  }
}

/** `[0,6]` → `Weekends`; `[]` → `Any night`. */
function dayLabel(days: number[]): string {
  if (!days.length) return 'Any night'
  if (days.length === 7) return 'Any night'
  if (days.length === 2 && days.includes(0) && days.includes(6)) return 'Weekends'
  return days.map((d) => WEEKDAYS[d]!.short).join(', ')
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <DsSectionHeader
      :eyebrow="data ? `${data.building.name} · ${data.weekday}` : undefined"
      title="Visitors"
      description="Who is in the building, who they came for, and who is not allowed in."
    >
      <template #actions>
        <Badge v-if="data?.inside.length" variant="brand" dot>
          {{ data.inside.length }} on site
        </Badge>
        <Badge v-if="data?.banned.length" variant="danger" dot>
          {{ data.banned.length }} banned
        </Badge>
      </template>
    </DsSectionHeader>

    <TsLoadingState v-if="isLoading" label="Loading the desk…" :rows="5" />

    <template v-else-if="data">
      <Tabs v-model="tab">
        <TabsList>
          <TabsTrigger value="desk">
            <DsIcon name="user-plus" :size="15" />
            Sign in / out
          </TabsTrigger>
          <TabsTrigger value="banned">
            <DsIcon name="alert-octagon" :size="15" />
            Banned
            <span
              v-if="data.banned.length"
              class="tnum rounded-full bg-[var(--slate-200)] px-1.5 text-xs font-bold text-[var(--text-body)]"
            >{{ data.banned.length }}</span>
          </TabsTrigger>
          <TabsTrigger value="overnight">
            <DsIcon name="moon" :size="15" />
            Overnight
          </TabsTrigger>
          <TabsTrigger value="people">
            <DsIcon name="users" :size="15" />
            All visitors
          </TabsTrigger>
        </TabsList>

        <!-- ============================================================ Desk -->
        <TabsContent value="desk" class="mt-5 grid gap-5 lg:grid-cols-[1fr_1.1fr] items-start">
          <!-- Sign in -->
          <Card>
            <CardContent class="flex flex-col gap-4 p-5">
              <div class="flex items-center gap-3">
                <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--indigo-50)] text-[var(--indigo-600)]">
                  <DsIcon name="user-plus" :size="18" />
                </span>
                <div class="min-w-0 flex-1">
                  <span class="eyebrow">At the door</span>
                  <div class="font-semibold text-[var(--text-strong)]">Sign a visitor in</div>
                </div>
              </div>

              <DsField label="Who is here" hint="Start typing — returning guests are already on file.">
                <div class="flex flex-col gap-2">
                  <div class="relative">
                    <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                      <DsIcon name="search" :size="15" />
                    </span>
                    <Input v-model="search" class="pl-9" placeholder="Visitor name" />
                  </div>

                  <div class="max-h-48 overflow-y-auto rounded-md border border-[var(--border-strong)]">
                    <button
                      v-for="person in matches"
                      :key="person._id"
                      type="button"
                      class="flex w-full cursor-pointer items-center gap-2.5 border-b border-[var(--border-subtle)] px-3 py-2 text-left transition-colors last:border-0"
                      :class="
                        chosenVisitor === person._id
                          ? 'bg-[var(--brand-soft)]'
                          : 'hover:bg-[var(--surface-hover)]'
                      "
                      @click="chosenVisitor = person._id"
                    >
                      <span class="inline-flex size-8 shrink-0 overflow-hidden rounded-full border border-border bg-[var(--surface-sunken)]">
                        <img
                          v-if="person.photoUrl"
                          :src="person.photoUrl"
                          :alt="person.name"
                          class="size-full object-cover"
                        >
                        <span v-else class="flex size-full items-center justify-center text-[var(--text-subtle)]">
                          <DsIcon name="user" :size="15" />
                        </span>
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-semibold text-[var(--text-strong)]">
                          {{ person.name }}
                        </span>
                        <span v-if="person.usuallyVisits" class="block truncate text-xs text-muted-foreground">
                          Usually visits {{ person.usuallyVisits }}
                        </span>
                      </span>
                      <Badge v-if="person.banned" variant="danger" dot>Banned</Badge>
                      <Badge v-else-if="person.overnightWith.length" variant="violet">Overnight</Badge>
                    </button>

                    <p v-if="!matches.length" class="px-3 py-6 text-center text-sm text-muted-foreground">
                      Nobody on file matches. Register them below.
                    </p>
                  </div>
                </div>
              </DsField>

              <Alert v-if="visitor?.banned" variant="danger">
                <DsIcon name="alert-octagon" :size="17" :stroke-width="2" />
                <AlertDescription>
                  <strong>{{ visitor.name }} is banned.</strong> {{ visitor.bannedReason }}<template
                    v-if="visitor.bannedUntil"
                  > Until {{ formatDate(visitor.bannedUntil) }}.</template>
                </AlertDescription>
              </Alert>

              <DsField v-slot="{ id }" label="Here to see" required>
                <Select v-model="chosenResident">
                  <SelectTrigger :id="id" class="w-full">
                    <SelectValue placeholder="Choose a resident" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="r in data.residents" :key="r.tenantId" :value="r.tenantId">
                      {{ r.room }} — {{ r.name }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </DsField>

              <div class="flex items-center gap-3 rounded-md bg-[var(--surface-sunken)] p-3">
                <div class="min-w-0 flex-1">
                  <label for="overnight" class="cursor-pointer text-sm font-semibold text-[var(--text-strong)]">
                    Staying the night
                  </label>
                  <p v-if="overnight && approvedTonight" class="text-xs text-[var(--success)]">
                    Approved to stay with this resident tonight.
                  </p>
                  <p v-else-if="overnight" class="text-xs text-[var(--warning)]">
                    No approval on file — this will be recorded as unauthorised.
                  </p>
                  <p v-else class="text-xs text-muted-foreground">
                    Overnight stays need a manager's approval.
                  </p>
                </div>
                <Switch id="overnight" v-model="overnight" />
              </div>

              <Button
                variant="primary"
                :loading="signingIn"
                :disabled="!can('wellness') || !!visitor?.banned"
                :title="denied('wellness') ?? undefined"
                @click="doSignIn"
              >
                <DsIcon name="check" :size="17" />
                Sign in
              </Button>

              <div class="border-t border-[var(--border-subtle)] pt-3">
                <Button variant="ghost" size="sm" @click="newVisitorOpen = !newVisitorOpen">
                  <DsIcon name="plus" :size="15" />
                  Register a new visitor
                </Button>

                <div v-if="newVisitorOpen" class="mt-3 flex flex-col gap-3">
                  <DsField v-slot="{ id }" label="Name" required>
                    <Input :id="id" v-model="draft.name" placeholder="Jordan Blake" />
                  </DsField>
                  <div class="grid gap-3 sm:grid-cols-2">
                    <DsField v-slot="{ id }" label="Date of birth">
                      <Input :id="id" v-model="draft.dob" type="date" />
                    </DsField>
                    <DsField v-slot="{ id }" label="ID number" hint="Either one identifies them.">
                      <Input :id="id" v-model="draft.idNumber" placeholder="Driver's licence" />
                    </DsField>
                  </div>
                  <DsField v-slot="{ id }" label="Photo">
                    <input
                      :id="id"
                      ref="photoInput"
                      type="file"
                      accept="image/*"
                      class="text-sm"
                      @change="photoFile = ($event.target as HTMLInputElement).files?.[0] ?? null"
                    >
                  </DsField>
                  <Button variant="primary" size="sm" :loading="registering" @click="createVisitor">
                    <DsIcon name="check" :size="15" />
                    Register
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <!-- On site -->
          <div class="flex flex-col gap-5">
            <Card>
              <CardContent class="flex flex-col gap-3 p-5">
                <div class="flex items-center gap-3">
                  <span class="eyebrow">In the building now</span>
                  <Badge variant="brand">{{ data.inside.length }}</Badge>
                </div>

                <p v-if="!data.inside.length" class="text-base text-muted-foreground">
                  No visitors on site.
                </p>

                <div
                  v-for="visit in data.inside"
                  :key="visit._id"
                  class="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] py-2.5 last:border-0"
                >
                  <span class="inline-flex size-9 shrink-0 overflow-hidden rounded-full border border-border bg-[var(--surface-sunken)]">
                    <img
                      v-if="visit.visitorPhotoUrl"
                      :src="visit.visitorPhotoUrl"
                      :alt="visit.visitorName"
                      class="size-full object-cover"
                    >
                    <span v-else class="flex size-full items-center justify-center text-[var(--text-subtle)]">
                      <DsIcon name="user" :size="16" />
                    </span>
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="flex flex-wrap items-center gap-1.5">
                      <span class="truncate text-sm font-semibold text-[var(--text-strong)]">
                        {{ visit.visitorName }}
                      </span>
                      <Badge v-if="visit.overnight && visit.authorized" variant="violet">Overnight</Badge>
                      <Badge v-else-if="visit.overnight" variant="danger">Overnight · unauthorised</Badge>
                    </span>
                    <span class="block truncate text-xs text-muted-foreground">
                      Visiting {{ visit.residentName }} · room {{ visit.room }} · in
                      {{ new Date(visit.signedInAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    :disabled="!can('wellness')"
                    @click="doSignOut(visit._id, visit.visitorName)"
                  >
                    <DsIcon name="arrow-right" :size="15" />
                    Sign out
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card v-if="data.history.length">
              <CardContent class="flex flex-col gap-2 p-5">
                <span class="eyebrow">Earlier today and before</span>
                <div
                  v-for="visit in data.history"
                  :key="visit._id"
                  class="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border-subtle)] py-1.5 text-sm last:border-0"
                >
                  <span class="text-[var(--text-strong)]">
                    {{ visit.visitorName }}
                    <span class="text-muted-foreground">→ {{ visit.residentName }}</span>
                  </span>
                  <span class="text-xs text-muted-foreground">
                    {{ formatShortDate(visit.signedInAt) }} ·
                    {{ new Date(visit.signedInAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }}
                    – {{ new Date(visit.signedOutAt!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <!-- ========================================================== Banned -->
        <TabsContent value="banned" class="mt-5">
          <DsEmptyState
            v-if="!data.banned.length"
            icon="check-circle-2"
            accent="var(--green-600)"
            title="Nobody is banned"
            description="Bans are set by a site manager and shown to everyone on the desk."
          />

          <div v-else class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
            <Card v-for="person in data.banned" :key="person._id" class="border-[var(--danger-border)]">
              <CardContent class="flex flex-col gap-3 p-5">
                <div class="flex items-start gap-3">
                  <span class="inline-flex size-14 shrink-0 overflow-hidden rounded-lg border border-border bg-[var(--surface-sunken)]">
                    <img
                      v-if="person.photoUrl"
                      :src="person.photoUrl"
                      :alt="person.name"
                      class="size-full object-cover"
                    >
                    <span v-else class="flex size-full items-center justify-center text-[var(--text-subtle)]">
                      <DsIcon name="user" :size="22" />
                    </span>
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-semibold text-[var(--text-strong)]">{{ person.name }}</span>
                      <Badge variant="danger" dot>Banned</Badge>
                    </div>
                    <p class="mt-0.5 text-sm text-[var(--text-body)]">{{ person.bannedReason }}</p>
                    <p class="text-xs text-muted-foreground">
                      {{ person.bannedUntil ? `Until ${formatDate(person.bannedUntil)}` : 'Indefinitely' }}
                    </p>
                  </div>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  :disabled="!can('site-config')"
                  :title="denied('site-config') ?? 'Lift the ban'"
                  @click="lift(person._id, person.name)"
                >
                  <DsIcon name="refresh" :size="15" />
                  Lift the ban
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <!-- ======================================================= Overnight -->
        <TabsContent value="overnight" class="mt-5 flex flex-col gap-5">
          <Card>
            <CardContent class="flex flex-col gap-3 p-5">
              <div class="flex items-center gap-3">
                <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--violet-50)] text-[var(--violet-600)]">
                  <DsIcon name="moon" :size="18" />
                </span>
                <div class="min-w-0 flex-1">
                  <span class="eyebrow">Approved to stay tonight · {{ data.weekday }}</span>
                  <div class="font-semibold text-[var(--text-strong)]">Overnight guests</div>
                </div>
                <Badge variant="violet">{{ data.overnightTonight.length }}</Badge>
              </div>

              <p v-if="!data.overnightTonight.length" class="text-base text-muted-foreground">
                Nobody is approved to stay tonight.
              </p>

              <div
                v-for="row in data.overnightTonight"
                :key="row._id"
                class="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] py-2.5 last:border-0"
              >
                <span class="inline-flex size-9 shrink-0 overflow-hidden rounded-full border border-border bg-[var(--surface-sunken)]">
                  <img
                    v-if="row.visitorPhotoUrl"
                    :src="row.visitorPhotoUrl"
                    :alt="row.visitorName"
                    class="size-full object-cover"
                  >
                  <span v-else class="flex size-full items-center justify-center text-[var(--text-subtle)]">
                    <DsIcon name="user" :size="16" />
                  </span>
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold text-[var(--text-strong)]">
                    {{ row.visitorName }}
                  </span>
                  <span class="block truncate text-xs text-muted-foreground">
                    with {{ row.residentName }}<template v-if="row.note"> · {{ row.note }}</template>
                  </span>
                </span>
                <Badge variant="neutral">{{ dayLabel(row.days) }}</Badge>
              </div>
            </CardContent>
          </Card>

          <!-- Grant -->
          <Card>
            <CardContent class="flex flex-col gap-4 p-5">
              <div class="flex items-center gap-3">
                <div class="min-w-0 flex-1">
                  <span class="eyebrow">Manager</span>
                  <div class="font-semibold text-[var(--text-strong)]">Approve an overnight stay</div>
                </div>
              </div>

              <p v-if="!can('site-config')" class="flex items-center gap-2 text-sm text-muted-foreground">
                <DsIcon name="lock" :size="15" />
                {{ denied('site-config') }} Site managers approve overnight stays.
              </p>

              <div class="flex flex-wrap items-end gap-3">
                <DsField v-slot="{ id }" label="Guest" class="min-w-[200px] flex-1">
                  <Select v-model="grant.visitorId">
                    <SelectTrigger :id="id" class="w-full">
                      <SelectValue placeholder="Choose a visitor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="p in data.visitors" :key="p._id" :value="p._id">
                        {{ p.name }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </DsField>

                <DsField v-slot="{ id }" label="May stay with" class="min-w-[200px] flex-1">
                  <Select v-model="grant.tenantId">
                    <SelectTrigger :id="id" class="w-full">
                      <SelectValue placeholder="Choose a resident" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="r in data.residents" :key="r.tenantId" :value="r.tenantId">
                        {{ r.room }} — {{ r.name }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </DsField>
              </div>

              <DsField label="Which nights" hint="None selected means any night.">
                <div class="flex flex-wrap gap-1.5">
                  <button
                    v-for="day in WEEKDAYS"
                    :key="day.value"
                    type="button"
                    class="cursor-pointer rounded-full border px-3 py-1 text-sm font-semibold transition-colors"
                    :class="
                      grant.days.includes(day.value)
                        ? 'border-[var(--violet-600)] bg-[var(--violet-50)] text-[var(--violet-600)]'
                        : 'border-border bg-card text-muted-foreground hover:bg-[var(--surface-hover)]'
                    "
                    :disabled="!can('site-config')"
                    @click="toggleDay(day.value)"
                  >
                    {{ day.short }}
                  </button>
                </div>
              </DsField>

              <DsField v-slot="{ id }" label="Note">
                <Input :id="id" v-model="grant.note" placeholder="Partner — approved by coordinator" />
              </DsField>

              <Button
                variant="primary"
                class="self-start"
                :loading="authorizing"
                :disabled="!can('site-config')"
                @click="approve"
              >
                <DsIcon name="check" :size="17" />
                Approve
              </Button>
            </CardContent>
          </Card>

          <Card v-if="data.authorizations.length">
            <CardContent class="flex flex-col gap-2 p-5">
              <span class="eyebrow">All approvals on file</span>
              <div
                v-for="row in data.authorizations"
                :key="row._id"
                class="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] py-2 text-sm last:border-0"
              >
                <span class="min-w-0 flex-1 text-[var(--text-strong)]">
                  <strong>{{ row.visitorName }}</strong> with {{ row.residentName }}
                </span>
                <Badge variant="neutral">{{ dayLabel(row.days) }}</Badge>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Withdraw"
                  :disabled="!can('site-config')"
                  @click="revoke(row._id)"
                >
                  <DsIcon name="trash" :size="15" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <!-- ==================================================== All visitors -->
        <TabsContent value="people" class="mt-5">
          <DsEmptyState
            v-if="!data.visitors.length"
            icon="users"
            title="No visitors on file"
            description="Register the first guest from the sign-in tab."
          />

          <div v-else class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
            <Card v-for="person in data.visitors" :key="person._id">
              <CardContent class="flex flex-col gap-3 p-5">
                <div class="flex items-start gap-3">
                  <span class="inline-flex size-12 shrink-0 overflow-hidden rounded-lg border border-border bg-[var(--surface-sunken)]">
                    <img
                      v-if="person.photoUrl"
                      :src="person.photoUrl"
                      :alt="person.name"
                      class="size-full object-cover"
                    >
                    <span v-else class="flex size-full items-center justify-center text-[var(--text-subtle)]">
                      <DsIcon name="user" :size="20" />
                    </span>
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="font-semibold text-[var(--text-strong)]">{{ person.name }}</span>
                      <Badge v-if="person.banned" variant="danger" dot>Banned</Badge>
                      <Badge v-if="person.overnightWith.length" variant="violet">Overnight</Badge>
                    </div>
                    <p class="text-xs text-muted-foreground">
                      <template v-if="person.dob">Born {{ formatDate(person.dob) }}</template>
                      <template v-else-if="person.idNumber">ID {{ person.idNumber }}</template>
                      <template v-else>No ID on file</template>
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {{ person.visitsThisMonth }} visit{{ person.visitsThisMonth === 1 ? '' : 's' }}
                      in the last month<template v-if="person.usuallyVisits">
                        · usually {{ person.usuallyVisits }}</template>
                    </p>
                  </div>
                </div>

                <div v-if="person.overnightWith.length" class="flex flex-wrap gap-1.5">
                  <Badge v-for="row in person.overnightWith" :key="row.tenantId" variant="violet">
                    {{ dayLabel(row.days) }} with {{ row.name }}
                  </Badge>
                </div>

                <Button
                  v-if="!person.banned"
                  variant="secondary"
                  size="sm"
                  class="self-start"
                  :disabled="!can('site-config')"
                  :title="denied('site-config') ?? 'Ban from this site'"
                  @click="ban(person._id, person.name)"
                >
                  <DsIcon name="alert-octagon" :size="15" />
                  Ban
                </Button>
                <Button
                  v-else
                  variant="secondary"
                  size="sm"
                  class="self-start"
                  :disabled="!can('site-config')"
                  @click="lift(person._id, person.name)"
                >
                  <DsIcon name="refresh" :size="15" />
                  Lift the ban
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </template>
  </div>
</template>
