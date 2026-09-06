<script setup lang="ts">
import { api } from '../../../convex/_generated/api'
import { formatMinutes } from '~/utils/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'vue-sonner'

/**
 * The rounds this shift repeats, as the hours they belong to.
 *
 * "Due in 24 minutes" is the honest answer to a rolling interval and the wrong
 * one to give a shift. Staff hand over by saying which hours are accounted for
 * — "the nine o'clock is done, I never got to the ten" — so the card shows the
 * shift as slots and colours each one. It also makes a gap visible *after* the
 * fact, which a countdown cannot: once the next round is walked, an interval
 * has no memory that the one before it was skipped.
 *
 * Frequencies are per site, set by managers in Buildings → Settings → Rounds.
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

const SLOT: Record<string, { class: string; title: (t: string) => string }> = {
  done: {
    class: 'border-transparent bg-[var(--emerald-600)] text-white',
    title: (t) => `${t} — walked`,
  },
  missed: {
    class: 'border-transparent bg-[var(--red-600)] text-white',
    title: (t) => `${t} — missed`,
  },
  now: {
    class: 'border-[var(--amber-600)] bg-[var(--amber-50)] text-[var(--amber-700)] font-bold',
    title: (t) => `${t} — due now`,
  },
  upcoming: {
    class: 'border-[var(--border-subtle)] bg-[var(--surface-sunken)] text-[var(--text-subtle)]',
    title: (t) => `${t} — later this shift`,
  },
}

/** `480` → `8`, `570` → `9:30`. The hour is the label; minutes only when they matter. */
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
  <Card>
    <CardContent class="flex h-full flex-col gap-4 p-5">
      <div class="flex items-baseline justify-between gap-2">
        <span class="eyebrow">Running rounds</span>
        <span v-if="data?.shift" class="text-xs text-muted-foreground">{{ data.shift.hours }}</span>
      </div>

      <div v-if="isLoading" class="flex flex-col gap-4">
        <div v-for="i in 3" :key="i" class="flex flex-col gap-2">
          <Skeleton class="h-3.5 w-32" />
          <Skeleton class="h-7 w-full" />
        </div>
      </div>

      <div v-else-if="!data?.rows.length" class="text-sm text-muted-foreground">
        No rounds are switched on for this site.
      </div>

      <div v-else class="flex flex-col gap-4">
        <div v-for="row in data.rows" :key="row.routine" class="flex flex-col gap-1.5">
          <div class="flex items-center gap-2">
            <DsIcon :name="row.icon" :size="15" class="shrink-0 text-muted-foreground" />
            <span class="truncate text-sm font-semibold text-[var(--text-strong)]">
              {{ row.label }}
            </span>
            <span class="shrink-0 text-xs text-muted-foreground">every {{ every(row.everyMinutes) }}</span>
            <span class="flex-1" />
            <span
              v-if="row.missed"
              class="tnum shrink-0 text-xs font-bold text-[var(--red-600)]"
            >
              {{ row.missed }} missed
            </span>
            <span v-else class="tnum shrink-0 text-xs text-muted-foreground">
              {{ row.done }}/{{ row.total }}
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-1">
            <span
              v-for="slot in row.slots"
              :key="slot.startMinutes"
              class="tnum inline-flex h-6 min-w-[26px] items-center justify-center rounded-sm border px-1.5 text-[11px] leading-none"
              :class="SLOT[slot.status]!.class"
              :title="SLOT[slot.status]!.title(formatMinutes(slot.startMinutes))"
            >
              {{ slotLabel(slot.startMinutes) }}
            </span>

            <Button
              size="sm"
              variant="ghost"
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
    </CardContent>
  </Card>
</template>
