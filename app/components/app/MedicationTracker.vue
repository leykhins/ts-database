<script setup lang="ts">
import { api } from '../../../convex/_generated/api'
import { formatMinutes } from '~/utils/format'
import type { DoseTarget } from '~/components/app/DoseDialog.vue'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * This shift's medication, on the Care Console.
 *
 * The MAR board is the whole day for the whole building; this is the slice a
 * worker owns right now — every dose that falls inside the live shift, in the
 * order they come due, each one a tap away from being charted. Outstanding
 * doses are listed; charted ones collapse into the progress bar and a count,
 * because a list that keeps growing as the shift goes well is a list that
 * buries the one dose still owed.
 */
const { selected } = useSelectedBuilding()
const { can, denied } = useMe()
const now = useNow()
const tz = new Date().getTimezoneOffset()

const { data, isLoading } = useConvexQuery(api.medications.shift, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
  now: now.value,
  tzOffsetMinutes: tz,
}))

type Dose = NonNullable<typeof data.value>['doses'][number]

const outstanding = computed(() => (data.value?.doses ?? []).filter((d) => !d.administration))
const charted = computed(() => (data.value?.doses ?? []).filter((d) => d.administration))
const showCharted = ref(false)

const progress = computed(() => {
  const c = data.value?.counts
  if (!c || !c.total) return { given: 0, other: 0 }
  return { given: (c.given / c.total) * 100, other: (c.notGiven / c.total) * 100 }
})

/* ---- Charting ------------------------------------------------------- */

const doseOpen = ref(false)
const doseTarget = ref<DoseTarget | null>(null)

function chart(dose: Dose) {
  if (!can('medications') || dose.administration || !data.value) return
  doseTarget.value = {
    medicationId: dose.order._id,
    residentName: dose.name,
    medication: dose.order.strength ? `${dose.order.name} ${dose.order.strength}` : dose.order.name,
    dose: dose.order.dose,
    instructions: dose.order.instructions,
    prn: false,
    prnIndication: null,
    date: data.value.date,
    scheduledMinutes: dose.minutes,
  }
  doseOpen.value = true
}

/* ---- Presentation --------------------------------------------------- */

const STATUS: Record<string, { dot: string; text: string; label: string }> = {
  overdue: { dot: 'var(--red-600)', text: 'text-[var(--danger)]', label: 'Overdue' },
  due: { dot: 'var(--amber-500)', text: 'text-[var(--amber-700)]', label: 'Due now' },
  upcoming: { dot: 'var(--slate-400)', text: 'text-muted-foreground', label: 'Later' },
}

const OUTCOME: Record<string, { code: string; tone: string }> = {
  given: { code: 'Given', tone: 'text-[var(--success)]' },
  refused: { code: 'Refused', tone: 'text-[var(--warning)]' },
  held: { code: 'Held', tone: 'text-[var(--warning)]' },
  absent: { code: 'Absent', tone: 'text-[var(--warning)]' },
  'not-given': { code: 'Not given', tone: 'text-[var(--danger)]' },
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
</script>

<template>
  <DsPanel
    title="Medication this shift"
    :subtitle="data ? `${data.shift.label}, ${data.shift.hours}. Tap a dose to chart it.` : 'Doses due on this shift.'"
    :count="data ? `${data.counts.given + data.counts.notGiven}/${data.counts.total}` : null"
  >
    <template #action>
      <NuxtLink to="/medications" class="text-xs font-semibold text-[var(--brand)] hover:underline">
        Open MAR
      </NuxtLink>
    </template>

    <div v-if="isLoading" class="flex flex-col gap-2.5">
      <Skeleton class="h-2 w-full" />
      <Skeleton v-for="i in 3" :key="i" class="h-10 w-full" />
    </div>

    <p v-else-if="!data?.counts.total" class="text-sm text-muted-foreground">
      No scheduled doses fall on this shift.
    </p>

    <div v-else class="flex flex-col gap-3">
      <!-- The shift at a glance: given, not given, still owed. -->
      <div class="flex flex-col gap-1.5">
        <div class="flex h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
          <div class="h-full bg-[var(--emerald-600)]" :style="{ width: `${progress.given}%` }" />
          <div class="h-full bg-[var(--amber-500)]" :style="{ width: `${progress.other}%` }" />
        </div>
        <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tnum">
          <span><b class="text-[var(--text-strong)]">{{ data.counts.given }}</b> given</span>
          <span v-if="data.counts.notGiven"><b class="text-[var(--warning)]">{{ data.counts.notGiven }}</b> not given</span>
          <span v-if="data.counts.overdue"><b class="text-[var(--danger)]">{{ data.counts.overdue }}</b> overdue</span>
          <span v-if="data.counts.due"><b class="text-[var(--amber-700)]">{{ data.counts.due }}</b> due now</span>
          <span v-if="data.counts.upcoming"><b class="text-[var(--text-strong)]">{{ data.counts.upcoming }}</b> later</span>
          <span v-if="data.counts.late"><b class="text-[var(--warning)]">{{ data.counts.late }}</b> off schedule</span>
        </div>
      </div>

      <p
        v-if="!outstanding.length"
        class="flex items-center gap-1.5 text-sm font-semibold text-[var(--success)]"
      >
        <DsIcon name="check-circle-2" :size="15" />
        Every dose on this shift is charted.
      </p>

      <ul v-else class="flex flex-col divide-y divide-[var(--border-subtle)]">
        <li v-for="dose in outstanding" :key="`${dose.order._id}:${dose.minutes}`">
          <button
            type="button"
            class="flex w-full items-center gap-2.5 rounded-md px-1 py-2 text-left transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-default disabled:hover:bg-transparent"
            :disabled="!can('medications')"
            :title="denied('medications') ?? `Chart ${dose.order.name} for ${dose.name}`"
            @click="chart(dose)"
          >
            <span class="w-[58px] shrink-0 text-xs font-bold tnum" :class="STATUS[dose.status]?.text">
              {{ formatMinutes(dose.minutes) }}
            </span>
            <TsResidentAvatar
              :name="dose.name"
              :tenant-id="dose.tenantId"
              :photo-url="dose.photoUrl"
              :room="dose.room"
              size="xs"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold text-[var(--text-strong)]">
                {{ dose.name }} <span class="mono font-normal text-muted-foreground">· {{ dose.room }}</span>
              </span>
              <span class="block truncate text-xs text-muted-foreground">
                {{ dose.order.name }}<template v-if="dose.order.strength"> {{ dose.order.strength }}</template>
                · {{ dose.order.dose }}
                <template v-if="dose.allergies"> · <span class="font-semibold text-[var(--danger)]">Allergy: {{ dose.allergies }}</span></template>
              </span>
            </span>
            <span class="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold" :class="STATUS[dose.status]?.text">
              <span
                class="size-1.5 rounded-full"
                :class="dose.status === 'due' && 'ts-pulse'"
                :style="{ background: STATUS[dose.status]?.dot }"
              />
              {{ STATUS[dose.status]?.label }}
            </span>
          </button>
        </li>
      </ul>

      <div v-if="charted.length" class="border-t border-[var(--border-subtle)] pt-2">
        <button
          type="button"
          class="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-[var(--text-strong)]"
          :aria-expanded="showCharted"
          @click="showCharted = !showCharted"
        >
          <DsIcon :name="showCharted ? 'chevron-up' : 'chevron-down'" :size="13" />
          {{ charted.length }} charted this shift
        </button>
        <ul v-if="showCharted" class="mt-1.5 flex flex-col gap-1">
          <li
            v-for="dose in charted"
            :key="`${dose.order._id}:${dose.minutes}`"
            class="flex items-center gap-2 text-xs tnum"
          >
            <span class="w-[58px] shrink-0 text-muted-foreground">{{ formatMinutes(dose.minutes) }}</span>
            <span class="min-w-0 flex-1 truncate text-[var(--text-body)]">
              {{ dose.name }} · {{ dose.order.name }}
            </span>
            <span class="shrink-0 font-semibold" :class="OUTCOME[dose.administration!.outcome]?.tone">
              {{ OUTCOME[dose.administration!.outcome]?.code }} {{ clock(dose.administration!.givenAt) }}
            </span>
            <span
              v-if="dose.administration!.timing && dose.administration!.timing !== 'on-time'"
              class="shrink-0 rounded-sm bg-[var(--warning-soft)] px-1 font-semibold uppercase text-[var(--warning)]"
            >
              {{ dose.administration!.timing }}
            </span>
          </li>
        </ul>
      </div>
    </div>

    <TsDoseDialog :open="doseOpen" :target="doseTarget" @close="doseOpen = false" />
  </DsPanel>
</template>
