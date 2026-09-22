<script setup lang="ts">
import type { ShiftKey } from '../../../convex/shifts'
import { SHIFTS } from '../../../convex/shifts'
import { formatDate } from '~/utils/format'

/**
 * ShiftHeatmap — one month of a worker's shifts, as a calendar.
 *
 * A worker looking for an old report remembers a day ("the Tuesday I covered
 * the overnight"), so the way in is a calendar rather than a list. Each cell
 * is a day; how dark it is says how many shifts were filed on it. The scale is
 * one hue, light to dark, because the question is "how much" — and the count
 * is spoken in the label as well, so the colour is never the only way to it.
 *
 * Tapping a day selects it and the page narrows to that day's reports.
 * Tapping it again clears the selection.
 */
const props = defineProps<{
  /** `YYYY-MM`. */
  month: string
  /** ISO day → the shifts filed that day. */
  days: Record<string, ShiftKey[]>
  /** ISO day, in the building's local time. Days after it are not worked yet. */
  today: string
  selected: string | null
}>()

const emit = defineEmits<{ 'update:selected': [day: string | null] }>()

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const SHIFT_LABEL = Object.fromEntries(
  SHIFTS.map((s) => [s.key, s.label.replace(' Staff', '')]),
) as Record<ShiftKey, string>

type Cell =
  | { kind: 'pad'; key: string }
  | {
      kind: 'day'
      key: string
      date: string
      number: number
      count: number
      shifts: ShiftKey[]
      future: boolean
      today: boolean
    }

const cells = computed<Cell[]>(() => {
  const [y, m] = props.month.split('-').map(Number) as [number, number]
  // Local-time construction, so the first-weekday maths never crosses a
  // midnight in UTC and lands the 1st on the wrong column.
  const first = new Date(y, m - 1, 1)
  const daysInMonth = new Date(y, m, 0).getDate()

  const out: Cell[] = []
  for (let i = 0; i < first.getDay(); i++) out.push({ kind: 'pad', key: `pad-${i}` })
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${props.month}-${String(d).padStart(2, '0')}`
    const shifts = props.days[date] ?? []
    out.push({
      kind: 'day',
      key: date,
      date,
      number: d,
      count: shifts.length,
      shifts,
      future: date > props.today,
      today: date === props.today,
    })
  }
  return out
})

/** One hue, light to dark. 3 is the ceiling: a day has three shifts. */
const TONE = [
  { bg: 'var(--surface-sunken)', fg: 'var(--text-subtle)' },
  { bg: 'var(--green-100)', fg: 'var(--green-700)' },
  { bg: 'var(--green-500)', fg: '#ffffff' },
  { bg: 'var(--green-700)', fg: '#ffffff' },
] as const

const tone = (count: number) => TONE[Math.min(count, TONE.length - 1)]!

function describe(cell: Extract<Cell, { kind: 'day' }>): string {
  if (cell.future) return `${formatDate(cell.date)} — not yet`
  if (!cell.count) return `${formatDate(cell.date)} — no shift`
  const names = cell.shifts.map((s) => SHIFT_LABEL[s]).join(', ')
  return `${formatDate(cell.date)} — ${cell.count} ${cell.count === 1 ? 'shift' : 'shifts'}: ${names}`
}

function toggle(cell: Extract<Cell, { kind: 'day' }>) {
  if (cell.future) return
  emit('update:selected', props.selected === cell.date ? null : cell.date)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="grid grid-cols-7 gap-1.5" role="grid" :aria-label="`Shifts worked, ${month}`">
      <span
        v-for="day in WEEKDAYS"
        :key="day"
        role="columnheader"
        class="pb-1 text-center text-[11px] font-semibold tracking-wide text-[var(--text-subtle)] uppercase"
      >
        {{ day }}
      </span>

      <template v-for="cell in cells" :key="cell.key">
        <span v-if="cell.kind === 'pad'" aria-hidden="true" />
        <button
          v-else
          type="button"
          role="gridcell"
          :aria-label="describe(cell)"
          :aria-pressed="selected === cell.date"
          :title="describe(cell)"
          :disabled="cell.future"
          class="tnum relative flex aspect-square items-center justify-center rounded-md text-sm font-semibold transition-[box-shadow,transform] outline-none focus-visible:shadow-[var(--focus-ring)] disabled:cursor-default"
          :class="[
            cell.future ? 'border border-dashed border-[var(--border-subtle)] text-[var(--text-subtle)]/60' : 'hover:scale-[1.04]',
            selected === cell.date ? 'ring-2 ring-[var(--brand)] ring-offset-2 ring-offset-[var(--surface-card)]' : '',
            cell.today && selected !== cell.date ? 'ring-1 ring-[var(--border-strong)]' : '',
          ]"
          :style="cell.future ? undefined : { background: tone(cell.count).bg, color: tone(cell.count).fg }"
          @click="toggle(cell)"
        >
          {{ cell.number }}
        </button>
      </template>
    </div>

    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span
        v-for="(t, i) in TONE"
        :key="i"
        class="inline-flex items-center gap-1.5"
      >
        <span class="inline-block size-3 rounded-[3px]" :style="{ background: t.bg }" />
        {{ i === 0 ? 'No shift' : `${i} ${i === 1 ? 'shift' : 'shifts'}` }}
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="inline-block size-3 rounded-[3px] ring-1 ring-[var(--border-strong)]" />
        Today
      </span>
    </div>
  </div>
</template>
