<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { formatDate } from '~/utils/format'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

/**
 * Shift report — two phases, as designed.
 *
 * Phase one runs all shift: log each incident as it happens. Phase two is
 * finalizing, which is when the whole-shift questions appear — asking them at
 * 5 pm produces answers that are wrong by midnight.
 *
 * Reporter, site, date and shift period are derived from who is signed in and
 * what time it is. Nothing that can be wrong is typed.
 */
const { selected } = useSelectedBuilding()
const { can, denied } = useMe()

const tz = new Date().getTimezoneOffset()
const now = ref(Date.now())
const timer = setInterval(() => (now.value = Date.now()), 60_000)
onScopeDispose(() => clearInterval(timer))

const { data, isLoading } = useConvexQuery(api.shiftReports.current, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
  now: now.value,
  tzOffsetMinutes: tz,
}))

usePageHeader({ eyebrow: 'Care', title: 'Shift Report' })

const { mutate: startReport } = useConvexMutation(api.shiftReports.start)
const { mutate: addEntry, pending: adding } = useConvexMutation(api.shiftReports.addEntry)
const { mutate: updateEntry } = useConvexMutation(api.shiftReports.updateEntry)
const { mutate: removeEntry } = useConvexMutation(api.shiftReports.removeEntry)
const { mutate: saveDraft, pending: saving } = useConvexMutation(api.shiftReports.saveDraft)
const { mutate: submitReport, pending: submitting } = useConvexMutation(api.shiftReports.submit)

/**
 * Two logs. An interaction happened *with a resident*; an event happened *to
 * the building*. Splitting them keeps somebody's name off a burst pipe, and
 * gives the next shift a straight answer to "what happened here last night".
 */
const LOGS = {
  interaction: {
    title: 'Interaction log',
    eyebrow: 'With residents',
    icon: 'users',
    accent: 'var(--teal-600)',
    soft: 'var(--teal-50)',
    description: 'Anything that happened with a resident. None means a quiet shift.',
    empty: 'No interactions logged — quiet shift.',
    add: 'Add interaction',
    kinds: [
      { value: 'welfare', label: 'Welfare concern' },
      { value: 'medical', label: 'Medical / overdose' },
      { value: 'behavioural', label: 'Behavioural / conflict' },
      { value: 'harm-reduction', label: 'Harm reduction' },
      { value: 'property', label: 'Property / maintenance' },
      { value: 'other', label: 'Other' },
    ],
  },
  event: {
    title: 'Event log',
    eyebrow: 'The building',
    icon: 'alert-triangle',
    accent: 'var(--amber-600)',
    soft: 'var(--amber-50)',
    description:
      'Fire alarms, floods, outages, services attending. A resident can be named, but does not have to be.',
    empty: 'No events logged — nothing happened to the building.',
    add: 'Add event',
    kinds: [
      { value: 'fire', label: 'Fire alarm / fire' },
      { value: 'flood', label: 'Flood / water' },
      { value: 'power', label: 'Power / heat outage' },
      { value: 'elevator', label: 'Elevator failure' },
      { value: 'police', label: 'Police attendance' },
      { value: 'ambulance', label: 'Ambulance / EHS attendance' },
      { value: 'evacuation', label: 'Evacuation' },
      { value: 'violence', label: 'Violence / threat on site' },
      { value: 'security', label: 'Security / break-in' },
      { value: 'contractor', label: 'Contractor / vendor on site' },
    ],
  },
} as const

type LogName = keyof typeof LOGS

const LOCATIONS = [
  'Resident room',
  'Lobby / amenity',
  'Hallway',
  'Stairwell',
  'Harm-reduction room',
  'Bathroom',
  'Exterior / grounds',
  'Staff area',
  'Whole building',
  'Other',
]

const finalized = ref(false)

/* ---- New entry form, shared by both logs ---- */
const draft = reactive({
  log: 'interaction' as LogName,
  tenantIds: [] as Id<'tenants'>[],
  location: 'Resident room',
  time: '',
  kind: 'welfare' as string,
  comments: '',
  significant: false,
  cameraReview: false,
  emergencyServices: false,
  evacuated: false,
})
const entryError = ref('')
const formOpen = ref<LogName | null>(null)

const entriesFor = (log: LogName) => (data.value?.entries ?? []).filter((e) => e.log === log)

function startEntry(log: LogName) {
  Object.assign(draft, {
    log,
    tenantIds: [],
    location: log === 'event' ? 'Whole building' : 'Resident room',
    time: '',
    kind: LOGS[log].kinds[0]!.value,
    comments: '',
    significant: false,
    cameraReview: false,
    emergencyServices: false,
    evacuated: false,
  })
  entryError.value = ''
  formOpen.value = log
}

/* ---- Finalize form ---- */
const summary = ref('')
const importantInfo = ref('')
const extraTasks = ref('')
const radioCheck = ref(false)
const handover = ref(false)
const readPrevious = ref(false)
const duties = ref<Record<string, boolean>>({})
const submitError = ref('')

// Load the server's copy once the draft arrives, without stomping on typing.
const hydrated = ref<string | null>(null)
watchEffect(() => {
  const report = data.value?.report
  if (!report || hydrated.value === report._id) return
  hydrated.value = report._id
  summary.value = report.summary
  importantInfo.value = report.importantInfo
  extraTasks.value = report.extraTasks
  radioCheck.value = report.radioCheck
  handover.value = report.handover
  readPrevious.value = report.readPrevious
  duties.value = { ...report.duties }
})

const dutiesDone = computed(() => Object.values(duties.value).filter(Boolean).length)

const required = computed(() => [
  { label: 'Shift summary written', ok: summary.value.trim().length > 0 },
  { label: 'Radio check confirmed', ok: radioCheck.value },
  { label: 'Handover given / received', ok: handover.value },
  { label: 'Previous reports read', ok: readPrevious.value },
])
const readyCount = computed(() => required.value.filter((r) => r.ok).length)
const ready = computed(() => readyCount.value === required.value.length)

/** `9:40 pm` typed into a time field → a timestamp on the shift's date. */
function parseTime(text: string): number {
  const match = /(\d{1,2}):(\d{2})\s*(a|p)m/i.exec(text.trim())
  if (!match || !data.value) return Date.now()
  let hour = Number(match[1]) % 12
  if (/p/i.test(match[3]!)) hour += 12
  const [y, m, d] = data.value.context.shiftDate.split('-').map(Number)
  const local = new Date(y!, (m ?? 1) - 1, d ?? 1, hour, Number(match[2]))
  return local.getTime()
}

async function ensureReport(): Promise<Id<'shiftReports'> | null> {
  if (data.value?.report) return data.value.report._id
  const buildingId = data.value?.building._id
  if (!buildingId) return null
  return await startReport({ buildingId, now: Date.now(), tzOffsetMinutes: tz })
}

async function logEntry() {
  entryError.value = ''
  if (!draft.comments.trim()) {
    entryError.value = 'Describe what happened and what was done about it.'
    return
  }

  try {
    const reportId = await ensureReport()
    if (!reportId) return
    await addEntry({
      reportId,
      log: draft.log,
      ...(draft.tenantIds.length ? { tenantIds: draft.tenantIds } : {}),
      location: draft.location,
      occurredAt: draft.time ? parseTime(draft.time) : Date.now(),
      kind: draft.kind as 'welfare',
      comments: draft.comments,
      significant: draft.significant,
      cameraReview: draft.cameraReview,
      ...(draft.log === 'event'
        ? { emergencyServices: draft.emergencyServices, evacuated: draft.evacuated }
        : {}),
    })
    toast.success(draft.log === 'event' ? 'Event logged' : 'Interaction logged')
    formOpen.value = null
  } catch (e) {
    entryError.value = (e as Error).message || 'Could not save the entry.'
  }
}

async function toggleEntryFlag(
  entryId: Id<'shiftLogEntries'>,
  field: 'significant' | 'cameraReview',
  value: boolean,
) {
  try {
    await updateEntry({ entryId, [field]: value })
  } catch (e) {
    toast.error('Could not update the entry', { description: (e as Error).message })
  }
}

async function deleteEntry(entryId: Id<'shiftLogEntries'>) {
  if (!window.confirm('Remove this entry from the report?')) return
  try {
    await removeEntry({ entryId })
    toast.success('Entry removed')
  } catch (e) {
    toast.error('Could not remove the entry', { description: (e as Error).message })
  }
}

async function persist() {
  const reportId = data.value?.report?._id
  if (!reportId) return
  await saveDraft({
    reportId,
    summary: summary.value,
    importantInfo: importantInfo.value,
    extraTasks: extraTasks.value,
    radioCheck: radioCheck.value,
    handover: handover.value,
    readPrevious: readPrevious.value,
    duties: duties.value,
  })
  toast.success('Draft saved')
}

async function submit() {
  submitError.value = ''
  const reportId = data.value?.report?._id
  if (!reportId) return

  try {
    const result = await submitReport({
      reportId,
      summary: summary.value,
      importantInfo: importantInfo.value,
      extraTasks: extraTasks.value,
      radioCheck: radioCheck.value,
      handover: handover.value,
      readPrevious: readPrevious.value,
      duties: duties.value,
      now: Date.now(),
    })
    const total = result.interactions + result.events
    toast.success('Shift report submitted', {
      description: total
        ? `${result.interactions} interaction${result.interactions === 1 ? '' : 's'} and ` +
          `${result.events} event${result.events === 1 ? '' : 's'} on the record` +
          `${result.significant ? `, ${result.significant} significant` : ''}.`
        : 'Quiet shift — nothing logged.',
    })
    await navigateTo('/care')
  } catch (e) {
    submitError.value = (e as Error).message || 'Could not submit the report.'
  }
}

const TEXTAREA_CLASS =
  'w-full min-h-[78px] rounded-md border border-[var(--border-strong)] bg-card px-3 py-2.5 text-base text-[var(--text-strong)] placeholder:text-[var(--text-subtle)] outline-none transition-[color,box-shadow,border-color] focus-visible:border-[var(--border-focus)] focus-visible:shadow-[var(--focus-ring)]'
</script>

<template>
  <div class="flex max-w-[920px] flex-col gap-5">
    <NuxtLink
      to="/care"
      class="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-[var(--text-strong)]"
    >
      <DsIcon name="arrow-left" :size="16" /> Care Console
    </NuxtLink>

    <TsLoadingState v-if="isLoading" label="Loading your shift…" :rows="6" />

    <DsEmptyState
      v-else-if="!data"
      icon="file-text"
      title="No building selected"
      description="Pick a building from the switcher to file a shift report."
    />

    <template v-else>
      <DsSectionHeader
        :eyebrow="`${finalized ? 'Finalizing shift' : 'Active shift'} · ${data.building.name}`"
        :title="finalized ? 'End-of-shift report' : 'Shift log'"
        :description="
          finalized
            ? 'The whole-shift questions. These are what the next shift reads.'
            : 'Log interactions and building events as they happen. None means a quiet shift.'
        "
      >
        <template #actions>
          <template v-if="finalized">
            <Badge :variant="ready ? 'success' : 'warning'" dot>
              {{ readyCount }} / {{ required.length }} required
            </Badge>
            <Button variant="ghost" :disabled="saving" @click="finalized = false">
              <DsIcon name="arrow-left" :size="17" />
              Back to logging
            </Button>
            <Button variant="secondary" :loading="saving" :disabled="!data.report" @click="persist">
              <DsIcon name="file-text" :size="17" />
              Save draft
            </Button>
            <Button variant="primary" :loading="submitting" :disabled="!ready" @click="submit">
              <DsIcon name="check" :size="17" />
              {{ submitting ? 'Submitting…' : 'Submit report' }}
            </Button>
          </template>
          <template v-else>
            <Badge v-if="data.entries.some((e) => e.significant)" variant="danger" dot>
              {{ data.entries.filter((e) => e.significant).length }} significant
            </Badge>
            <Badge variant="neutral" dot>
              {{ entriesFor('interaction').length }} interactions ·
              {{ entriesFor('event').length }} events
            </Badge>
            <Button
              variant="primary"
              :disabled="!can('wellness')"
              :title="denied('wellness') ?? 'Move on to the end-of-shift questions'"
              @click="finalized = true"
            >
              <DsIcon name="flag" :size="17" />
              Finalize my shift
            </Button>
          </template>
        </template>
      </DsSectionHeader>

      <!-- Auto-derived context — known from sign-in, never typed -->
      <div class="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(215px,1fr))]">
        <Card
          v-for="item in [
            { icon: 'user', label: 'Reporting', value: data.context.author },
            { icon: 'building-2', label: 'Site', value: data.building.name },
            { icon: 'calendar', label: 'Date', value: formatDate(data.context.shiftDate) },
            {
              icon: 'clock',
              label: 'Shift',
              value: `${data.context.shiftLabel.replace(' Staff', '')} · ${data.context.shiftHours}`,
            },
          ]"
          :key="item.label"
        >
          <CardContent class="flex items-center gap-3 p-4">
            <span class="inline-flex size-[34px] shrink-0 items-center justify-center rounded-md bg-[var(--brand-soft)] text-[var(--brand-strong)]">
              <DsIcon :name="item.icon" :size="17" />
            </span>
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="eyebrow">{{ item.label }}</span>
                <span class="inline-flex items-center gap-0.5 text-[10px] uppercase tracking-wide text-[var(--text-subtle)]">
                  <DsIcon name="lock" :size="10" /> auto
                </span>
              </div>
              <div class="truncate text-sm font-semibold text-[var(--text-strong)]">
                {{ item.value }}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Alert v-if="data.report?.staleShift" variant="warning">
        <DsIcon name="alert-triangle" :size="17" :stroke-width="2" />
        <AlertDescription>
          This draft was started on the {{ data.report.shiftKey }} shift of
          {{ formatDate(data.report.shiftDate) }}. Submit it before starting a new one — it stays
          filed under the shift it was opened for.
        </AlertDescription>
      </Alert>

      <!-- ------------------------------------------- Interaction + event -->
      <Card v-for="(config, log) in LOGS" :key="log">
        <CardContent class="flex flex-col gap-4 p-5">
          <div class="flex items-center gap-3">
            <span
              class="inline-flex size-9 shrink-0 items-center justify-center rounded-md"
              :style="{ background: config.soft, color: config.accent }"
            >
              <DsIcon :name="config.icon" :size="18" />
            </span>
            <div class="min-w-0 flex-1">
              <span class="eyebrow">{{ config.eyebrow }}</span>
              <div class="font-semibold text-[var(--text-strong)]">{{ config.title }}</div>
            </div>
            <Badge variant="neutral" dot>{{ entriesFor(log).length }} logged</Badge>
          </div>

          <p class="-mt-1 text-sm text-muted-foreground">{{ config.description }}</p>

          <p
            v-if="!entriesFor(log).length"
            class="flex items-center gap-2 text-base text-muted-foreground"
          >
            <DsIcon name="check-circle-2" :size="18" class="text-[var(--success)]" />
            {{ config.empty }}
          </p>

          <div
            v-for="(entry, i) in entriesFor(log)"
            :key="entry._id"
            class="overflow-hidden rounded-lg border"
            :class="entry.significant ? 'border-[var(--danger-border)]' : 'border-border'"
          >
            <div
              class="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2.5"
              :class="entry.significant ? 'bg-[var(--danger-soft)]' : 'bg-[var(--surface-sunken)]'"
            >
              <span
                class="tnum inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-xs font-bold text-white"
                :style="{ background: entry.significant ? 'var(--danger)' : 'var(--slate-600)' }"
              >
                {{ i + 1 }}
              </span>
              <span class="text-sm font-semibold text-[var(--text-strong)]">
                {{ entry.kindLabel }}
              </span>
              <span
                v-if="entry.residents.length"
                class="inline-flex flex-wrap items-center gap-1.5"
              >
                <TsResidentAvatar
                  v-for="person in entry.residents"
                  :key="person.tenantId"
                  :name="person.name"
                  :tenant-id="person.tenantId"
                  :photo-url="person.photoUrl"
                  :room="person.room"
                  size="xs"
                />
                <span class="text-xs font-semibold text-[var(--text-strong)]">
                  {{ entry.residents.map((p) => p.name).join(', ') }}
                </span>
              </span>
              <span class="text-xs text-muted-foreground">
                {{ entry.location }} ·
                {{ new Date(entry.occurredAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }}
              </span>
              <div class="ml-auto flex items-center gap-1.5">
                <Badge v-if="entry.significant" variant="danger">Significant</Badge>
                <Badge v-if="entry.cameraReview" variant="violet">Camera</Badge>
                <Badge v-if="entry.emergencyServices" variant="warning">Services attended</Badge>
                <Badge v-if="entry.evacuated" variant="danger">Evacuated</Badge>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove entry"
                  @click="deleteEntry(entry._id)"
                >
                  <DsIcon name="trash" :size="15" />
                </Button>
              </div>
            </div>
            <div class="flex flex-col gap-3 p-4">
              <p class="text-sm text-[var(--text-body)]">{{ entry.comments }}</p>
              <div class="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  :variant="entry.significant ? 'destructive' : 'secondary'"
                  @click="toggleEntryFlag(entry._id, 'significant', !entry.significant)"
                >
                  <DsIcon name="alert-triangle" :size="15" />
                  {{ entry.significant ? 'Significant' : 'Flag significant' }}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  @click="toggleEntryFlag(entry._id, 'cameraReview', !entry.cameraReview)"
                >
                  <DsIcon name="camera" :size="15" />
                  {{ entry.cameraReview ? 'Tagged for camera review' : 'Tag for camera review' }}
                </Button>
              </div>
            </div>
          </div>

          <!-- New entry -->
          <div
            v-if="formOpen === log"
            class="flex flex-col gap-4 rounded-lg border border-border p-4"
          >
            <div class="grid gap-3 sm:grid-cols-2">
              <DsField v-slot="{ id }" :label="log === 'event' ? 'Type of event' : 'What happened'" required>
                <Select v-model="draft.kind">
                  <SelectTrigger :id="id" class="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="k in config.kinds" :key="k.value" :value="k.value">
                      {{ k.label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </DsField>

              <DsField v-slot="{ id }" label="Where" required>
                <Select v-model="draft.location">
                  <SelectTrigger :id="id" class="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="l in LOCATIONS" :key="l" :value="l">{{ l }}</SelectItem>
                  </SelectContent>
                </Select>
              </DsField>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <DsField v-slot="{ id }" label="Time" hint="Leave blank for now.">
                <Input :id="id" v-model="draft.time" placeholder="e.g. 9:40 pm" />
              </DsField>
            </div>

            <DsField
              :label="log === 'event' ? 'Residents involved' : 'Residents'"
              :hint="
                log === 'event'
                  ? 'Only those directly involved. An event does not need a name against it.'
                  : 'Pick everyone the interaction involved — a dispute has two sides.'
              "
            >
              <TsResidentPicker
                v-model="draft.tenantIds"
                :residents="data.residents"
                :empty-label="
                  log === 'event' ? 'No resident involved' : 'Common area / nobody named yet'
                "
              />
            </DsField>

            <DsField
              v-slot="{ id }"
              label="What happened"
              required
              :error="entryError"
              hint="What happened, action taken, who was notified."
            >
              <textarea
                :id="id"
                v-model="draft.comments"
                :class="TEXTAREA_CLASS"
                :placeholder="
                  log === 'event'
                    ? 'Fire panel activated on the second floor at 02:10. Cause: burnt food. Reset with the alarm company…'
                    : 'Describe the interaction and the response…'
                "
              />
            </DsField>

            <div v-if="log === 'event'" class="flex flex-wrap gap-2">
              <Button
                :variant="draft.emergencyServices ? 'primary' : 'secondary'"
                size="sm"
                @click="draft.emergencyServices = !draft.emergencyServices"
              >
                <DsIcon name="shield-check" :size="15" />
                Emergency services attended
              </Button>
              <Button
                :variant="draft.evacuated ? 'destructive' : 'secondary'"
                size="sm"
                @click="draft.evacuated = !draft.evacuated"
              >
                <DsIcon name="door" :size="15" />
                Building evacuated
              </Button>
            </div>

            <div class="flex flex-wrap gap-2">
              <Button
                :variant="draft.significant ? 'destructive' : 'secondary'"
                size="sm"
                @click="draft.significant = !draft.significant"
              >
                <DsIcon name="alert-triangle" :size="15" />
                Flag significant
              </Button>
              <Button
                :variant="draft.cameraReview ? 'primary' : 'secondary'"
                size="sm"
                @click="draft.cameraReview = !draft.cameraReview"
              >
                <DsIcon name="camera" :size="15" />
                Tag for camera review
              </Button>
              <div class="flex-1" />
              <Button variant="ghost" size="sm" @click="formOpen = null">Cancel</Button>
              <Button variant="primary" size="sm" :loading="adding" @click="logEntry">
                <DsIcon name="check" :size="15" />
                {{ adding ? 'Saving…' : 'Save' }}
              </Button>
            </div>
          </div>

          <div v-else>
            <Button
              variant="soft"
              :disabled="!can('wellness')"
              :title="denied('wellness') ?? undefined"
              @click="startEntry(log)"
            >
              <DsIcon name="plus" :size="17" />
              {{ config.add }}
            </Button>
          </div>
        </CardContent>
      </Card>

      <!-- --------------------------------------------- Finalize: phase two -->
      <template v-if="finalized">
        <!-- Wellness checks, from the record rather than a number typed in -->
        <Card>
          <CardContent class="flex flex-col gap-4 p-5">
            <div class="flex items-center gap-3">
              <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--brand-soft)] text-[var(--brand-strong)]">
                <DsIcon name="clipboard-check" :size="18" />
              </span>
              <div class="min-w-0 flex-1">
                <span class="eyebrow">Whole shift</span>
                <div class="font-semibold text-[var(--text-strong)]">Wellness checks</div>
              </div>
              <Badge :variant="data.checks.missed.length ? 'warning' : 'success'" dot>
                {{
                  data.checks.missed.length
                    ? `${data.checks.missed.length} not checked`
                    : 'All checked'
                }}
              </Badge>
            </div>

            <div class="flex items-baseline gap-2">
              <span class="tnum text-2xl font-extrabold text-[var(--text-strong)]">
                {{ data.checks.completed }}
              </span>
              <span class="tnum text-lg font-semibold text-[var(--text-subtle)]">
                / {{ data.checks.total }}
              </span>
              <span class="ml-2 text-sm text-muted-foreground">
                counted from the checks you logged — not typed in
              </span>
            </div>

            <div
              v-if="data.checks.missed.length"
              class="flex flex-col gap-2 rounded-md bg-[var(--surface-sunken)] p-4"
            >
              <span class="eyebrow">Not checked this shift</span>
              <div
                v-for="resident in data.checks.missed"
                :key="resident._id"
                class="flex items-center gap-3 text-sm"
              >
                <span class="mono w-10 font-semibold text-[var(--text-strong)]">
                  {{ resident.room }}
                </span>
                <span class="min-w-0 flex-1 truncate">{{ resident.name }}</span>
                <Badge v-if="resident.outcome" variant="warning">{{ resident.outcome }}</Badge>
                <Badge v-else variant="neutral">No record</Badge>
              </div>
              <p class="text-xs text-muted-foreground">
                Record the reason against each resident from the Care Console — a refusal is
                information, and the next shift needs it.
              </p>
            </div>
          </CardContent>
        </Card>

        <!-- Whole-shift checklist -->
        <Card>
          <CardContent class="flex flex-col gap-4 p-5">
            <div class="flex items-center gap-3">
              <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--indigo-50)] text-[var(--indigo-600)]">
                <DsIcon name="list-checks" :size="18" />
              </span>
              <div class="min-w-0 flex-1">
                <span class="eyebrow">Supplementary</span>
                <div class="font-semibold text-[var(--text-strong)]">Whole-shift checklist</div>
              </div>
              <Badge
                :variant="radioCheck && handover && readPrevious ? 'success' : 'warning'"
                dot
              >
                {{ [radioCheck, handover, readPrevious].filter(Boolean).length }}/3
              </Badge>
            </div>

            <div
              v-for="row in [
                { key: 'radio', icon: 'bell', label: 'Radio check completed', desc: 'Confirmed working comms with on-call', model: 'radioCheck' },
                { key: 'handover', icon: 'arrow-right', label: 'Handover received / given', desc: 'Verbal handover with previous and next staff', model: 'handover' },
                { key: 'read', icon: 'file-text', label: 'Read previous shift reports', desc: 'Reviewed the last two reports', model: 'readPrevious' },
              ]"
              :key="row.key"
              class="flex items-center gap-3 border-t border-[var(--border-subtle)] py-3"
            >
              <span
                class="inline-flex size-8 shrink-0 items-center justify-center rounded-md"
                :class="
                  (row.model === 'radioCheck' ? radioCheck : row.model === 'handover' ? handover : readPrevious)
                    ? 'bg-[var(--brand-soft)] text-[var(--brand-strong)]'
                    : 'bg-[var(--surface-sunken)] text-[var(--text-subtle)]'
                "
              >
                <DsIcon :name="row.icon" :size="16" />
              </span>
              <div class="min-w-0 flex-1">
                <div class="text-sm font-semibold text-[var(--text-strong)]">{{ row.label }}</div>
                <div class="text-xs text-[var(--text-subtle)]">{{ row.desc }}</div>
              </div>
              <Switch
                v-if="row.model === 'radioCheck'"
                v-model="radioCheck"
                :aria-label="row.label"
              />
              <Switch
                v-else-if="row.model === 'handover'"
                v-model="handover"
                :aria-label="row.label"
              />
              <Switch v-else v-model="readPrevious" :aria-label="row.label" />
            </div>

            <div class="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-4">
              <span class="eyebrow">
                Duties · {{ dutiesDone }}/{{ data.duties.length }} — {{ data.dutyTitle }}
              </span>
              <label
                v-for="duty in data.duties"
                :key="duty.key"
                class="flex cursor-pointer items-center gap-3"
              >
                <button
                  type="button"
                  class="inline-flex size-6 shrink-0 items-center justify-center rounded-sm border transition-colors"
                  :class="
                    duties[duty.key]
                      ? 'border-[var(--green-500)] bg-[var(--green-500)]'
                      : 'border-[var(--border-strong)] bg-card'
                  "
                  :aria-label="duty.label"
                  @click="duties[duty.key] = !duties[duty.key]"
                >
                  <DsIcon
                    v-if="duties[duty.key]"
                    name="check"
                    :size="15"
                    :stroke-width="2.6"
                    class="text-white"
                  />
                </button>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-semibold text-[var(--text-strong)]">
                    {{ duty.label }}
                  </span>
                  <span class="block text-xs text-[var(--text-subtle)]">{{ duty.meta }}</span>
                </span>
              </label>
            </div>

            <DsField label="Extra tasks completed" hint="Anything beyond the standard checklist.">
              <textarea
                v-model="extraTasks"
                :class="TEXTAREA_CLASS"
                placeholder="e.g. Assisted 208 with laundry; cleared a blocked drain on the third floor…"
              />
            </DsField>
          </CardContent>
        </Card>

        <!-- Handover -->
        <Card>
          <CardContent class="flex flex-col gap-4 p-5">
            <div class="flex items-center gap-3">
              <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--violet-50)] text-[var(--violet-600)]">
                <DsIcon name="notes" :size="18" />
              </span>
              <div class="min-w-0 flex-1">
                <span class="eyebrow">Whole shift</span>
                <div class="font-semibold text-[var(--text-strong)]">Handover & important info</div>
              </div>
            </div>

            <DsField
              label="Shift summary"
              required
              hint="A short narrative of how the shift went overall."
              :error="submitError"
            >
              <textarea
                v-model="summary"
                :class="TEXTAREA_CLASS"
                placeholder="Quiet evening apart from the lobby incident. Two wellness-check refusals escalated…"
              />
            </DsField>

            <DsField
              label="Important info for next shift"
              hint="Anything the incoming staff must know."
            >
              <textarea
                v-model="importantInfo"
                :class="TEXTAREA_CLASS"
                placeholder="118 still not contacted in four shifts — manager following up. 410 wound dressing due overnight."
              />
            </DsField>
          </CardContent>
        </Card>

        <div class="flex flex-wrap items-center gap-3 pb-8">
          <span
            v-if="!ready"
            class="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
          >
            <DsIcon name="info" :size="15" />
            {{ readyCount }} of {{ required.length }} required items complete —
            {{ required.filter((r) => !r.ok).map((r) => r.label.toLowerCase()).join(', ') }}.
          </span>
          <span v-else class="inline-flex items-center gap-1.5 text-sm text-[var(--success)]">
            <DsIcon name="check-circle-2" :size="15" />
            Ready to submit.
          </span>
          <div class="flex-1" />
          <Button variant="ghost" @click="finalized = false">
            <DsIcon name="arrow-left" :size="17" />
            Back to logging
          </Button>
          <Button variant="secondary" :loading="saving" :disabled="!data.report" @click="persist">
            <DsIcon name="file-text" :size="17" />
            Save draft
          </Button>
          <Button variant="primary" :loading="submitting" :disabled="!ready" @click="submit">
            <DsIcon name="check" :size="17" />
            {{ submitting ? 'Submitting…' : 'Submit report' }}
          </Button>
        </div>
      </template>

      <!-- Finalize prompt -->
      <Card v-else>
        <CardContent class="flex flex-wrap items-center gap-4 p-5">
          <span class="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-[var(--brand-soft)] text-[var(--brand-strong)]">
            <DsIcon name="flag" :size="20" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="font-semibold text-[var(--text-strong)]">Done logging for this shift?</div>
            <div class="text-sm text-muted-foreground">
              Finalize to add the wellness-check count, the whole-shift checklist and the handover
              notes.
            </div>
          </div>
          <Button
            variant="primary"
            :disabled="!can('wellness')"
            :title="denied('wellness') ?? undefined"
            @click="finalized = true"
          >
            <DsIcon name="flag" :size="17" />
            Finalize my shift
          </Button>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
