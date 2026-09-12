<script setup lang="ts">
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * TEMPORARY — a side-by-side of the de-duplicated Care Console.
 *
 * Renders only the two regions under discussion, the hero row and the shift
 * board, against the same subscriptions the real page uses. Everything below
 * them on `/care` is unchanged and deliberately not reproduced here: a
 * nine-hundred-line copy would drift out of sync with the original within a
 * day, and the comparison is about these two regions.
 *
 * Delete this file once the design is chosen and folded into `index.vue`.
 */
const { selected } = useSelectedBuilding()
const { can, denied } = useMe()

const now = ref(Date.now())
const tz = new Date().getTimezoneOffset()
const timer = setInterval(() => (now.value = Date.now()), 60_000)
onScopeDispose(() => clearInterval(timer))

const { data, isLoading } = useConvexQuery(api.care.overview, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
  now: now.value,
  tzOffsetMinutes: tz,
}))

usePageHeader(() => ({
  eyebrow: data.value ? `${data.value.building.name} · ${data.value.current.label}` : '',
  title: 'Care Console — preview',
}))

const checkTarget = ref<{
  tenantId: Id<'tenants'>
  name: string
  room: string
  photoUrl?: string | null
  supportLevel?: string
  critical?: boolean
  reason?: string
} | null>(null)

function openCheck(row: {
  tenantId: Id<'tenants'>
  name: string
  room: string
  photoUrl?: string | null
  supportLevel?: string
  critical?: boolean
  reason?: string
}) {
  checkTarget.value = row
}

const indexColor = computed(() => {
  const score = data.value?.wellnessIndex.score ?? 0
  return score >= 80 ? 'var(--emerald-600)' : score >= 65 ? 'var(--amber-500)' : 'var(--rose-600)'
})

const RING = { size: 132, stroke: 11 }
const ringRadius = (RING.size - RING.stroke) / 2
const ringCircumference = 2 * Math.PI * ringRadius
const ringOffset = computed(
  () => ringCircumference * (1 - (data.value?.wellnessIndex.score ?? 0) / 100),
)

/**
 * The live segment carries its checks; the others carry a summary only.
 *
 * A miss on an earlier shift is already told twice over — by the Wellness
 * Index, which weights an unseen resident, and by the flagged list, which names
 * anyone off the round for two segments. Printing another shift's roster a
 * third time adds no signal, and it added eighty-four buttons that could not be
 * clicked.
 */
const liveSegment = computed(() => data.value?.board.find((s) => s.state === 'current') ?? null)
const otherSegments = computed(() => data.value?.board.filter((s) => s.state !== 'current') ?? [])

function segmentNote(segment: { state: string; done: number; missed: number }): string {
  if (segment.state === 'upcoming') {
    return segment.done ? `${segment.done} logged early` : 'Starts later today'
  }
  return segment.missed ? `${segment.missed} missed` : 'All checked'
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-[var(--amber-500)]/50 bg-[var(--amber-50)] px-4 py-2.5">
      <DsIcon name="info" :size="17" class="text-[var(--amber-700)]" />
      <span class="text-sm text-[var(--amber-700)]">
        Preview of the de-duplicated hero and shift board. The panels below these
        on the real console are unchanged and not shown here.
      </span>
      <NuxtLink to="/care" class="ml-auto text-sm font-semibold text-[var(--text-link)] hover:underline">
        Open the current console →
      </NuxtLink>
    </div>

    <TsLoadingState v-if="isLoading" label="Loading the shift…" :rows="6" />

    <DsEmptyState
      v-else-if="!data"
      icon="clipboard-check"
      title="No building selected"
      description="Pick a building from the switcher to see its shift."
    />

    <template v-else>
      <!--
        Hero: one question per card. How am I doing, what do I do next, which
        hours are covered. Nothing is stated in two of them.
      -->
      <div class="grid items-start gap-5 [grid-template-columns:repeat(auto-fit,minmax(290px,1fr))]">
        <!-- How am I doing -->
        <Card>
          <CardContent class="flex flex-col gap-4 p-5">
            <div class="flex items-center justify-between gap-2">
              <span class="eyebrow">Wellness Index</span>
              <Badge
                :variant="
                  data.wellnessIndex.score >= 80
                    ? 'success'
                    : data.wellnessIndex.score >= 65
                      ? 'warning'
                      : 'danger'
                "
                dot
              >
                {{ data.wellnessIndex.band }}
              </Badge>
            </div>

            <div class="flex items-center gap-4">
              <div class="relative shrink-0" :style="{ width: `${RING.size}px`, height: `${RING.size}px` }">
                <svg :width="RING.size" :height="RING.size" class="-rotate-90">
                  <circle
                    :cx="RING.size / 2"
                    :cy="RING.size / 2"
                    :r="ringRadius"
                    fill="none"
                    stroke="var(--surface-sunken)"
                    :stroke-width="RING.stroke"
                  />
                  <circle
                    :cx="RING.size / 2"
                    :cy="RING.size / 2"
                    :r="ringRadius"
                    fill="none"
                    :stroke="indexColor"
                    :stroke-width="RING.stroke"
                    stroke-linecap="round"
                    :stroke-dasharray="ringCircumference"
                    :stroke-dashoffset="ringOffset"
                    class="transition-[stroke-dashoffset] duration-500"
                  />
                </svg>
                <div class="absolute inset-0 flex flex-col items-center justify-center">
                  <span class="tnum text-[38px] font-extrabold leading-none tracking-tight text-[var(--text-strong)]">
                    {{ data.wellnessIndex.score }}
                  </span>
                  <span class="mt-0.5 text-2xs text-[var(--text-subtle)]">/ 100</span>
                </div>
              </div>

              <!--
                One line, showing the worst thing outstanding.

                The original named the critical rooms here — `101, 109, 118` —
                which the queue beside it already names in full, with faces. The
                count is the part worth keeping: critically-unwell residents
                *not yet seen* is a different, smaller set than the watch list
                further down the page, and dropping it entirely (as the first
                draft of this preview did) traded a real alarm for "nobody is
                overdue", which is true and says nothing early in a shift.
              -->
              <div class="flex min-w-0 flex-col gap-2">
                <p class="text-sm text-muted-foreground">
                  Residents seen inside their check window.
                  <strong class="text-[var(--text-strong)]">
                    {{ data.wellnessIndex.seen }}/{{ data.wellnessIndex.total }}
                  </strong>
                  this shift.
                </p>
                <div
                  v-if="data.wellnessIndex.criticalUnseen.length"
                  class="flex items-center gap-1.5 text-sm font-semibold text-[var(--rose-600)]"
                >
                  <DsIcon name="heart-pulse" :size="14" />
                  {{ data.wellnessIndex.criticalUnseen.length }} critical not yet seen
                </div>
                <div
                  v-else-if="data.live.overdue"
                  class="flex items-center gap-1.5 text-sm font-semibold text-[var(--rose-600)]"
                >
                  <DsIcon name="alert-circle" :size="14" />
                  {{ data.live.overdue }} past their window
                </div>
                <div v-else class="flex items-center gap-1.5 text-sm text-[var(--success)]">
                  <DsIcon name="check-circle-2" :size="14" />
                  Every critical resident has been seen.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- What do I do next -->
        <Card>
          <CardContent class="flex h-full flex-col gap-3 p-5">
            <!--
              No backlog count here. `queue.length` is the same number the live
              shift card already prints as "N to go" — it is the same set of
              checks counted twice. This card is about the next three, not the
              size of the pile.
            -->
            <span class="eyebrow inline-flex items-center gap-1.5">
              <DsIcon name="arrow-right" :size="13" class="text-[var(--brand-strong)]" />
              Do this next
            </span>

            <p v-if="!data.queue.length" class="flex items-center gap-2 text-sm text-[var(--success)]">
              <DsIcon name="check-circle-2" :size="16" />
              Every resident has been seen this shift.
            </p>

            <div
              v-for="(row, i) in data.queue.slice(0, 3)"
              :key="row.tenantId"
              class="flex items-center gap-3 rounded-md border p-3"
              :class="
                i === 0
                  ? row.overdue
                    ? 'border-[var(--rose-600)]/40 bg-[var(--rose-50)]'
                    : 'border-[var(--brand)] bg-[var(--brand-soft)]'
                  : 'border-transparent bg-[var(--surface-sunken)]'
              "
            >
              <span
                class="tnum inline-flex size-[30px] shrink-0 items-center justify-center rounded-sm text-xs font-bold text-white"
                :style="{ background: row.overdue ? 'var(--rose-600)' : 'var(--brand)' }"
              >
                {{ row.room }}
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5">
                  <span class="truncate text-sm font-semibold text-[var(--text-strong)]">
                    {{ row.name }}
                  </span>
                  <DsIcon
                    v-if="row.critical"
                    name="heart-pulse"
                    :size="13"
                    class="text-[var(--rose-600)]"
                  />
                </span>
                <span
                  class="block truncate text-xs"
                  :class="row.overdue ? 'font-semibold text-[var(--rose-600)]' : 'text-[var(--text-subtle)]'"
                >
                  {{ row.overdue ? 'Overdue · ' : '' }}{{ row.reason }}
                </span>
              </span>
              <Button
                size="sm"
                :variant="row.overdue ? 'destructive' : 'primary'"
                :disabled="!can('wellness')"
                :title="denied('wellness') ?? undefined"
                @click="openCheck(row)"
              >
                <DsIcon name="check" :size="15" />
                Check
              </Button>
            </div>
          </CardContent>
        </Card>

        <!-- Which hours are covered -->
        <TsRoutineStrip />
      </div>

      <!-- ------------------------------------------------------ Shift board -->
      <Card v-if="liveSegment" class="gap-0 overflow-hidden border-[var(--brand)] p-0 shadow-[0_8px_24px_color-mix(in_srgb,var(--brand)_16%,transparent)]">
        <div class="flex items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--brand-soft)] p-4">
          <span class="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-[var(--brand)] text-white">
            <DsIcon :name="liveSegment.icon" :size="21" :stroke-width="2" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="font-semibold text-[var(--text-strong)]">{{ liveSegment.label }}</div>
            <div class="text-xs text-muted-foreground">{{ liveSegment.hours }}</div>
          </div>
          <Badge variant="solid" dot>Live now</Badge>
        </div>

        <div class="flex flex-col gap-4 p-5">
          <div class="flex items-baseline gap-2">
            <span class="tnum text-2xl font-extrabold tracking-tight text-[var(--text-strong)]">
              {{ liveSegment.done }}
            </span>
            <span class="tnum text-lg font-semibold text-[var(--text-subtle)]">
              / {{ liveSegment.total }}
            </span>
            <span class="ml-auto text-xs font-bold text-[var(--brand-strong)]">
              {{ liveSegment.pending }} to go
            </span>
          </div>

          <div class="h-2 overflow-hidden rounded-full bg-[var(--slate-200)]">
            <div
              class="h-full rounded-full bg-[var(--brand)] transition-[width] duration-500"
              :style="{ width: liveSegment.total ? `${(liveSegment.done / liveSegment.total) * 100}%` : '0%' }"
            />
          </div>

          <div>
            <span class="eyebrow mb-2 block">Wellness checks</span>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="check in liveSegment.checks"
                :key="check.tenantId"
                type="button"
                class="tnum inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-bold transition-colors"
                :class="{
                  'bg-[var(--green-50)] text-[var(--green-700)]': check.status === 'done',
                  'bg-[var(--red-50)] text-[var(--red-600)]': check.status === 'missed',
                  'bg-[var(--slate-100)] text-muted-foreground': check.status === 'pending',
                }"
                :title="`${check.room} · ${check.name}${check.outcome ? ` · ${check.outcome}` : ''}`"
                @click="openCheck(check)"
              >
                <span
                  class="size-1.5 rounded-full"
                  :style="{
                    background:
                      check.status === 'done'
                        ? 'var(--green-500)'
                        : check.status === 'missed'
                          ? 'var(--red-500)'
                          : 'var(--slate-400)',
                  }"
                />
                {{ check.room }}
              </button>
            </div>
          </div>
        </div>
      </Card>

      <!--
        The rest of the day, as coverage rather than as rosters. One row each,
        no chips: which shift it was, how much of it got done, and whether
        anything was left behind.
      -->
      <Card>
        <CardContent class="flex flex-col gap-3 p-5">
          <span class="eyebrow">The rest of today</span>

          <div
            v-for="segment in otherSegments"
            :key="segment.key + segment.shiftDate"
            class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--border-subtle)] pt-3 first:border-0 first:pt-0"
          >
            <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--surface-sunken)] text-muted-foreground">
              <DsIcon :name="segment.icon" :size="18" :stroke-width="2" />
            </span>

            <div class="min-w-[130px]">
              <div class="text-sm font-semibold text-[var(--text-strong)]">{{ segment.label }}</div>
              <div class="text-xs text-muted-foreground">{{ segment.hours }}</div>
            </div>

            <div class="flex min-w-[120px] flex-1 items-center gap-3">
              <span class="tnum shrink-0 text-sm font-semibold text-[var(--text-strong)]">
                {{ segment.done }}<span class="text-[var(--text-subtle)]">/{{ segment.total }}</span>
              </span>
              <div class="h-1.5 min-w-[60px] flex-1 overflow-hidden rounded-full bg-[var(--slate-200)]">
                <div
                  class="h-full rounded-full"
                  :style="{
                    width: segment.total ? `${(segment.done / segment.total) * 100}%` : '0%',
                    background:
                      segment.state === 'upcoming'
                        ? 'var(--slate-300)'
                        : segment.missed
                          ? 'var(--amber-500)'
                          : 'var(--green-500)',
                  }"
                />
              </div>
            </div>

            <span
              class="shrink-0 text-xs font-semibold"
              :class="segment.missed ? 'text-[var(--amber-700)]' : 'text-muted-foreground'"
            >
              {{ segmentNote(segment) }}
            </span>
          </div>
        </CardContent>
      </Card>
    </template>

    <TsLogCheckDialog
      :open="!!checkTarget"
      :resident="checkTarget"
      @close="checkTarget = null"
    />
  </div>
</template>
