<script setup lang="ts">
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { formatShortDate } from '~/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from 'vue-sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * Care Console — the home screen for a Resident Support Worker, Wellness
 * Worker, Home Support Worker or Health Care Aide.
 *
 * Two layouts were tried side by side; this is the one that was kept. A main
 * column for what has to be read and acted on, and a right column for the two
 * standing references a worker glances at rather than reads — who is on the
 * roster, and what this role owes the shift.
 */
const { selected } = useSelectedBuilding()
const { me, can, denied } = useMe()
const isHealthCareAide = computed(() => me.value?.role === 'health-care-aide')

const now = useNow()
const tz = new Date().getTimezoneOffset()

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
  title: isHealthCareAide.value ? 'Health Care Aide' : 'Care Console',
}))

const { mutate: setDuty } = useConvexMutation(api.care.setDuty)
const { mutate: startReport, pending: starting } = useConvexMutation(api.shiftReports.start)

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

/**
 * The roster, split the way the round is walked.
 *
 * A flat wrap of forty-two rooms is a bag of numbers; the same rooms under
 * "Floor 1 / Floor 2 / Floor 3" is a route. Floors keep the order the server
 * sent (rooms come back on `sortKey`, which is the order staff walk them), so
 * nothing here re-sorts.
 */
const rosterFloors = computed(() => {
  const floors: { label: string, checks: typeof roster.value }[] = []
  for (const check of roster.value) {
    let floor = floors.find((f) => f.label === check.floor)
    if (!floor) {
      floor = { label: check.floor, checks: [] }
      floors.push(floor)
    }
    floor.checks.push(check)
  }
  return floors
})

/**
 * What a chip can be, and what the legend calls it.
 *
 * `missed` is deliberately not red-on-white alarm: a missed check on a round
 * still running is a thing to go and do, and the same word at the end of the
 * shift is the thing the report has to explain. One colour, read in context.
 */
const CHECK_STATES = [
  { key: 'done', label: 'Seen', bg: 'var(--success-soft)', fg: 'var(--success)', dot: 'var(--success)' },
  { key: 'missed', label: 'Missed', bg: 'var(--danger-soft)', fg: 'var(--danger)', dot: 'var(--danger)' },
  { key: 'pending', label: 'Not yet seen', bg: 'var(--surface-sunken)', fg: 'var(--text-muted)', dot: 'var(--text-subtle)' },
] as const

function chipStyle(status: string) {
  const state = CHECK_STATES.find((s) => s.key === status) ?? CHECK_STATES[2]
  return { background: state.bg, color: state.fg }
}

function dotColor(status: string) {
  return (CHECK_STATES.find((s) => s.key === status) ?? CHECK_STATES[2]).dot
}

function segmentNote(segment: { state: string, done: number, missed: number }): string {
  if (segment.state === 'upcoming') {
    return segment.done ? `${segment.done} logged early` : 'Starts later today'
  }
  return segment.missed ? `${segment.missed} missed` : 'All checked'
}

const savingDuty = ref(false)
async function toggleDuty(key: string, done: boolean) {
  if (!data.value || savingDuty.value) return
  savingDuty.value = true
  try {
    const reportId = data.value.me.reportId ?? await startReport({
      buildingId: data.value.building._id, now: Date.now(), tzOffsetMinutes: tz,
    })
    await setDuty({ reportId, duty: key, done })
  } catch (error) {
    toast.error('Could not save duty', { description: (error as Error).message })
  } finally {
    savingDuty.value = false
  }
}

async function openReport() {
  const buildingId = data.value?.building._id
  if (!buildingId) return
  try {
    await startReport({ buildingId, now: Date.now(), tzOffsetMinutes: tz })
    await navigateTo('/care/report')
  } catch (error) {
    toast.error('Could not open shift report', { description: (error as Error).message })
  }
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
    <!--
      The shift report is this screen's one standing action, so it sits in the
      nav with the other controls rather than in a row of its own above the
      content — which is where it competed with the first card for the eye.

      `defer` so the teleport resolves after the layout has rendered its
      target; without it the mount order is page-before-layout and the button
      has nowhere to go on a cold load.
    -->
    <Teleport defer to="#topbar-actions">
      <!--
        Primary, not secondary. Every shift ends in this report and it is the
        only thing on the screen a worker must do before they hand over — as a
        bordered white button among the nav's other bordered white controls it
        looked like one more utility.
      -->
      <Button
        variant="primary"
        :disabled="starting || !can('wellness')"
        :title="denied('wellness') ?? 'Log interactions and events, and finalize your shift'"
        @click="openReport"
      >
        <DsIcon name="file-text" :size="17" />
        {{ data?.me.reportId ? 'My shift report' : 'Start shift report' }}
        <Badge v-if="data?.me.entryCount" variant="solid" class="bg-white/20 text-current">
          {{ data.me.entryCount }}
        </Badge>
      </Button>
    </Teleport>

    <TsLoadingState v-if="isLoading" label="Loading the shift…" :rows="6" />

    <DsEmptyState
      v-else-if="!data"
      icon="clipboard-check"
      title="No building selected"
      description="Pick a building from the switcher to see its shift."
    />

    <template v-else>
      <TsGreeting :site="data.building.name" />
      <p v-if="isHealthCareAide" class="-mt-2 max-w-3xl text-sm text-muted-foreground">
        Support daily living, observe changes in residents’ health, and share what the care team needs to know.
      </p>

      <!--
        The shift in four numbers, chosen for the role on shift — see
        TsCareStats for which tiles each care role gets and why.
      -->
      <TsCareStats :data="data" />

      <!-- --------------------------------------------- Main + sidebar split -->
      <div class="grid items-start gap-5 lg:grid-cols-[1.55fr_1fr]">
        <!-- ============================================== MAIN =========== -->
        <div class="flex min-w-0 flex-col gap-5">
          <template v-if="isHealthCareAide">
            <DsPanel
              title="Residents to see next"
              subtitle="Outstanding wellness checks, ordered by urgency. Open a resident’s record for their care information."
              :count="data.queue.length"
            >
              <p v-if="!data.queue.length" class="flex items-center gap-2 text-sm text-muted-foreground">
                <DsIcon name="check-circle-2" :size="17" />
                Everyone has been seen this shift. Continue care and record any changes.
              </p>
              <div
                v-for="row in data.queue.slice(0, 5)" :key="row.tenantId"
                class="flex items-center gap-3 border-t border-[var(--border-subtle)] py-3 first:border-0"
              >
                <TsResidentAvatar
                  :name="row.name" :tenant-id="row.tenantId" :photo-url="row.photoUrl"
                  :room="row.room" :support-level="row.supportLevel" :critical="row.critical" size="sm"
                />
                <div class="min-w-0 flex-1">
                  <NuxtLink :to="`/tenants/${row.tenantId}`" class="block truncate text-sm font-semibold text-[var(--text-strong)] hover:underline">
                    {{ row.name }}
                  </NuxtLink>
                  <p class="text-xs text-muted-foreground">Room {{ row.room }} · {{ row.critical ? 'Open critical need' : row.supportLevel + ' support' }}</p>
                  <p class="mt-1 text-xs text-muted-foreground">{{ row.reason }}</p>
                </div>
                <Button size="sm" :disabled="!can('wellness')" :aria-label="`Log check for ${row.name}`" @click="openCheck(row)">
                  Log check
                </Button>
              </div>
              <p v-if="data.queue.length > 5" class="pt-2 text-xs text-muted-foreground">
                {{ data.queue.length - 5 }} more to see — use the tenant roster for the full round.
              </p>
            </DsPanel>
            <TsCareDuties
              :shift="data.me" :role-label="me?.roleLabel" :disabled="!can('wellness') || savingDuty"
              @toggle="toggleDuty"
            />
          </template>
          <DsPanel v-if="!isHealthCareAide" title="The rest of today" subtitle="The shifts either side of yours.">
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
                <div class="h-1.5 min-w-[60px] flex-1 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                  <div
                    class="h-full rounded-full"
                    :style="{
                      width: segment.total ? `${(segment.done / segment.total) * 100}%` : '0%',
                      background: segment.state === 'upcoming'
                        ? 'var(--border-strong)'
                        : segment.missed ? 'var(--warning)' : 'var(--success)',
                    }"
                  />
                </div>
              </div>
              <span
                class="shrink-0 text-xs font-semibold"
                :class="segment.missed ? 'text-[var(--warning)]' : 'text-muted-foreground'"
              >
                {{ segmentNote(segment) }}
              </span>
            </div>
          </DsPanel>

          <!-- Watch closely — now including who has fallen off the round -->
          <DsPanel
            title="Who to look out for"
            subtitle="Watch closely this shift."
            :count="data.critical.length + data.flagged.length"
          >
            <template #action>
              <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--rose-50)] text-[var(--rose-600)]">
                <DsIcon name="heart-pulse" :size="18" />
              </span>
            </template>

            <Tabs v-model="watchTab">
              <TabsList class="w-full">
                <TabsTrigger value="critical" class="flex-1">
                  Critical
                  <span v-if="data.critical.length" class="tnum ml-1 rounded-full bg-[var(--surface-sunken)] px-1.5 text-xs font-bold">
                    {{ data.critical.length }}
                  </span>
                </TabsTrigger>
                <TabsTrigger value="unseen" class="flex-1">
                  Not seen 24h
                  <span v-if="data.flagged.length" class="tnum ml-1 rounded-full bg-[var(--surface-sunken)] px-1.5 text-xs font-bold">
                    {{ data.flagged.length }}
                  </span>
                </TabsTrigger>
                <TabsTrigger v-if="!isHealthCareAide" value="banned" class="flex-1">
                  Banned
                  <span v-if="desk?.banned.length" class="tnum ml-1 rounded-full bg-[var(--surface-sunken)] px-1.5 text-xs font-bold">
                    {{ desk.banned.length }}
                  </span>
                </TabsTrigger>
                <TabsTrigger v-if="!isHealthCareAide" value="overnight" class="flex-1">Overnight</TabsTrigger>
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
          </DsPanel>

          <!-- Handover: the shift before this one, worst first -->
          <DsPanel
            title="What the last shift left you"
            :subtitle="
              data.handoverIsPrevious && data.previousShift
                ? `Handover from ${data.previousShift.label}.`
                : 'The most recent reports on file.'
            "
          >
            <template #action>
              <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--blue-50)] text-[var(--blue-600)]">
                <DsIcon name="file-text" :size="18" />
              </span>
            </template>

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

            <template #footer>
              <NuxtLink to="/care/reports">
                Read every shift report
                <DsIcon name="arrow-right" :size="15" />
              </NuxtLink>
            </template>
          </DsPanel>
        </div>

        <!-- ============================================ SIDEBAR =========== -->
        <div class="flex min-w-0 flex-col gap-5">
          <DsPanel v-if="isHealthCareAide" title="Record & follow up" subtitle="Keep observations connected to the resident and the next shift.">
            <div class="flex flex-col gap-2">
              <Button variant="primary" :disabled="starting || !can('wellness')" class="justify-start" @click="openReport">
                <DsIcon name="file-text" :size="16" /> Record a care observation
              </Button>
              <NuxtLink to="/care/reports" class="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-[var(--brand)] hover:bg-[var(--surface-sunken)]">
                <DsIcon name="users" :size="16" /> Read care-team handover
              </NuxtLink>
              <NuxtLink to="/maintenance" class="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-[var(--brand)] hover:bg-[var(--surface-sunken)]">
                <DsIcon name="wrench" :size="16" /> Report an equipment or safety concern
              </NuxtLink>
            </div>
          </DsPanel>
          <TsRoutineClock v-else />

          <p v-if="isHealthCareAide" class="text-xs text-muted-foreground">
            Medication support follows the care plan and transfer-of-function training. Record each dose in the medication tracker.
          </p>

          <TsMedicationTracker />

          <DsPanel
            title="Tenant roster"
            subtitle="Every room on this round. Tap one to log a check."
            :count="`${liveSegment?.done ?? 0}/${liveSegment?.total ?? 0}`"
          >
            <!--
              Mandatory is not a subset anyone should have to work out. A
              resident with an open critical need must be laid eyes on, so
              the obligation gets its own line and its own ring on the chip.
            -->
            <div
              v-if="mandatory.length"
              class="mb-3 flex items-center gap-1.5 text-xs font-semibold"
              :class="mandatoryDone === mandatory.length ? 'text-[var(--success)]' : 'text-[var(--danger)]'"
            >
              <DsIcon
                :name="mandatoryDone === mandatory.length ? 'check-circle-2' : 'heart-pulse'"
                :size="13"
              />
              {{ mandatoryDone }}/{{ mandatory.length }} mandatory checks done
            </div>

            <div class="flex flex-col gap-4">
              <div v-for="floor in rosterFloors" :key="floor.label">
                <div class="mb-2 flex items-baseline gap-2">
                  <span class="eyebrow text-[var(--text-subtle)]">{{ floor.label }}</span>
                  <span class="tnum text-2xs text-[var(--text-subtle)]">
                    {{ floor.checks.filter((c) => c.status === 'done').length }}/{{ floor.checks.length }}
                  </span>
                </div>
                <!-- A grid, not a wrap: equal cells line room numbers up into
                     columns, so a floor reads as a plan rather than a ragged run. -->
                <div class="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-1.5">
                  <button
                    v-for="check in floor.checks"
                    :key="check.tenantId"
                    type="button"
                    class="tnum inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-sm px-2 py-1 text-xs font-bold transition-colors"
                    :class="check.critical && 'ring-1 ring-[var(--rose-500)]'"
                    :style="chipStyle(check.status)"
                    :title="`${check.room} · ${check.name}${check.critical ? ' · mandatory check' : ''}${check.outcome ? ` · ${check.outcome}` : ''}`"
                    @click="openCheck(check)"
                  >
                    <span class="size-1.5 rounded-full" :style="{ background: dotColor(check.status) }" />
                    {{ check.room }}
                  </button>
                </div>
              </div>
            </div>

            <div class="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--border-subtle)] pt-3">
              <span
                v-for="state in CHECK_STATES"
                :key="state.key"
                class="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <span class="size-2 rounded-[2px]" :style="{ background: state.dot }" />
                {{ state.label }}
              </span>
              <span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span class="size-2 rounded-[2px] ring-1 ring-[var(--rose-500)]" />
                Mandatory
              </span>
            </div>

            <template #footer>
              <NuxtLink to="/checks">
                Open the room check sheet
                <DsIcon name="arrow-right" :size="15" />
              </NuxtLink>
            </template>
          </DsPanel>

          <TsCareDuties
            v-if="!isHealthCareAide"
            :shift="data.me" :role-label="me?.roleLabel" :disabled="!can('wellness') || savingDuty"
            @toggle="toggleDuty"
          />
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
