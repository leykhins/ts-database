<script setup lang="ts">
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { formatShortDate } from '~/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * TEMPORARY — the second Care Console layout.
 *
 * Main column for what has to be read and acted on; right sidebar for the two
 * standing references a worker glances at rather than reads — who is on the
 * roster, and what this role owes the shift.
 *
 * Delete once a direction is chosen.
 */
const { selected } = useSelectedBuilding()
const { me, can, denied } = useMe()

const now = ref(Date.now())
const tz = new Date().getTimezoneOffset()
const timer = setInterval(() => (now.value = Date.now()), 60_000)
onScopeDispose(() => clearInterval(timer))

const { data, isLoading } = useConvexQuery(api.care.overview, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
  now: now.value,
  tzOffsetMinutes: tz,
}))

const { data: desk } = useConvexQuery(api.visitors.board, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
  now: now.value,
  tzOffsetMinutes: tz,
}))

usePageHeader(() => ({
  eyebrow: data.value ? `${data.value.building.name} · ${data.value.current.label}` : '',
  title: 'Care Console — preview 2',
}))

const { mutate: setDuty } = useConvexMutation(api.care.setDuty)
const { mutate: startReport, pending: starting } = useConvexMutation(api.shiftReports.start)

const layout = ref<'board' | 'shift'>('board')
const watchTab = ref<'critical' | 'unseen' | 'banned' | 'overnight'>('critical')

type Row = {
  tenantId: Id<'tenants'>
  name: string
  room: string
  photoUrl?: string | null
  supportLevel?: string
  critical?: boolean
  reason?: string
}
const checkTarget = ref<Row | null>(null)
function openCheck(row: Row) {
  checkTarget.value = row
}

const indexColor = computed(() => {
  const score = data.value?.wellnessIndex.score ?? 0
  return score >= 80 ? 'var(--emerald-600)' : score >= 65 ? 'var(--amber-500)' : 'var(--rose-600)'
})

const RING = { size: 116, stroke: 10 }
const ringRadius = (RING.size - RING.stroke) / 2
const ringCircumference = 2 * Math.PI * ringRadius
const ringOffset = computed(
  () => ringCircumference * (1 - (data.value?.wellnessIndex.score ?? 0) / 100),
)

const liveSegment = computed(() => data.value?.board.find((s) => s.state === 'current') ?? null)
const otherSegments = computed(() => data.value?.board.filter((s) => s.state !== 'current') ?? [])

/**
 * The roster, and the part of it that is not optional.
 *
 * A resident with an open critical need is a mandatory look — not "get to them
 * if the shift allows". They are marked in the roster and counted separately in
 * its header so the obligation is answerable without opening anything.
 */
const roster = computed(() => liveSegment.value?.checks ?? [])
const mandatory = computed(() => roster.value.filter((c) => c.critical))
const mandatoryDone = computed(() => mandatory.value.filter((c) => c.status === 'done').length)

function segmentNote(segment: { state: string; done: number; missed: number }): string {
  if (segment.state === 'upcoming') {
    return segment.done ? `${segment.done} logged early` : 'Starts later today'
  }
  return segment.missed ? `${segment.missed} missed` : 'All checked'
}

const dutiesDone = computed(() => {
  const state = data.value?.me.dutyState ?? {}
  return (data.value?.me.duties ?? []).filter((d) => state[d.key]).length
})

async function toggleDuty(key: string, done: boolean) {
  const reportId = data.value?.me.reportId
  if (!reportId) return openReport()
  await setDuty({ reportId, duty: key, done })
}

async function openReport() {
  const buildingId = data.value?.building._id
  if (!buildingId) return
  await startReport({ buildingId, now: Date.now(), tzOffsetMinutes: tz })
  await navigateTo('/care/report')
}

/** Log-entry kinds that read as a site emergency rather than a resident note. */
const EMERGENCY = new Set(['fire', 'flood', 'police', 'ambulance', 'evacuation', 'violence'])

const KIND_LABEL: Record<string, string> = {
  welfare: 'Welfare', medical: 'Medical', behavioural: 'Behavioural',
  'harm-reduction': 'Harm reduction', property: 'Property', other: 'Other',
  fire: 'Fire', flood: 'Flood', power: 'Power', elevator: 'Elevator',
  police: 'Police', ambulance: 'Ambulance', evacuation: 'Evacuation',
  violence: 'Violence', contractor: 'Contractor', security: 'Security',
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-[var(--amber-500)]/50 bg-[var(--amber-50)] px-4 py-2.5">
      <DsIcon name="info" :size="17" class="text-[var(--amber-700)]" />
      <span class="text-sm text-[var(--amber-700)]">
        Preview 2 — main column and sidebar, rounds as a clock, demo activity running.
      </span>
      <span class="ml-auto flex gap-3 text-sm font-semibold">
        <NuxtLink to="/care" class="text-[var(--text-link)] hover:underline">Current</NuxtLink>
        <NuxtLink to="/care/preview" class="text-[var(--text-link)] hover:underline">Preview 1</NuxtLink>
      </span>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2">
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
    </div>

    <TsLoadingState v-if="isLoading" label="Loading the shift…" :rows="6" />

    <DsEmptyState
      v-else-if="!data"
      icon="clipboard-check"
      title="No building selected"
      description="Pick a building from the switcher to see its shift."
    />

    <template v-else>
      <!-- ------------------------------------------------------------ Hero -->
      <div class="grid items-start gap-5 [grid-template-columns:repeat(auto-fit,minmax(290px,1fr))]">
        <Card>
          <CardContent class="flex flex-col gap-4 p-5">
            <div class="flex items-center justify-between gap-2">
              <span class="eyebrow">Wellness Index</span>
              <Badge
                :variant="
                  data.wellnessIndex.score >= 80
                    ? 'success'
                    : data.wellnessIndex.score >= 65 ? 'warning' : 'danger'
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
                    :cx="RING.size / 2" :cy="RING.size / 2" :r="ringRadius"
                    fill="none" stroke="var(--surface-sunken)" :stroke-width="RING.stroke"
                  />
                  <circle
                    :cx="RING.size / 2" :cy="RING.size / 2" :r="ringRadius"
                    fill="none" :stroke="indexColor" :stroke-width="RING.stroke"
                    stroke-linecap="round"
                    :stroke-dasharray="ringCircumference" :stroke-dashoffset="ringOffset"
                    class="transition-[stroke-dashoffset] duration-500"
                  />
                </svg>
                <div class="absolute inset-0 flex flex-col items-center justify-center">
                  <span class="tnum text-[32px] font-extrabold leading-none tracking-tight text-[var(--text-strong)]">
                    {{ data.wellnessIndex.score }}
                  </span>
                  <span class="mt-0.5 text-2xs text-[var(--text-subtle)]">/ 100</span>
                </div>
              </div>

              <div class="flex min-w-0 flex-col gap-2">
                <p class="text-sm text-muted-foreground">
                  Seen inside their check window.
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
                <div v-else class="flex items-center gap-1.5 text-sm text-[var(--success)]">
                  <DsIcon name="check-circle-2" :size="14" />
                  Every critical resident has been seen.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <!-- Shift brief: narrative only, no queue. -->
        <Card>
          <CardContent class="flex h-full flex-col gap-3 p-5">
            <span class="eyebrow">Shift brief</span>
            <p class="text-base leading-relaxed text-[var(--text-body)]">
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
              <template v-else>Every critical resident has been seen.</template>
            </p>
            <p v-if="data.flagged.length" class="text-sm text-muted-foreground">
              <strong class="text-[var(--text-strong)]">{{ data.flagged.length }}</strong>
              {{ data.flagged.length === 1 ? 'resident has' : 'residents have' }} not been seen in a
              day — see Watch closely.
            </p>
          </CardContent>
        </Card>

        <TsRoutineClock />
      </div>

      <!-- --------------------------------------------- Main + sidebar split -->
      <div class="grid items-start gap-5 lg:grid-cols-[1.55fr_1fr]">
        <!-- ============================================== MAIN =========== -->
        <div class="flex min-w-0 flex-col gap-5">
          <!-- The rest of today -->
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
                        background: segment.state === 'upcoming'
                          ? 'var(--slate-300)'
                          : segment.missed ? 'var(--amber-500)' : 'var(--green-500)',
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

          <!-- Watch closely — now including who has fallen off the round -->
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
                    <span v-if="data.critical.length" class="tnum ml-1 rounded-full bg-[var(--slate-200)] px-1.5 text-xs font-bold">
                      {{ data.critical.length }}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="unseen" class="flex-1">
                    Not seen 24h
                    <span v-if="data.flagged.length" class="tnum ml-1 rounded-full bg-[var(--slate-200)] px-1.5 text-xs font-bold">
                      {{ data.flagged.length }}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="banned" class="flex-1">
                    Banned
                    <span v-if="desk?.banned.length" class="tnum ml-1 rounded-full bg-[var(--slate-200)] px-1.5 text-xs font-bold">
                      {{ desk.banned.length }}
                    </span>
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
                      :name="row.name" :tenant-id="row.tenantId" :photo-url="row.photoUrl"
                      :room="row.room" :support-level="row.supportLevel" :critical="true"
                      size="sm" status="alert"
                    />
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-semibold text-[var(--text-strong)]">{{ row.name }}</div>
                      <div class="truncate text-xs text-[var(--text-subtle)]">Room {{ row.room }} · {{ row.note }}</div>
                    </div>
                    <DsSupportMeter :level="row.supportLevel" size="sm" :show-label="false" />
                  </NuxtLink>
                </TabsContent>

                <!--
                  Was its own card. It belongs here: "nobody has laid eyes on
                  this person in a day" is the same question as the critical
                  list — who needs looking out for — and two cards asking it
                  separately made the page argue with itself.
                -->
                <TabsContent value="unseen" class="mt-3">
                  <p v-if="!data.flagged.length" class="flex items-center gap-2 text-base text-[var(--success)]">
                    <DsIcon name="check-circle-2" :size="17" />
                    Nobody has fallen off the round.
                  </p>
                  <div
                    v-for="row in data.flagged"
                    :key="row.tenantId"
                    class="flex items-center gap-3 border-t border-[var(--border-subtle)] py-2.5 first:border-0"
                  >
                    <TsResidentAvatar
                      :name="row.name" :tenant-id="row.tenantId" :photo-url="row.photoUrl"
                      :room="row.room" :support-level="row.supportLevel" :critical="row.critical"
                      size="sm"
                    />
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="mono text-sm font-semibold text-[var(--text-strong)]">{{ row.room }}</span>
                        <NuxtLink :to="`/tenants/${row.tenantId}`" class="truncate text-sm font-semibold text-[var(--text-strong)] hover:underline">
                          {{ row.name }}
                        </NuxtLink>
                        <DsIcon v-if="row.critical" name="heart-pulse" :size="13" class="text-[var(--rose-600)]" />
                      </div>
                      <div class="truncate text-xs text-[var(--text-subtle)]">
                        <template v-if="row.lastSeenAt">Last seen {{ formatShortDate(row.lastSeenAt) }}</template>
                        <template v-else>No check on record</template>
                        · {{ row.segmentsMissed >= 4 ? '4+' : row.segmentsMissed }} shifts
                      </div>
                    </div>
                    <Button
                      size="sm" variant="primary"
                      :disabled="!can('wellness')" :title="denied('wellness') ?? undefined"
                      @click="openCheck(row)"
                    >
                      <DsIcon name="check" :size="15" />
                      Check
                    </Button>
                  </div>
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
                    <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--rose-50)] text-[var(--rose-600)]">
                      <DsIcon name="user" :size="17" />
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-semibold text-[var(--text-strong)]">{{ person.name }}</div>
                      <div class="truncate text-xs text-[var(--text-subtle)]">{{ person.bannedReason ?? 'Banned from the site' }}</div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="overnight" class="mt-3">
                  <p v-if="!desk?.overnightTonight?.length" class="text-base text-muted-foreground">
                    No overnight guests approved for tonight.
                  </p>
                  <div
                    v-for="row in desk?.overnightTonight ?? []"
                    :key="row.visitorId"
                    class="flex items-center gap-3 border-t border-[var(--border-subtle)] py-2.5 first:border-0"
                  >
                    <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--blue-50)] text-[var(--blue-600)]">
                      <DsIcon name="moon" :size="17" />
                    </span>
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-semibold text-[var(--text-strong)]">{{ row.visitorName }}</div>
                      <div class="truncate text-xs text-[var(--text-subtle)]">Staying with {{ row.residentName }}</div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <!-- Handover: the shift before this one, worst first -->
          <Card>
            <CardContent class="flex flex-col gap-3 p-5">
              <div class="flex flex-wrap items-center gap-3">
                <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--blue-50)] text-[var(--blue-600)]">
                  <DsIcon name="file-text" :size="18" />
                </span>
                <div class="min-w-0 flex-1">
                  <span class="eyebrow">
                    {{ data.handoverIsPrevious && data.previousShift
                      ? `Handover from ${data.previousShift.label}`
                      : 'Most recent handovers' }}
                  </span>
                  <div class="font-semibold text-[var(--text-strong)]">Shift reports</div>
                </div>
                <NuxtLink to="/care/reports" class="text-sm font-semibold text-[var(--text-link)] hover:underline">
                  All reports →
                </NuxtLink>
              </div>

              <p v-if="!data.reports.length" class="text-base text-muted-foreground">
                Nothing has been filed yet.
              </p>

              <div
                v-for="report in data.reports"
                :key="report._id"
                class="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-3 first:border-0 first:pt-0"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-semibold text-[var(--text-strong)]">{{ report.label }}</span>
                  <span class="text-xs text-muted-foreground">{{ report.author }}</span>
                  <Badge v-if="report.significant" variant="danger" dot>Significant</Badge>
                  <span class="flex-1" />
                  <span class="tnum text-xs text-muted-foreground">
                    {{ report.interactions }} interactions · {{ report.events }} events
                  </span>
                </div>

                <!-- Worst first: significant, then anything that pulled in
                     outside services, then the rest. -->
                <div
                  v-for="entry in report.highlights"
                  :key="entry._id"
                  class="flex items-start gap-2.5 rounded-md px-2.5 py-2"
                  :class="
                    entry.significant
                      ? 'bg-[var(--rose-50)]'
                      : EMERGENCY.has(entry.kind) ? 'bg-[var(--amber-50)]' : 'bg-[var(--surface-sunken)]'
                  "
                >
                  <DsIcon
                    :name="entry.log === 'event' ? 'alert-triangle' : 'notes'"
                    :size="14"
                    class="mt-0.5 shrink-0"
                    :class="
                      entry.significant
                        ? 'text-[var(--rose-600)]'
                        : EMERGENCY.has(entry.kind) ? 'text-[var(--amber-700)]' : 'text-muted-foreground'
                    "
                  />
                  <span class="min-w-0 flex-1">
                    <span class="flex flex-wrap items-center gap-x-2">
                      <span class="text-xs font-bold tracking-wide text-[var(--text-strong)] uppercase">
                        {{ KIND_LABEL[entry.kind] ?? entry.kind }}
                      </span>
                      <span v-if="entry.emergencyServices" class="text-[11px] font-semibold text-[var(--rose-600)]">
                        Emergency services attended
                      </span>
                      <span v-if="entry.evacuated" class="text-[11px] font-semibold text-[var(--rose-600)]">
                        Building evacuated
                      </span>
                    </span>
                    <span class="mt-0.5 block text-xs text-pretty text-[var(--text-body)]">
                      {{ entry.comments }}
                    </span>
                  </span>
                </div>

                <p v-if="report.summary" class="text-xs text-pretty text-muted-foreground">
                  {{ report.summary }}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <!-- ============================================ SIDEBAR =========== -->
        <div class="flex min-w-0 flex-col gap-5">
          <!-- Tenant roster -->
          <Card>
            <CardContent class="flex flex-col gap-3 p-5">
              <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span class="eyebrow">Tenant roster</span>
                <span class="flex-1" />
                <span class="tnum text-xs text-muted-foreground">
                  {{ liveSegment?.done ?? 0 }}/{{ liveSegment?.total ?? 0 }} seen
                </span>
              </div>

              <!--
                Mandatory is not a subset anyone should have to work out. A
                resident with an open critical need must be laid eyes on, so
                the obligation gets its own line and its own ring on the chip.
              -->
              <div
                v-if="mandatory.length"
                class="flex items-center gap-1.5 text-xs font-semibold"
                :class="mandatoryDone === mandatory.length ? 'text-[var(--success)]' : 'text-[var(--rose-600)]'"
              >
                <DsIcon
                  :name="mandatoryDone === mandatory.length ? 'check-circle-2' : 'heart-pulse'"
                  :size="13"
                />
                {{ mandatoryDone }}/{{ mandatory.length }} mandatory checks done
              </div>

              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="check in roster"
                  :key="check.tenantId"
                  type="button"
                  class="tnum inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-bold transition-colors"
                  :class="[
                    {
                      'bg-[var(--green-50)] text-[var(--green-700)]': check.status === 'done',
                      'bg-[var(--red-50)] text-[var(--red-600)]': check.status === 'missed',
                      'bg-[var(--slate-100)] text-muted-foreground': check.status === 'pending',
                    },
                    check.critical && 'ring-1 ring-[var(--rose-500)]',
                  ]"
                  :title="`${check.room} · ${check.name}${check.critical ? ' · mandatory check' : ''}${check.outcome ? ` · ${check.outcome}` : ''}`"
                  @click="openCheck(check)"
                >
                  <span
                    class="size-1.5 rounded-full"
                    :style="{
                      background: check.status === 'done'
                        ? 'var(--green-500)'
                        : check.status === 'missed' ? 'var(--red-500)' : 'var(--slate-400)',
                    }"
                  />
                  {{ check.room }}
                </button>
              </div>
            </CardContent>
          </Card>

          <!-- Shift tasks -->
          <Card>
            <CardContent class="flex flex-col gap-3 p-5">
              <div class="flex flex-wrap items-baseline gap-x-2">
                <span class="eyebrow">{{ me?.roleLabel }} · this shift</span>
                <span class="flex-1" />
                <span class="tnum text-xs text-muted-foreground">
                  {{ dutiesDone }}/{{ data.me.duties.length }}
                </span>
              </div>
              <div class="font-semibold text-[var(--text-strong)]">{{ data.me.dutyTitle }}</div>

              <label
                v-for="duty in data.me.duties"
                :key="duty.key"
                class="flex cursor-pointer items-start gap-3 rounded-md border border-transparent py-1.5 transition-colors hover:bg-[var(--surface-hover)]"
              >
                <Checkbox
                  :model-value="!!data.me.dutyState[duty.key]"
                  :disabled="!can('wellness')"
                  class="mt-0.5"
                  @update:model-value="(v) => toggleDuty(duty.key, !!v)"
                />
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-medium text-[var(--text-strong)]">{{ duty.label }}</span>
                  <span class="block text-xs text-[var(--text-subtle)]">{{ duty.meta }}</span>
                </span>
              </label>

              <!--
                Rounds are not a checkbox here. They are logged by walking them,
                and a tick beside that record is a second place to claim the
                same work — which is how the two come to disagree at handover.
              -->
              <div class="mt-1 border-t border-[var(--border-subtle)] pt-3">
                <span class="eyebrow">From your shift activity</span>
                <p class="mt-1.5 text-xs text-muted-foreground">
                  Building rounds and the perimeter are counted from the rounds card — logged
                  by walking them, not ticked off here.
                </p>
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
