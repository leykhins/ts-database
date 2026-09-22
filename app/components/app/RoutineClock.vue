<script setup lang="ts">
import { api } from '../../../convex/_generated/api'
import { formatMinutes } from '~/utils/format'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'vue-sonner'

/**
 * Running rounds, read as a clock.
 *
 * The slot strip alone answers "how is the shift going" but not "what is
 * happening now" — an hour number is a label, not a time, and a worker glancing
 * up mid-task wants the second thing. So each round leads with the live hour
 * spelled out and dotted, with the strip beneath it for the shape of the shift.
 *
 * Medication is the one round that is not a frequency. Its chips are the
 * times this building's residents are actually due, read from the MAR, and it
 * carries a dose count as well — rounds and the perimeter are the same
 * building every time, and fifteen doses is a different job from three.
 */
const { selected } = useSelectedBuilding()
const { can, denied } = useMe()
const now = useNow()
const tz = new Date().getTimezoneOffset()

const { data, isLoading } = useConvexQuery(api.routines.board, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
  now: now.value,
  tzOffsetMinutes: tz,
}))

const { mutate: complete } = useConvexMutation(api.routines.complete)
const pending = ref<string | null>(null)

const SLOT: Record<string, string> = {
  done: 'border-transparent bg-[var(--emerald-600)] text-[var(--text-on-accent)]',
  missed: 'border-transparent bg-[var(--red-600)] text-[var(--text-on-accent)]',
  now: 'border-[var(--amber-600)] bg-[var(--amber-50)] font-bold text-[var(--amber-700)]',
  upcoming: 'border-[var(--border-subtle)] bg-[var(--surface-sunken)] text-[var(--text-subtle)]',
}

/** `480` → `8`, `570` → `9:30`. The hour is the label inside the strip. */
function slotLabel(startMinutes: number): string {
  const h24 = Math.floor(startMinutes / 60) % 24
  const m = startMinutes % 60
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return m === 0 ? String(h) : `${h}:${String(m).padStart(2, '0')}`
}

function every(mins: number): string {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** The hour a round is inside right now — or the next one, out of hours. */
function liveSlot(row: { slots: { startMinutes: number; status: string }[] }) {
  return (
    row.slots.find((s) => s.status === 'now')
    ?? row.slots.find((s) => s.status === 'upcoming')
    ?? null
  )
}

type Row = NonNullable<typeof data.value>['rows'][number]

/**
 * What a chip means, in the vocabulary of the round it belongs to: the
 * building rounds are walked, medication is charted dose by dose.
 */
function slotTitle(
  row: Row,
  // `due` and `charted` ride along on the medication slots only, so they are
  // optional here rather than forcing every caller through a discriminant.
  slot: { startMinutes: number; status: string; due?: number; charted?: number },
): string {
  const at = formatMinutes(slot.startMinutes)
  if (row.cadence !== 'orders') {
    const state =
      slot.status === 'done' ? 'walked'
      : slot.status === 'missed' ? 'missed'
      : slot.status === 'now' ? 'due now'
      : 'later this shift'
    return `${at} — ${state}`
  }

  const due = slot.due ?? 0
  const charted = slot.charted ?? 0
  const doses = `${due} dose${due === 1 ? '' : 's'}`
  if (slot.status === 'done') return `${at} — ${doses}, all charted`
  if (slot.status === 'missed') return `${at} — ${due - charted} of ${doses} never charted`
  if (slot.status === 'now') return `${at} — ${due - charted} of ${doses} still to give`
  return `${at} — ${doses} due later this shift`
}

async function log(routine: 'rounds' | 'perimeter' | 'meds', label: string) {
  pending.value = routine
  try {
    const result = await complete({
      ...(selected.value ? { buildingId: selected.value } : {}),
      routine,
      tzOffsetMinutes: tz,
    })
    toast.success(`${result.label} logged`, {
      description:
        result.slotStartMinutes === null
          ? 'Recorded outside this shift’s rounds.'
          : `Filled the ${formatMinutes(result.slotStartMinutes)} slot.`,
    })
  } catch (e) {
    toast.error(`Could not log ${label.toLowerCase()}`, { description: (e as Error).message })
  } finally {
    pending.value = null
  }
}
</script>

<template>
  <DsPanel title="Running rounds" subtitle="Walked on the hour, logged as you go.">
    <template #action>
      <span v-if="data?.shift" class="text-xs text-muted-foreground">{{ data.shift.hours }}</span>
    </template>

    <div class="flex h-full flex-col gap-4">
      <div v-if="isLoading" class="flex flex-col gap-4">
        <div v-for="i in 3" :key="i" class="flex flex-col gap-2">
          <Skeleton class="h-3.5 w-40" />
          <Skeleton class="h-6 w-full" />
        </div>
      </div>

      <div v-else-if="!data?.rows.length" class="text-sm text-muted-foreground">
        No rounds are switched on for this site.
      </div>

      <div v-else class="flex flex-col gap-3.5">
        <div v-for="row in data.rows" :key="row.routine" class="flex flex-col gap-1.5">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <DsIcon :name="row.icon" :size="15" class="shrink-0 text-muted-foreground" />
            <span class="truncate text-sm font-semibold text-[var(--text-strong)]">
              {{ row.label }}
            </span>
            <span class="shrink-0 text-xs text-muted-foreground">
              {{ row.cadence === 'orders' ? 'from resident orders' : `every ${every(row.everyMinutes)}` }}
            </span>

            <span class="flex-1" />

            <!--
              The hour it is in, spelled out, with the dot marking it live.

              "Next" is not decoration: once the current hour has been walked
              there is no live slot, and a bare "6:00 pm" beside a dot would
              read as due-now to somebody glancing at it at a quarter past five.
            -->
            <span
              v-if="liveSlot(row)"
              class="tnum inline-flex shrink-0 items-center gap-1.5 text-xs font-bold"
              :class="
                liveSlot(row)!.status === 'now'
                  ? 'text-[var(--amber-700)]'
                  : 'text-muted-foreground'
              "
            >
              <span
                class="size-1.5 rounded-full"
                :class="liveSlot(row)!.status === 'now' && 'ts-pulse'"
                :style="{
                  background:
                    liveSlot(row)!.status === 'now' ? 'var(--amber-500)' : 'var(--slate-400)',
                }"
              />
              <span v-if="liveSlot(row)!.status !== 'now'" class="font-medium opacity-70">next</span>
              {{ formatMinutes(liveSlot(row)!.startMinutes) }}
            </span>
          </div>

          <!-- Medication is the one round whose size is a number of doses. -->
          <NuxtLink
            v-if="row.subjectCount !== null"
            to="/medications"
            class="flex items-center gap-1.5 text-xs text-muted-foreground hover:underline"
          >
            <DsIcon name="pill" :size="13" class="text-[var(--violet-600)]" />
            <span class="tnum font-semibold text-[var(--text-body)]">{{ row.subjectCount }}</span>
            dose{{ row.subjectCount === 1 ? '' : 's' }} due this shift · open the MAR
          </NuxtLink>

          <div class="flex flex-wrap items-center gap-1">
            <span
              v-for="slot in row.slots"
              :key="slot.startMinutes"
              class="tnum inline-flex h-6 min-w-[26px] items-center justify-center rounded-sm border px-1.5 text-[11px] leading-none"
              :class="SLOT[slot.status]"
              :title="slotTitle(row, slot)"
            >
              {{ slotLabel(slot.startMinutes) }}
            </span>

            <!--
              Medication has nothing to log here. Its slots are the MAR's own
              dose times, and each dose is charted against the resident it was
              given to — a "walked" tick beside that would be a second, vaguer
              claim about the same work.
            -->
            <NuxtLink
              v-if="row.cadence === 'orders'"
              to="/medications"
              class="ml-auto inline-flex h-6 items-center gap-1 rounded-sm px-2 text-xs font-semibold text-[var(--brand)] hover:underline"
            >
              <DsIcon name="pill" :size="13" />
              Chart
            </NuxtLink>
            <Button
              v-else
              size="sm"
              variant="soft"
              class="ml-auto h-6 px-2 text-xs"
              :loading="pending === row.routine"
              :disabled="!can('checks')"
              :title="denied('checks') ?? `Log ${row.label.toLowerCase()} as walked now`"
              @click="log(row.routine, row.label)"
            >
              <DsIcon v-if="pending !== row.routine" name="check" :size="13" />
              Log
            </Button>
          </div>
        </div>
      </div>
    </div>
  </DsPanel>
</template>
