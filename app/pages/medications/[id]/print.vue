<script setup lang="ts">
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { formatDate, formatMinutes, formatShortDate, yearsSince } from '~/utils/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * The printed MAR — a month on one sheet, laid out the way the paper one is:
 * one row per order and time, one column per day, the outcome code and the
 * charter's initials in each cell. PRN doses in a log beneath, legend at the
 * foot. Prints without app chrome, like the responder sheet.
 */
definePageMeta({ layout: false })

const route = useRoute()
const router = useRouter()
const tenantId = computed(() => route.params.id as Id<'tenants'>)

const tz = new Date().getTimezoneOffset()
const thisMonth = new Date(Date.now() - tz * 60_000).toISOString().slice(0, 7)
const month = ref(typeof route.query.month === 'string' && /^\d{4}-\d{2}$/.test(route.query.month) ? route.query.month : thisMonth)

watch(month, (m) => router.replace({ query: { ...route.query, month: m } }))

const { data, isLoading } = useConvexQuery(api.medications.sheet, () => ({
  tenantId: tenantId.value,
  month: month.value,
  tzOffsetMinutes: tz,
}))

useHead(() => ({
  title: data.value ? `${data.value.tenant.name} — MAR ${data.value.month}` : 'Medication record',
}))

const printedAt = new Date()

const monthLabel = computed(() => {
  const [y, m] = month.value.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
})

const CODE: Record<string, string> = {
  given: '✓',
  refused: 'R',
  held: 'H',
  absent: 'A',
  'not-given': 'N',
}

const LEGEND = [
  ['✓', 'Given'],
  ['R', 'Refused'],
  ['H', 'Held — staff judgement'],
  ['A', 'Absent from building'],
  ['N', 'Not given — see record'],
  ['*', 'Given more than an hour early or late — time shown on the record'],
  ['—', 'Not charted'],
  ['▒', 'Order not active'],
]

const ROUTE_LABEL: Record<string, string> = {
  oral: 'PO',
  sublingual: 'SL',
  topical: 'TOP',
  inhaled: 'INH',
  injection: 'INJ',
  'eye-ear': 'EYE/EAR',
  other: '—',
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function print() {
  window.print()
}
</script>

<template>
  <div class="min-h-screen bg-[var(--surface-app)] print:bg-white">
    <div
      class="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-border bg-card px-5 py-3 print:hidden"
    >
      <Button variant="ghost" size="sm" @click="navigateTo(`/medications/${tenantId}`)">
        <DsIcon name="arrow-left" :size="16" />
        Back to record
      </Button>
      <div class="flex-1" />
      <Input v-model="month" type="month" class="w-[170px]" :max="thisMonth" />
      <Button variant="primary" size="sm" @click="print">
        <DsIcon name="printer" :size="16" />
        Print
      </Button>
    </div>

    <TsLoadingState v-if="isLoading" label="Preparing the sheet…" :rows="6" class="m-6" />

    <DsEmptyState
      v-else-if="!data"
      icon="pill"
      title="No such resident"
      description="This record does not exist, or belongs to a building you are not assigned to."
    />

    <main v-else class="mx-auto max-w-[1180px] p-6 text-[13px] text-black print:max-w-none print:p-0 print:text-[10px]">
      <header class="mb-4 flex flex-wrap items-end justify-between gap-3 border-b-2 border-black pb-3">
        <div>
          <p class="text-[11px] uppercase tracking-wide text-neutral-600">Medication Administration Record</p>
          <h1 class="text-2xl font-bold leading-tight">{{ data.tenant.name }}</h1>
          <p class="text-sm">
            Room {{ data.tenant.room }}
            <template v-if="data.tenant.dob">
              · DOB {{ formatDate(data.tenant.dob) }} ({{ yearsSince(data.tenant.dob) }})
            </template>
            · {{ data.building.name }}
          </p>
        </div>
        <div class="text-right">
          <p class="text-xl font-bold">{{ monthLabel }}</p>
          <p class="text-sm">
            <span class="font-semibold">Allergies:</span>
            <span :class="data.tenant.allergies ? 'font-bold' : 'text-neutral-600'">
              {{ data.tenant.allergies || 'None recorded' }}
            </span>
          </p>
        </div>
      </header>

      <p v-if="!data.grid.length && !data.prn.length" class="py-10 text-center text-neutral-600">
        No orders on file for this month.
      </p>

      <div v-if="data.grid.length" class="overflow-x-auto">
        <table class="w-full border-collapse [&_td]:border [&_td]:border-neutral-400 [&_th]:border [&_th]:border-neutral-400">
          <thead>
            <tr class="bg-neutral-100">
              <th class="min-w-[220px] px-2 py-1 text-left align-bottom">Medication · dose · route</th>
              <th class="px-1 py-1 align-bottom">Time</th>
              <th v-for="d in data.days" :key="d" class="w-[26px] px-0 py-1 text-center tnum">{{ d }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in data.grid" :key="`${row.medicationId}:${row.minutes}`">
              <td class="px-2 py-1 align-top">
                <p class="font-semibold leading-tight">
                  {{ row.name }} <span v-if="row.strength" class="font-normal">{{ row.strength }}</span>
                </p>
                <p class="leading-tight text-neutral-700">
                  {{ row.dose }} · {{ ROUTE_LABEL[row.route] }}
                  <template v-if="row.instructions"> · {{ row.instructions }}</template>
                </p>
                <p class="text-[10px] leading-tight text-neutral-600 print:text-[8px]">
                  From {{ formatShortDate(row.startDate) }}
                  <template v-if="row.discontinuedAt"> · D/C {{ formatShortDate(row.discontinuedAt) }}</template>
                  <template v-else-if="row.endDate"> · to {{ formatShortDate(row.endDate) }}</template>
                </p>
              </td>
              <td class="whitespace-nowrap px-1 py-1 text-center align-top tnum">{{ formatMinutes(row.minutes) }}</td>
              <td
                v-for="(cell, i) in row.days"
                :key="i"
                class="h-9 p-0 text-center align-middle leading-none"
                :class="cell === 'inactive' ? 'bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,#d4d4d4_3px,#d4d4d4_4px)]' : ''"
              >
                <template v-if="cell && cell !== 'inactive'">
                  <div class="font-bold" :title="`${clock(cell.givenAt)}${cell.timing && cell.timing !== 'on-time' ? ` (${cell.timing})` : ''}`">
                    {{ CODE[cell.outcome] }}<sup v-if="cell.timing && cell.timing !== 'on-time'">*</sup>
                  </div>
                  <div class="text-[9px] text-neutral-700 print:text-[7px]">{{ cell.initials }}</div>
                </template>
                <span v-else-if="cell === null" class="text-neutral-400">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <section v-if="data.prnOrders.length || data.prn.length" class="mt-5 break-inside-avoid">
        <h2 class="mb-1 text-sm font-bold uppercase tracking-wide">As-needed (PRN) medications</h2>
        <ul v-if="data.prnOrders.length" class="mb-2 list-disc pl-5">
          <li v-for="o in data.prnOrders" :key="o.name + (o.strength ?? '')">
            <span class="font-semibold">{{ o.name }}<template v-if="o.strength"> {{ o.strength }}</template></span>
            · {{ o.dose }}
            <template v-if="o.indication"> · for {{ o.indication }}</template>
            <template v-if="o.maxPerDay"> · max {{ o.maxPerDay }}/day</template>
          </li>
        </ul>
        <table
          v-if="data.prn.length"
          class="w-full border-collapse [&_td]:border [&_td]:border-neutral-400 [&_th]:border [&_th]:border-neutral-400"
        >
          <thead>
            <tr class="bg-neutral-100">
              <th class="px-2 py-1 text-left">Date</th>
              <th class="px-2 py-1 text-left">Time given</th>
              <th class="px-2 py-1 text-left">Medication</th>
              <th class="px-2 py-1 text-left">Given for / reason</th>
              <th class="px-2 py-1 text-left">Note</th>
              <th class="px-2 py-1 text-center">Code</th>
              <th class="px-2 py-1 text-center">Init.</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in data.prn" :key="i">
              <td class="px-2 py-1 tnum">{{ formatShortDate(row.date) }}</td>
              <td class="px-2 py-1 tnum">{{ clock(row.givenAt) }}</td>
              <td class="px-2 py-1">{{ row.medication }}</td>
              <td class="px-2 py-1">{{ row.reason ?? '' }}</td>
              <td class="px-2 py-1">{{ row.note ?? '' }}</td>
              <td class="px-2 py-1 text-center font-bold">{{ CODE[row.outcome] }}</td>
              <td class="px-2 py-1 text-center">{{ row.initials }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="text-neutral-600">No as-needed doses charted this month.</p>
      </section>

      <footer class="mt-5 flex flex-wrap items-start justify-between gap-4 border-t border-neutral-400 pt-2 text-[11px] print:text-[8px]">
        <dl class="flex flex-wrap gap-x-4 gap-y-1">
          <div v-for="[code, label] in LEGEND" :key="code" class="flex gap-1">
            <dt class="font-bold">{{ code }}</dt>
            <dd>{{ label }}</dd>
          </div>
        </dl>
        <p class="text-neutral-600">
          Printed {{ printedAt.toLocaleString() }} · A dose is on time within an hour either side of its scheduled
          time · Voided entries are omitted here and remain on the electronic record
        </p>
      </footer>
    </main>
  </div>
</template>

<style scoped>
@media print {
  @page {
    size: landscape;
    margin: 10mm;
  }
}
</style>
