<script setup lang="ts">
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { formatShortDate } from '~/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * Care Console — the shift home for Resident Support Workers, Wellness Workers
 * and Home Support Workers.
 *
 * The operations dashboard answers "how is this building doing". This answers
 * the question a worker actually has at 6:40 pm: who have I not laid eyes on,
 * and what do I do next. Two layouts, as designed — the whole board when you
 * are taking over, your own shift when you are working it.
 */
const { selected } = useSelectedBuilding()
const { me, can, denied } = useMe()

// A query is not re-run because the clock moved, so the client owns the clock.
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
  title: 'Care Console',
}))

const { mutate: setDuty } = useConvexMutation(api.care.setDuty)
const { mutate: startReport, pending: starting } = useConvexMutation(api.shiftReports.start)

const layout = ref<'board' | 'shift'>('board')

/**
 * Critical needs, banned guests and tonight's overnight approvals share one
 * card. All three are "who to watch out for", and the page already carries
 * enough cards without three more.
 */
const watchTab = ref<'critical' | 'banned' | 'overnight'>('critical')

const { data: desk } = useConvexQuery(api.visitors.board, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
  now: now.value,
  tzOffsetMinutes: tz,
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

const LEVEL_COLOR: Record<string, string> = {
  independent: 'var(--green-600)',
  moderate: 'var(--amber-500)',
  high: 'var(--amber-600)',
  critical: 'var(--red-600)',
}

const ACCENT: Record<string, string> = {
  blue: 'var(--blue-600)',
  teal: 'var(--teal-600)',
  violet: 'var(--violet-600)',
}

const indexColor = computed(() => {
  const score = data.value?.wellnessIndex.score ?? 0
  return score >= 80 ? 'var(--emerald-600)' : score >= 65 ? 'var(--amber-500)' : 'var(--rose-600)'
})

/** Stroke offset for the index ring. */
const RING = { size: 132, stroke: 11 }
const ringRadius = (RING.size - RING.stroke) / 2
const ringCircumference = 2 * Math.PI * ringRadius
const ringOffset = computed(
  () => ringCircumference * (1 - (data.value?.wellnessIndex.score ?? 0) / 100),
)

const liveSegment = computed(() => data.value?.board.find((s) => s.state === 'current') ?? null)

const dutiesDone = computed(() => {
  const state = data.value?.me.dutyState ?? {}
  return (data.value?.me.duties ?? []).filter((d) => state[d.key]).length
})

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

async function toggleDuty(key: string, done: boolean) {
  const reportId = data.value?.me.reportId
  if (!reportId) {
    await openReport()
    return
  }
  await setDuty({ reportId, duty: key, done })
}

async function openReport() {
  const buildingId = data.value?.building._id
  if (!buildingId) return
  await startReport({ buildingId, now: Date.now(), tzOffsetMinutes: tz })
  await navigateTo('/care/report')
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <DsSectionHeader
      :eyebrow="data ? `${data.current.label} · ${data.building.name}` : undefined"
      title="Care Console"
      description="Who has been seen this shift, who is overdue, and what this role has to finish before handover."
    >
      <template #actions>
        <Button
          variant="secondary"
          :disabled="starting || !can('wellness')"
          :title="denied('wellness') ?? 'Log interactions and events, and finalize your shift'"
          @click="openReport"
        >
          <DsIcon name="file-text" :size="17" />
          {{ data?.me.reportId ? 'My shift report' : 'Start shift report' }}
          <Badge v-if="data?.me.entryCount" variant="neutral">{{ data.me.entryCount }}</Badge>
        </Button>
        <Tabs v-model="layout">
          <TabsList>
            <TabsTrigger value="board">Shift Board</TabsTrigger>
            <TabsTrigger value="shift">My Shift</TabsTrigger>
          </TabsList>
        </Tabs>
      </template>
    </DsSectionHeader>

    <TsLoadingState v-if="isLoading" label="Loading the shift…" :rows="6" />

    <DsEmptyState
      v-else-if="!data"
      icon="clipboard-check"
      title="No building selected"
      description="Pick a building from the switcher to see its shift."
    />

    <template v-else>
      <!-- ---------------------------------------------- Hero: index + brief -->
      <div class="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
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
                  {{ data.wellnessIndex.criticalUnseen.length }} critical unseen ·
                  {{ data.wellnessIndex.criticalUnseen.map((r) => r.room).join(', ') }}
                </div>
                <div v-else class="flex items-center gap-1.5 text-sm text-[var(--success)]">
                  <DsIcon name="check-circle-2" :size="14" />
                  Every critical resident has been seen.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent class="flex h-full flex-col gap-4 p-5">
            <div>
              <span class="eyebrow">Shift brief</span>
              <p class="mt-1.5 text-base leading-relaxed text-[var(--text-body)]">
                <strong class="text-[var(--text-strong)]">{{ data.live.pending }} checks left</strong>
                this shift<template v-if="data.live.overdue">,
                  <strong class="text-[var(--rose-600)]">{{ data.live.overdue }} overdue</strong>
                </template>.
                <template v-if="data.wellnessIndex.criticalUnseen.length">
                  <strong class="text-[var(--text-strong)]">
                    {{ data.wellnessIndex.criticalUnseen.length }} critical resident{{
                      data.wellnessIndex.criticalUnseen.length === 1 ? '' : 's'
                    }}
                  </strong>
                  still need eyes.
                </template>
                <template v-if="data.queue.length">
                  Start with
                  <strong class="text-[var(--text-strong)]">
                    Room {{ data.queue[0]!.room }} — {{ data.queue[0]!.name }}</strong>.
                </template>
              </p>
            </div>

            <div class="flex flex-wrap gap-2">
              <div class="flex items-center gap-2 rounded-md bg-[var(--surface-sunken)] px-3 py-2">
                <DsIcon name="clipboard-check" :size="17" />
                <span class="tnum text-sm font-semibold">{{ data.live.done }} / {{ data.live.total }}</span>
                <span class="text-xs text-muted-foreground">checks</span>
              </div>
              <div class="flex items-center gap-2 rounded-md bg-[var(--amber-50)] px-3 py-2 text-[var(--amber-700)]">
                <DsIcon name="flag" :size="17" />
                <span class="tnum text-sm font-semibold">{{ data.flagged.length }}</span>
                <span class="text-xs">flagged</span>
              </div>
              <div class="flex items-center gap-2 rounded-md bg-[var(--rose-50)] px-3 py-2 text-[var(--rose-700)]">
                <DsIcon name="heart-pulse" :size="17" />
                <span class="tnum text-sm font-semibold">{{ data.critical.length }}</span>
                <span class="text-xs">critical</span>
              </div>
            </div>

            <div class="mt-auto">
              <span class="eyebrow inline-flex items-center gap-1.5">
                <DsIcon name="arrow-right" :size="13" class="text-[var(--brand-strong)]" />
                Do this next
              </span>
              <div class="mt-2 flex flex-col gap-2">
                <div
                  v-for="(row, i) in data.queue.slice(0, 2)"
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
                <p v-if="!data.queue.length" class="flex items-center gap-2 text-sm text-[var(--success)]">
                  <DsIcon name="check-circle-2" :size="16" />
                  Every resident has been seen this shift.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- ------------------------------------------------------ Shift board -->
      <div
        v-if="layout === 'board'"
        class="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))] items-start"
      >
        <Card
          v-for="segment in data.board"
          :key="segment.key + segment.shiftDate"
          class="gap-0 overflow-hidden p-0"
          :class="segment.state === 'current' && 'border-[var(--brand)] shadow-[0_8px_24px_color-mix(in_srgb,var(--brand)_16%,transparent)]'"
        >
          <div
            class="flex items-center gap-3 border-b border-[var(--border-subtle)] p-4"
            :class="segment.state === 'current' && 'bg-[var(--brand-soft)]'"
          >
            <span
              class="inline-flex size-10 shrink-0 items-center justify-center rounded-md"
              :class="
                segment.state === 'current'
                  ? 'bg-[var(--brand)] text-white'
                  : 'bg-[var(--surface-sunken)] text-muted-foreground'
              "
            >
              <DsIcon :name="segment.icon" :size="21" :stroke-width="2" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="font-semibold text-[var(--text-strong)]">{{ segment.label }}</div>
              <div class="text-xs text-muted-foreground">{{ segment.hours }}</div>
            </div>
            <Badge v-if="segment.state === 'current'" variant="solid" dot>Live now</Badge>
            <Badge v-else-if="segment.state === 'upcoming' && !segment.done" variant="neutral" dot>
              Not started
            </Badge>
            <Badge v-else-if="segment.state === 'upcoming'" variant="info" dot>Logged early</Badge>
            <Badge v-else-if="segment.missed" variant="warning" dot>{{ segment.missed }} missed</Badge>
            <Badge v-else variant="success" dot>Complete</Badge>
          </div>

          <div class="flex flex-col gap-4 p-5">
            <div class="flex items-baseline gap-2">
              <span class="tnum text-2xl font-extrabold tracking-tight text-[var(--text-strong)]">
                {{ segment.done }}
              </span>
              <span class="tnum text-lg font-semibold text-[var(--text-subtle)]">
                / {{ segment.total }}
              </span>
              <span
                class="ml-auto text-xs font-bold"
                :class="segment.state === 'current' ? 'text-[var(--brand-strong)]' : 'text-muted-foreground'"
              >
                {{
                  segment.state === 'current'
                    ? `${segment.pending} to go`
                    : segment.state === 'upcoming'
                      ? segment.done
                        ? `${segment.done} logged early`
                        : 'Starts later today'
                      : segment.missed
                        ? `${segment.missed} missed`
                        : 'All checked'
                }}
              </span>
            </div>

            <div class="h-2 overflow-hidden rounded-full bg-[var(--slate-200)]">
              <div
                class="h-full rounded-full transition-[width] duration-500"
                :style="{
                  width: segment.total ? `${(segment.done / segment.total) * 100}%` : '0%',
                  background:
                    segment.state === 'current'
                      ? 'var(--brand)'
                      : segment.state === 'upcoming'
                        ? 'var(--slate-300)'
                        : segment.missed
                          ? 'var(--amber-500)'
                          : 'var(--green-500)',
                }"
              />
            </div>

            <div>
              <span class="eyebrow mb-2 block">Wellness checks</span>
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="check in segment.checks"
                  :key="check.tenantId"
                  type="button"
                  class="tnum inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-bold transition-colors"
                  :class="{
                    'bg-[var(--green-50)] text-[var(--green-700)]': check.status === 'done',
                    'bg-[var(--red-50)] text-[var(--red-600)]': check.status === 'missed',
                    'bg-[var(--slate-100)] text-muted-foreground': check.status === 'pending',
                  }"
                  :title="`${check.room} · ${check.name}${check.outcome ? ` · ${check.outcome}` : ''}`"
                  @click="segment.state === 'current' && openCheck(check)"
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
      </div>

      <!-- --------------------------------------------------- My shift list -->
      <Card v-else-if="liveSegment" class="gap-0 p-0">
        <div class="flex items-center gap-3 border-b border-[var(--border-subtle)] p-4">
          <span class="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-[var(--brand)] text-white">
            <DsIcon :name="liveSegment.icon" :size="21" :stroke-width="2" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="eyebrow">{{ liveSegment.hours }} · live</div>
            <div class="font-semibold text-[var(--text-strong)]">My shift — wellness checks</div>
          </div>
          <Badge variant="solid">{{ liveSegment.done }}/{{ liveSegment.total }} done</Badge>
        </div>

        <div class="flex flex-col p-5 pt-3">
          <div
            v-for="check in [...liveSegment.checks].sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done'))"
            :key="check.tenantId"
            class="flex items-center gap-3 border-b border-[var(--border-subtle)] py-2.5 last:border-0"
          >
            <span
              class="inline-flex size-[26px] shrink-0 items-center justify-center rounded-sm"
              :class="{
                'bg-[var(--green-50)] text-[var(--green-600)]': check.status === 'done',
                'bg-[var(--red-50)] text-[var(--red-600)]': check.status === 'missed',
                'bg-[var(--surface-sunken)] text-[var(--text-subtle)]': check.status === 'pending',
              }"
            >
              <DsIcon
                :name="check.status === 'done' ? 'check' : check.status === 'missed' ? 'alert-triangle' : 'clock'"
                :size="15"
                :stroke-width="2.2"
              />
            </span>
            <span class="mono w-10 font-semibold text-[var(--text-strong)]">{{ check.room }}</span>
            <TsResidentAvatar
              :name="check.name"
              :tenant-id="check.tenantId"
              :photo-url="check.photoUrl"
              :room="check.room"
              :support-level="check.supportLevel"
              :critical="check.critical"
              size="sm"
            />
            <div class="min-w-0 flex-1">
              <NuxtLink
                :to="`/tenants/${check.tenantId}`"
                class="block truncate text-sm font-semibold text-[var(--text-strong)] hover:underline"
              >
                {{ check.name }}
              </NuxtLink>
              <span v-if="check.note" class="block truncate text-xs text-[var(--text-subtle)]">
                {{ check.note }}
              </span>
            </div>
            <DsIcon
              v-if="check.critical"
              name="heart-pulse"
              :size="14"
              class="text-[var(--rose-600)]"
            />
            <span
              class="size-2 shrink-0 rounded-full"
              :style="{ background: LEVEL_COLOR[check.supportLevel] }"
              :title="check.supportLevel"
            />
            <span v-if="check.status === 'done'" class="w-24 text-right text-xs text-muted-foreground">
              {{ check.completedAt ? formatShortDate(check.completedAt) : '' }}
              {{
                check.completedAt
                  ? new Date(check.completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                  : ''
              }}
            </span>
            <Button
              v-else
              size="sm"
              :variant="check.status === 'missed' ? 'destructive' : 'primary'"
              :disabled="!can('wellness')"
              :title="denied('wellness') ?? undefined"
              @click="openCheck(check)"
            >
              <DsIcon name="check" :size="15" />
              Check now
            </Button>
          </div>
        </div>
      </Card>

      <!-- ------------------------------------------- Flagged / duties / etc -->
      <div class="grid gap-5 lg:grid-cols-[1.55fr_1fr] items-start">
        <div class="flex min-w-0 flex-col gap-5">
          <!-- Flagged -->
          <Card>
            <CardContent class="flex flex-col gap-3 p-5">
              <div class="flex items-center gap-3">
                <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--rose-50)] text-[var(--rose-600)]">
                  <DsIcon name="flag" :size="18" />
                </span>
                <div class="min-w-0 flex-1">
                  <span class="eyebrow">Not seen in two or more shifts</span>
                  <div class="font-semibold text-[var(--text-strong)]">Flagged for wellness check</div>
                </div>
                <Badge :variant="data.flagged.length ? 'danger' : 'success'" dot>
                  {{ data.flagged.length }}
                </Badge>
              </div>

              <p v-if="!data.flagged.length" class="text-base text-muted-foreground">
                Nobody has fallen off the round — every resident has been seen in the last two shifts.
              </p>

              <div
                v-for="row in data.flagged"
                :key="row.tenantId"
                class="flex items-center gap-3 border-t border-[var(--border-subtle)] pt-2.5"
              >
                <TsResidentAvatar
                  :name="row.name"
                  :tenant-id="row.tenantId"
                  :photo-url="row.photoUrl"
                  :room="row.room"
                  :support-level="row.supportLevel"
                  :critical="row.critical"
                  size="sm"
                />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="mono text-sm font-semibold text-[var(--text-strong)]">{{ row.room }}</span>
                    <NuxtLink
                      :to="`/tenants/${row.tenantId}`"
                      class="truncate text-sm font-semibold text-[var(--text-strong)] hover:underline"
                    >
                      {{ row.name }}
                    </NuxtLink>
                    <DsIcon
                      v-if="row.critical"
                      name="heart-pulse"
                      :size="13"
                      class="text-[var(--rose-600)]"
                    />
                  </div>
                  <div class="truncate text-xs text-[var(--text-subtle)]">
                    {{ row.reason }}
                    <template v-if="row.lastSeenAt">
                      · last seen {{ formatShortDate(row.lastSeenAt) }}
                    </template>
                    <template v-else> · no check on record</template>
                  </div>
                </div>
                <DsSupportMeter :level="row.supportLevel" size="sm" :show-label="false" />
                <Badge
                  :variant="row.segmentsMissed >= 4 ? 'danger' : row.segmentsMissed >= 3 ? 'warning' : 'neutral'"
                  dot
                >
                  {{ row.segmentsMissed >= 4 ? '4+' : row.segmentsMissed }} shifts
                </Badge>
                <Button
                  size="sm"
                  variant="soft"
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

          <!-- Role duties -->
          <Card>
            <CardContent class="flex flex-col gap-3 p-5">
              <div class="flex items-center gap-3">
                <span
                  class="inline-flex size-9 shrink-0 items-center justify-center rounded-md"
                  :style="{
                    background: `color-mix(in srgb, ${ACCENT[data.me.dutyAccent] ?? 'var(--brand)'} 12%, transparent)`,
                    color: ACCENT[data.me.dutyAccent] ?? 'var(--brand)',
                  }"
                >
                  <DsIcon :name="data.me.dutyIcon" :size="18" />
                </span>
                <div class="min-w-0 flex-1">
                  <span class="eyebrow">{{ me?.roleLabel }} · this shift</span>
                  <div class="font-semibold text-[var(--text-strong)]">{{ data.me.dutyTitle }}</div>
                </div>
                <Badge :variant="dutiesDone === data.me.duties.length ? 'success' : 'neutral'" dot>
                  {{ dutiesDone }}/{{ data.me.duties.length }} done
                </Badge>
              </div>

              <div class="flex items-center gap-3">
                <div class="h-2 flex-1 overflow-hidden rounded-full bg-[var(--slate-200)]">
                  <div
                    class="h-full rounded-full transition-[width] duration-500"
                    :style="{
                      width: `${(dutiesDone / Math.max(1, data.me.duties.length)) * 100}%`,
                      background: ACCENT[data.me.dutyAccent] ?? 'var(--brand)',
                    }"
                  />
                </div>
                <span
                  class="tnum text-sm font-semibold"
                  :style="{ color: ACCENT[data.me.dutyAccent] ?? 'var(--brand)' }"
                >
                  {{ Math.round((dutiesDone / Math.max(1, data.me.duties.length)) * 100) }}%
                </span>
              </div>

              <p v-if="!data.me.reportId" class="text-xs text-muted-foreground">
                Ticking a duty starts your shift report — the same one you finalize at handover.
              </p>

              <div
                v-for="duty in data.me.duties"
                :key="duty.key"
                class="flex items-center gap-3 border-t border-[var(--border-subtle)] py-2.5"
              >
                <button
                  type="button"
                  class="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm border transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  :class="
                    data.me.dutyState[duty.key]
                      ? 'border-[var(--green-500)] bg-[var(--green-500)]'
                      : 'border-[var(--border-strong)] bg-card'
                  "
                  :aria-label="data.me.dutyState[duty.key] ? 'Mark not done' : 'Mark done'"
                  :disabled="!can('wellness')"
                  @click="toggleDuty(duty.key, !data.me.dutyState[duty.key])"
                >
                  <DsIcon
                    v-if="data.me.dutyState[duty.key]"
                    name="check"
                    :size="15"
                    :stroke-width="2.6"
                    class="text-white"
                  />
                </button>
                <span
                  class="inline-flex size-[30px] shrink-0 items-center justify-center rounded-md"
                  :style="{
                    background: data.me.dutyState[duty.key]
                      ? 'var(--surface-sunken)'
                      : `color-mix(in srgb, ${ACCENT[data.me.dutyAccent] ?? 'var(--brand)'} 12%, transparent)`,
                    color: data.me.dutyState[duty.key]
                      ? 'var(--text-subtle)'
                      : ACCENT[data.me.dutyAccent] ?? 'var(--brand)',
                  }"
                >
                  <DsIcon :name="duty.icon" :size="15" />
                </span>
                <div class="min-w-0 flex-1">
                  <div
                    class="truncate text-sm font-semibold"
                    :class="
                      data.me.dutyState[duty.key]
                        ? 'text-muted-foreground line-through'
                        : 'text-[var(--text-strong)]'
                    "
                  >
                    {{ duty.label }}
                  </div>
                  <div class="text-xs text-[var(--text-subtle)]">{{ duty.meta }}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div class="flex min-w-0 flex-col gap-5">
          <!-- Watch list: critical needs, banned guests, tonight's overnights -->
          <Card>
            <CardContent class="flex flex-col gap-3 p-5">
              <div class="flex items-center gap-3">
                <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--rose-50)] text-[var(--rose-600)]">
                  <DsIcon name="heart-pulse" :size="18" />
                </span>
                <div class="min-w-0 flex-1">
                  <span class="eyebrow">Watch closely this shift</span>
                  <div class="font-semibold text-[var(--text-strong)]">Who to look out for</div>
                </div>
              </div>

              <Tabs v-model="watchTab">
                <TabsList class="w-full">
                  <TabsTrigger value="critical" class="flex-1">
                    Critical
                    <span
                      v-if="data.critical.length"
                      class="tnum rounded-full bg-[var(--slate-200)] px-1.5 text-xs font-bold text-[var(--text-body)]"
                    >{{ data.critical.length }}</span>
                  </TabsTrigger>
                  <TabsTrigger value="banned" class="flex-1">
                    Banned
                    <span
                      v-if="desk?.banned.length"
                      class="tnum rounded-full bg-[var(--slate-200)] px-1.5 text-xs font-bold text-[var(--text-body)]"
                    >{{ desk.banned.length }}</span>
                  </TabsTrigger>
                  <TabsTrigger value="overnight" class="flex-1">Overnight</TabsTrigger>
                </TabsList>

                <TabsContent value="critical" class="mt-3">
                  <p v-if="!data.critical.length" class="text-base text-muted-foreground">
                    No open cases in this building.
                  </p>

                  <NuxtLink
                    v-for="row in data.critical"
                    :key="row.tenantId"
                    :to="`/tenants/${row.tenantId}`"
                    class="flex items-center gap-3 border-t border-[var(--border-subtle)] py-2.5 first:border-0"
                  >
                    <TsResidentAvatar
                      :name="row.name"
                      :tenant-id="row.tenantId"
                      :photo-url="row.photoUrl"
                      :room="row.room"
                      :support-level="row.supportLevel"
                      :critical="true"
                      size="sm"
                      status="alert"
                    />
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-semibold text-[var(--text-strong)]">
                        {{ row.name }}
                      </div>
                      <div class="truncate text-xs text-[var(--text-subtle)]">
                        Room {{ row.room }} · {{ row.note }}
                      </div>
                    </div>
                    <DsSupportMeter :level="row.supportLevel" size="sm" :show-label="false" />
                  </NuxtLink>
                </TabsContent>

                <TabsContent value="banned" class="mt-3">
                  <p v-if="!desk?.banned.length" class="text-base text-muted-foreground">
                    Nobody is banned from this site.
                  </p>

                  <div
                    v-for="person in desk?.banned ?? []"
                    :key="person._id"
                    class="flex items-center gap-3 border-t border-[var(--border-subtle)] py-2.5 first:border-0"
                  >
                    <span class="inline-flex size-9 shrink-0 overflow-hidden rounded-full border border-border bg-[var(--surface-sunken)]">
                      <img
                        v-if="person.photoUrl"
                        :src="person.photoUrl"
                        :alt="person.name"
                        class="size-full object-cover"
                      >
                      <span v-else class="flex size-full items-center justify-center text-[var(--text-subtle)]">
                        <DsIcon name="user" :size="16" />
                      </span>
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-semibold text-[var(--text-strong)]">
                        {{ person.name }}
                      </div>
                      <div class="truncate text-xs text-[var(--text-subtle)]">
                        {{ person.bannedReason }}
                      </div>
                    </div>
                    <Badge variant="danger" dot>Banned</Badge>
                  </div>
                </TabsContent>

                <TabsContent value="overnight" class="mt-3">
                  <p v-if="!desk?.overnightTonight.length" class="text-base text-muted-foreground">
                    Nobody is approved to stay tonight.
                  </p>

                  <div
                    v-for="row in desk?.overnightTonight ?? []"
                    :key="row._id"
                    class="flex items-center gap-3 border-t border-[var(--border-subtle)] py-2.5 first:border-0"
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
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-semibold text-[var(--text-strong)]">
                        {{ row.visitorName }}
                      </div>
                      <div class="truncate text-xs text-[var(--text-subtle)]">
                        with {{ row.residentName }}
                      </div>
                    </div>
                    <Badge variant="violet">Approved</Badge>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <!-- Recent handovers -->
          <Card>
            <CardContent class="flex flex-col gap-3 p-5">
              <div class="flex items-center gap-3">
                <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--indigo-50)] text-[var(--indigo-600)]">
                  <DsIcon name="file-text" :size="18" />
                </span>
                <div class="min-w-0 flex-1">
                  <span class="eyebrow">Most recent handovers</span>
                  <div class="font-semibold text-[var(--text-strong)]">Shift reports</div>
                </div>
                <Button variant="ghost" size="sm" @click="navigateTo('/care/reports')">
                  All
                  <DsIcon name="arrow-right" :size="15" />
                </Button>
              </div>

              <p v-if="!data.reports.length" class="text-base text-muted-foreground">
                No reports submitted yet for this building.
              </p>

              <div
                v-for="report in data.reports"
                :key="report._id"
                class="flex flex-col gap-2 rounded-lg border border-border p-3"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-semibold text-[var(--text-strong)]">
                    {{ report.label }}
                  </span>
                  <span class="text-xs text-[var(--text-subtle)]">{{ report.hours }}</span>
                  <span class="ml-auto text-xs text-[var(--text-subtle)]">
                    {{ formatShortDate(report.submittedAt) }}
                  </span>
                </div>
                <div class="flex items-center gap-2">
                  <DsPersonAvatar :name="report.author" size="sm" />
                  <span class="text-xs font-semibold text-[var(--text-body)]">{{ report.author }}</span>
                  <Badge variant="neutral">{{ report.authorRole }}</Badge>
                </div>
                <div v-if="report.significant || report.cameraReview" class="flex flex-wrap gap-1.5">
                  <Badge v-if="report.significant" variant="danger">Significant</Badge>
                  <Badge v-if="report.events" variant="warning">
                    {{ report.events }} event{{ report.events === 1 ? '' : 's' }}
                  </Badge>
                  <Badge v-if="report.cameraReview" variant="violet">Camera review</Badge>
                </div>
                <p class="line-clamp-3 text-sm text-[var(--text-body)]">{{ report.summary }}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </template>

    <TsLogCheckDialog
      :open="!!checkTarget"
      :resident="checkTarget"
      @close="checkTarget = null"
    />
  </div>
</template>
