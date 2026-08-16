<script setup lang="ts">
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { formatDate, yearsSince } from '~/utils/format'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/**
 * Resident sheet — the page that gets printed and handed to a paramedic or an
 * officer attending the site.
 *
 * What is *not* here is the point of it: no rent, no ledger, no deposit, no
 * shift notes. A sheet that travels off-site carries the minimum a responder
 * needs to treat somebody safely, and nothing that would embarrass them or
 * expose the building's finances.
 *
 * The SIN is off by default even for staff who can see it: it is of no use to
 * a responder and a printed copy left behind is an identity-theft risk.
 */
definePageMeta({ layout: false })

const route = useRoute()
const tenantId = computed(() => route.params.id as Id<'tenants'>)

const includeSin = ref(false)

const { data, isLoading } = useConvexQuery(api.profile.sheet, () => ({
  tenantId: tenantId.value,
  includeSin: includeSin.value,
}))

useHead(() => ({
  title: data.value ? `${data.value.tenant.name} — resident sheet` : 'Resident sheet',
}))

const printedAt = new Date()

const FLAGS = [
  { key: 'houseAbility', label: 'House-ability' },
  { key: 'mental', label: 'Mental' },
  { key: 'physical', label: 'Physical' },
  { key: 'pest', label: 'Pest' },
  { key: 'clutter', label: 'Clutter' },
] as const

const FLAG_TONE: Record<string, string> = {
  green: 'var(--green-700)',
  amber: 'var(--amber-700)',
  red: 'var(--red-700)',
  none: 'var(--text-subtle)',
}

const HEALTH_SECTIONS = [
  {
    title: 'Physical health',
    items: [
      { key: 'dnrOrder', label: 'Valid DNR order' },
      { key: 'mobilityIssues', label: 'Mobility issues' },
      { key: 'physicalDisabilities', label: 'Physical disabilities' },
      { key: 'developmentalDisabilities', label: 'Developmental disabilities' },
      { key: 'hivAids', label: 'HIV / AIDS' },
      { key: 'careRxProgram', label: 'On CareRX medication programme' },
    ],
  },
  {
    title: 'Mental health',
    items: [
      { key: 'schizophrenia', label: 'Schizophrenia' },
      { key: 'receivesImShot', label: 'Receives IM shot' },
    ],
  },
  {
    title: 'Substance use',
    items: [
      { key: 'overdoseAlert', label: 'Overdose alert' },
      { key: 'substanceUse', label: 'Substance use' },
      { key: 'onSubstanceTreatment', label: 'On substance-use treatment' },
    ],
  },
] as const

const DETAILS = [
  { key: 'conditions', label: 'Medical conditions' },
  { key: 'allergies', label: 'Allergies' },
  { key: 'medications', label: 'Medications' },
  { key: 'mobilityAids', label: 'Mobility aids' },
  { key: 'careNotes', label: 'Notes for responders' },
] as const

/** yes / no / not recorded — never a blank that reads as "no". */
function state(value: unknown): { label: string; tone: string } {
  if (value === true) return { label: 'Yes', tone: 'var(--red-700)' }
  if (value === false) return { label: 'No', tone: 'var(--text-body)' }
  return { label: 'Not recorded', tone: 'var(--text-subtle)' }
}

function print() {
  window.print()
}
</script>

<template>
  <div class="min-h-screen bg-[var(--surface-app)] print:bg-white">
    <!-- Screen-only toolbar -->
    <div
      class="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border bg-card px-5 py-3 print:hidden"
    >
      <Button variant="ghost" size="sm" @click="navigateTo(`/tenants/${tenantId}`)">
        <DsIcon name="arrow-left" :size="16" />
        Back to record
      </Button>
      <div class="flex-1" />
      <div class="flex items-center gap-2">
        <Switch id="include-sin" v-model="includeSin" />
        <Label for="include-sin" class="cursor-pointer text-sm">Include SIN</Label>
      </div>
      <Button variant="primary" size="sm" @click="print">
        <DsIcon name="printer" :size="16" />
        Print
      </Button>
    </div>

    <TsLoadingState v-if="isLoading" label="Building the sheet…" :rows="6" />

    <DsEmptyState
      v-else-if="!data"
      icon="user"
      title="Resident not found"
      description="This record may have been removed."
    />

    <!-- The sheet itself -->
    <article
      v-else
      class="mx-auto my-6 flex max-w-[820px] flex-col gap-5 bg-white p-8 text-[var(--text-body)] shadow-sm print:my-0 print:max-w-none print:p-0 print:shadow-none"
    >
      <!-- Masthead -->
      <header class="flex items-start gap-5 border-b-2 border-[var(--text-strong)] pb-4">
        <div
          class="flex size-[104px] shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-[var(--surface-sunken)]"
        >
          <img
            v-if="data.tenant.photoUrl"
            :src="data.tenant.photoUrl"
            :alt="data.tenant.name"
            class="size-full object-cover"
          >
          <DsIcon v-else name="user" :size="40" class="text-[var(--text-subtle)]" />
        </div>

        <div class="min-w-0 flex-1">
          <div class="eyebrow">Resident information sheet</div>
          <h1 class="text-2xl font-bold tracking-tight text-[var(--text-strong)]">
            {{ data.tenant.name }}
          </h1>
          <p class="mt-0.5 text-base">
            <span v-if="data.tenant.preferredName">
              Goes by {{ data.tenant.preferredName }} ·
            </span>
            <span v-if="data.tenant.pronouns">{{ data.tenant.pronouns }} · </span>
            <span class="mono font-semibold text-[var(--text-strong)]">
              Room {{ data.tenant.room }}
            </span>
            <span v-if="data.tenant.floor"> · {{ data.tenant.floor }}</span>
          </p>
          <p class="text-base font-semibold text-[var(--text-strong)]">
            {{ data.building.name }}<span v-if="data.building.address"> · {{ data.building.address }}</span>
          </p>
        </div>

        <div class="shrink-0 text-right text-xs text-[var(--text-muted)]">
          <div>Printed {{ formatDate(printedAt.getTime()) }}</div>
          <div>{{ printedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }}</div>
          <div>by {{ data.generatedBy }}</div>
        </div>
      </header>

      <!-- Alerts: the things that change what happens in the first minute -->
      <section v-if="data.alerts.length" class="flex flex-col gap-2">
        <div
          v-for="alert in data.alerts"
          :key="alert.label"
          class="flex items-start gap-3 rounded-md border-2 border-[var(--red-600)] bg-[var(--red-50)] p-3 print:bg-white"
        >
          <DsIcon name="alert-octagon" :size="20" class="mt-px shrink-0 text-[var(--red-700)]" />
          <div>
            <div class="font-bold uppercase tracking-wide text-[var(--red-700)]">
              {{ alert.label }}
            </div>
            <div class="text-sm text-[var(--text-body)]">{{ alert.detail }}</div>
          </div>
        </div>
      </section>

      <!-- Identity -->
      <section class="flex flex-col gap-2">
        <h2 class="border-b border-border pb-1 text-sm font-bold uppercase tracking-[0.08em] text-[var(--text-strong)]">
          Identity
        </h2>
        <dl class="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <div>
            <dt class="text-xs uppercase tracking-wide text-[var(--text-muted)]">Date of birth</dt>
            <dd class="font-semibold text-[var(--text-strong)]">
              {{ data.tenant.dob ? formatDate(data.tenant.dob) : 'Not recorded' }}
              <span v-if="data.tenant.dob" class="font-normal text-[var(--text-muted)]">
                (age {{ yearsSince(data.tenant.dob) }})
              </span>
            </dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-[var(--text-muted)]">Phone</dt>
            <dd class="font-semibold text-[var(--text-strong)]">
              {{ data.tenant.phone ?? 'Not recorded' }}
            </dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-[var(--text-muted)]">Language</dt>
            <dd class="font-semibold text-[var(--text-strong)]">
              {{ data.tenant.languages ?? 'English' }}
            </dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-[var(--text-muted)]">Support level</dt>
            <dd class="font-semibold capitalize text-[var(--text-strong)]">
              {{ data.tenant.supportLevel }}
            </dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-[var(--text-muted)]">Resident since</dt>
            <dd class="font-semibold text-[var(--text-strong)]">
              {{ formatDate(data.tenant.intakeDate) }}
            </dd>
          </div>
          <div v-if="data.tenant.sin">
            <dt class="text-xs uppercase tracking-wide text-[var(--text-muted)]">SIN</dt>
            <dd class="mono font-semibold text-[var(--text-strong)]">{{ data.tenant.sin }}</dd>
          </div>
        </dl>
      </section>

      <!-- Condition -->
      <section class="flex flex-col gap-2">
        <h2 class="border-b border-border pb-1 text-sm font-bold uppercase tracking-[0.08em] text-[var(--text-strong)]">
          Room and resident condition
        </h2>
        <div class="flex flex-wrap gap-x-6 gap-y-1">
          <span v-for="flag in FLAGS" :key="flag.key" class="text-sm">
            <span class="text-[var(--text-muted)]">{{ flag.label }}:</span>
            <strong class="ml-1 capitalize" :style="{ color: FLAG_TONE[data.flags[flag.key]] }">
              {{ data.flags[flag.key] === 'none' ? 'Not recorded' : data.flags[flag.key] }}
            </strong>
          </span>
        </div>
      </section>

      <!-- Health -->
      <section class="flex flex-col gap-3">
        <h2 class="border-b border-border pb-1 text-sm font-bold uppercase tracking-[0.08em] text-[var(--text-strong)]">
          Health
        </h2>

        <div class="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <div v-for="section in HEALTH_SECTIONS" :key="section.title" class="flex flex-col gap-1">
            <h3 class="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
              {{ section.title }}
            </h3>
            <div
              v-for="item in section.items"
              :key="item.key"
              class="flex items-baseline justify-between gap-3 border-b border-[var(--border-subtle)] py-0.5 text-sm last:border-0"
            >
              <span class="min-w-0">{{ item.label }}</span>
              <strong
                class="shrink-0 whitespace-nowrap"
                :style="{ color: state(data.health[item.key]).tone }"
              >
                {{ state(data.health[item.key]).label }}
              </strong>
            </div>
          </div>
        </div>

        <dl class="grid grid-cols-[minmax(140px,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">
          <template v-for="detail in DETAILS" :key="detail.key">
            <dt class="text-xs uppercase tracking-wide text-[var(--text-muted)]">
              {{ detail.label }}
            </dt>
            <dd
              :class="
                data.health[detail.key] ? 'text-[var(--text-strong)]' : 'text-[var(--text-subtle)]'
              "
            >
              {{ data.health[detail.key] || 'Not recorded' }}
            </dd>
          </template>
        </dl>
      </section>

      <!-- Contacts -->
      <section class="flex flex-col gap-2">
        <h2 class="border-b border-border pb-1 text-sm font-bold uppercase tracking-[0.08em] text-[var(--text-strong)]">
          Who to call
        </h2>
        <p v-if="!data.contacts.length" class="text-sm text-[var(--text-muted)]">
          No contacts on file.
        </p>
        <div
          v-for="contact in data.contacts"
          :key="contact.name + contact.relationship"
          class="flex flex-wrap items-baseline gap-x-3 text-sm"
        >
          <strong class="text-[var(--text-strong)]">{{ contact.name }}</strong>
          <span class="text-[var(--text-muted)]">{{ contact.relationship }}</span>
          <span v-if="contact.phone" class="mono font-semibold text-[var(--text-strong)]">
            {{ contact.phone }}
          </span>
          <span
            v-if="contact.isNextOfKin"
            class="rounded-sm border border-[var(--text-strong)] px-1.5 text-2xs font-bold uppercase tracking-wide"
          >
            Next of kin
          </span>
        </div>
      </section>

      <footer class="mt-2 border-t border-border pt-3 text-xs text-[var(--text-muted)]">
        Confidential. Contains personal health information — hand to attending responders only
        and do not leave unattended. No financial or tenancy-account information appears on this
        sheet.
      </footer>
    </article>
  </div>
</template>

<style>
@media print {
  @page {
    margin: 14mm;
  }
  html,
  body {
    background: #fff !important;
  }
}
</style>
