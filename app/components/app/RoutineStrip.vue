<script setup lang="ts">
import { api } from '../../../convex/_generated/api'
import { formatMinutes } from '~/utils/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'vue-sonner'

/**
 * The rounds this shift repeats — building rounds, the perimeter, medication.
 *
 * One row each, with the button that logs it. The point of putting the action
 * on the same line as the countdown is that the round gets logged when it is
 * walked rather than remembered at the end of the shift, which is the whole
 * difference between a record and a guess.
 */
const { selected } = useSelectedBuilding()
const { can, denied } = useMe()
const now = useNow()

const { data, isLoading } = useConvexQuery(api.routines.board, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
  now: now.value,
}))

const { mutate: complete } = useConvexMutation(api.routines.complete)

const pending = ref<string | null>(null)

const STATE: Record<string, { color: string; tint: string }> = {
  overdue: { color: 'var(--red-600)', tint: 'var(--red-50)' },
  due: { color: 'var(--amber-600)', tint: 'var(--amber-50)' },
  ok: { color: 'var(--emerald-600)', tint: 'var(--emerald-50)' },
}

/** "due in 24 min" / "18 min late" — the same field, read from either side. */
function timing(row: { status: string; dueAt: number; minutesLate: number; lastAt: number | null }) {
  if (row.status === 'overdue') return `${span(row.minutesLate)} late`
  if (row.status === 'due') return row.lastAt === null ? 'Never logged' : 'Due now'
  return `Due in ${span(Math.max(0, Math.round((row.dueAt - now.value) / 60_000)))}`
}

function span(mins: number): string {
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function clock(ts: number | null): string {
  return ts === null ? '—' : formatMinutes(new Date(ts).getHours() * 60 + new Date(ts).getMinutes())
}

async function log(routine: 'rounds' | 'perimeter' | 'meds') {
  pending.value = routine
  try {
    const result = await complete({
      ...(selected.value ? { buildingId: selected.value } : {}),
      routine,
    })
    toast.success(`${result.label} logged`, {
      description:
        result.minutesLate > 0
          ? `${span(result.minutesLate)} past due — recorded as late.`
          : 'On time.',
    })
  } catch (e) {
    toast.error('Could not log that round', { description: (e as Error).message })
  } finally {
    pending.value = null
  }
}
</script>

<template>
  <Card>
    <CardContent class="p-0">
      <div class="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 md:px-5">
        <DsIcon name="clock" :size="17" class="text-muted-foreground" />
        <span class="text-sm font-bold text-[var(--text-strong)]">Running rounds</span>
        <span class="text-xs text-muted-foreground">Log each one as you walk it</span>
      </div>

      <div v-if="isLoading" class="space-y-3 p-4 md:p-5">
        <div v-for="i in 3" :key="i" class="flex items-center gap-3">
          <Skeleton class="size-9 shrink-0 rounded-sm" />
          <Skeleton class="h-3.5 flex-1" />
          <Skeleton class="h-8 w-24 rounded-md" />
        </div>
      </div>

      <div
        v-for="row in data?.rows ?? []"
        v-else
        :key="row.routine"
        class="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-border/60 px-4 py-3.5 last:border-b-0 md:px-5"
      >
        <span
          class="inline-flex size-9 shrink-0 items-center justify-center rounded-sm"
          :style="{ color: STATE[row.status]!.color, background: STATE[row.status]!.tint }"
        >
          <DsIcon :name="row.icon" :size="18" :stroke-width="1.9" />
        </span>

        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-2">
            <span class="text-[15px] font-semibold text-[var(--text-strong)]">{{ row.label }}</span>
            <span
              class="text-xs font-semibold"
              :style="{ color: STATE[row.status]!.color }"
            >
              {{ timing(row) }}
            </span>
          </span>
          <span class="mt-0.5 block text-xs text-muted-foreground">
            <template v-if="row.lastAt">
              Last {{ clock(row.lastAt) }}{{ row.lastBy ? ` by ${row.lastBy}` : '' }} · every {{ span(row.everyMinutes) }}
            </template>
            <template v-else>{{ row.detail }}</template>
          </span>
        </span>

        <Button
          size="sm"
          :variant="row.status === 'ok' ? 'secondary' : 'default'"
          :loading="pending === row.routine"
          :disabled="!can('checks')"
          :title="denied('checks')"
          @click="log(row.routine)"
        >
          <DsIcon v-if="pending !== row.routine" name="check" :size="15" />
          Log now
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
