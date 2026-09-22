<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { formatMinutes, formatShortDate } from '~/utils/format'
import type { DoseTarget } from '~/components/app/DoseDialog.vue'
import type { MedicationOrder } from '~/components/app/MedicationDialog.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Medications — the MAR board.
 *
 * Every resident on the programme, every live order, one cell per dose. A cell
 * is a button: tap it to chart. Colour says where a dose stands — due,
 * overdue, charted, or a gap on a past day — and nothing on this screen
 * moves except when somebody charts.
 */
const { selected } = useSelectedBuilding()
const { can, denied } = useMe()

const tz = new Date().getTimezoneOffset()
const now = useNow()

function localToday() {
  return new Date(Date.now() - tz * 60_000).toISOString().slice(0, 10)
}
const date = ref(localToday())
const isToday = computed(() => date.value === localToday())

function shiftDate(days: number) {
  const d = new Date(`${date.value}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  date.value = d.toISOString().slice(0, 10)
}

const { data, isLoading } = useConvexQuery(api.medications.board, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
  date: date.value,
  now: now.value,
  tzOffsetMinutes: tz,
}))

usePageHeader(() => ({
  eyebrow: data.value?.building.name ?? '',
  title: 'Medications',
}))

/* ---- Charting ------------------------------------------------------- */

const doseOpen = ref(false)
const doseTarget = ref<DoseTarget | null>(null)

type Resident = NonNullable<typeof data.value>['residents'][number]
type Order = Resident['medications'][number]
type Slot = Order['slots'][number]

function chart(resident: Resident, order: Order, slot: Slot | null) {
  if (!can('medications')) return
  if (slot?.administration) return
  if (slot && slot.status === 'upcoming' && !isToday.value) return
  doseTarget.value = {
    medicationId: order._id,
    residentName: resident.name,
    medication: order.strength ? `${order.name} ${order.strength}` : order.name,
    dose: order.dose,
    instructions: order.instructions,
    prn: order.prn,
    prnIndication: order.prnIndication,
    date: date.value,
    scheduledMinutes: slot?.minutes ?? null,
  }
  doseOpen.value = true
}

/* ---- Voiding -------------------------------------------------------- */

const { mutate: voidEntry } = useConvexMutation(api.medications.voidEntry)

async function strike(administrationId: Id<'medicationAdministrations'>) {
  const reason = window.prompt('Why is this entry being voided? It stays on the record, struck through.')
  if (reason === null) return
  try {
    await voidEntry({ administrationId, reason })
    toast.success('Entry voided — the slot is open again')
  } catch (e) {
    toast.error('Could not void the entry', { description: (e as Error).message })
  }
}

/* ---- Orders --------------------------------------------------------- */

const orderOpen = ref(false)
const orderTenant = ref<Id<'tenants'> | null>(null)
const editing = ref<MedicationOrder | null>(null)

function addOrder(tenantId: Id<'tenants'> | null) {
  orderTenant.value = tenantId
  editing.value = null
  orderOpen.value = true
}

function editOrder(tenantId: Id<'tenants'>, order: Order) {
  orderTenant.value = tenantId
  editing.value = order
  orderOpen.value = true
}

const programmeResidents = computed(() =>
  (data.value?.residents ?? [])
    .filter((r) => r.onProgramme)
    .map((r) => ({ tenantId: r.tenantId, name: r.name, room: r.room })),
)

/* ---- Presentation --------------------------------------------------- */

const STATUS: Record<
  Slot['status'],
  { classes: string; label: string }
> = {
  upcoming: {
    classes: 'border-[var(--border-subtle)] bg-card text-muted-foreground hover:border-[var(--border-strong)]',
    label: 'Upcoming',
  },
  due: {
    classes: 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)] hover:bg-[var(--brand-soft)]',
    label: 'Due now',
  },
  overdue: {
    classes: 'border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]',
    label: 'Overdue',
  },
  'not-charted': {
    classes: 'border-dashed border-[var(--danger)] bg-card text-[var(--danger)]',
    label: 'Not charted',
  },
  charted: { classes: '', label: 'Charted' },
}

const OUTCOME: Record<string, { classes: string; label: string; code: string }> = {
  given: { classes: 'border-[var(--success)] bg-[var(--success-soft)] text-[var(--success)]', label: 'Given', code: '✓' },
  refused: { classes: 'border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]', label: 'Refused', code: 'R' },
  held: { classes: 'border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]', label: 'Held', code: 'H' },
  absent: { classes: 'border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]', label: 'Absent', code: 'A' },
  'not-given': { classes: 'border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]', label: 'Not given', code: 'N' },
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

type Given = NonNullable<Slot['administration']>

/** The tooltip on a charted cell: the whole story, since the cell has room for two lines. */
function describe(a: Given): string {
  const parts = [
    `${OUTCOME[a.outcome]!.label} at ${clock(a.givenAt)}`,
    a.timing && a.timing !== 'on-time' ? `(${a.timing})` : '',
    a.recordedBy ? `by ${a.recordedBy}` : '',
    a.backCharted ? `· charted ${clock(a.recordedAt)}` : '',
    a.reason ? `— ${a.reason}` : '',
  ]
  return `${parts.filter(Boolean).join(' ')}. Click to void.`
}

const ROUTE_LABEL: Record<string, string> = {
  oral: 'Oral',
  sublingual: 'SL',
  topical: 'Topical',
  inhaled: 'Inhaled',
  injection: 'Inj.',
  'eye-ear': 'Eye/ear',
  other: 'Other',
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <DsSectionHeader
      :eyebrow="data?.building.name"
      title="Medications"
      description="The administration record for residents on the programme. Tap a dose to chart it; anything other than given needs a reason."
    >
      <template #actions>
        <div class="flex items-center gap-1">
          <Button variant="secondary" size="icon-sm" aria-label="Previous day" @click="shiftDate(-1)">
            <DsIcon name="chevron-left" :size="16" />
          </Button>
          <DsDatePicker
            :model-value="date"
            :max="localToday()"
            class="w-[190px]"
            @update:model-value="(v) => v && (date = v)"
          />
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label="Next day"
            :disabled="isToday"
            @click="shiftDate(1)"
          >
            <DsIcon name="chevron-right" :size="16" />
          </Button>
        </div>
        <Button v-if="!isToday" variant="ghost" size="sm" @click="date = localToday()">
          Back to today
        </Button>
        <Button
          variant="primary"
          :disabled="!can('medications')"
          :title="denied('medications') ?? 'Add an order'"
          @click="addOrder(null)"
        >
          <DsIcon name="plus" :size="17" />
          Add order
        </Button>
      </template>
    </DsSectionHeader>

    <div v-if="data" class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
      <DsStatCard
        icon="clock"
        accent="brand"
        label="Due now"
        :value="data.counts.due"
        :sublabel="isToday ? 'Inside the hour either side' : 'Not today'"
      />
      <DsStatCard
        icon="alert-triangle"
        accent="rose"
        label="Overdue"
        :value="data.counts.overdue"
        sublabel="Past the window, nothing charted"
      />
      <DsStatCard
        icon="check-circle-2"
        accent="teal"
        label="Given"
        :value="data.counts.given"
        :denominator="data.counts.doses"
        :sublabel="`Scheduled doses ${isToday ? 'today' : formatShortDate(date)}`"
      />
      <DsStatCard
        icon="alert-circle"
        accent="amber"
        label="Not given"
        :value="data.counts.notGiven"
        sublabel="Refused, held, absent or not given"
      />
      <DsStatCard
        icon="clock"
        accent="amber"
        label="Off schedule"
        :value="data.counts.late"
        sublabel="Given over an hour early or late"
      />
      <DsStatCard
        icon="pill"
        accent="violet"
        label="PRN doses"
        :value="data.counts.prn"
        sublabel="As-needed doses charted"
      />
    </div>

    <TsLoadingState v-if="isLoading" label="Loading the record…" :rows="5" />

    <DsEmptyState
      v-else-if="!data?.residents.length"
      icon="pill"
      accent="var(--violet-600)"
      title="Nobody on the medication programme"
      description="Residents appear here once their health record marks them as on the programme. Orders are then transcribed from the pharmacy label."
    />

    <div v-else class="flex flex-col gap-3">
      <Card v-for="resident in data.residents" :key="resident.tenantId">
        <CardContent class="flex flex-col gap-4 p-5">
          <div class="flex flex-wrap items-start gap-4">
            <TsResidentAvatar
              :name="resident.name"
              :tenant-id="resident.tenantId"
              :photo-url="resident.photoUrl"
              :room="resident.room"
              :support-level="resident.supportLevel"
              size="md"
            />

            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <NuxtLink
                  :to="`/medications/${resident.tenantId}`"
                  class="font-semibold text-[var(--text-strong)] hover:underline"
                >
                  {{ resident.name }}
                </NuxtLink>
                <span class="mono text-sm text-muted-foreground">Room {{ resident.room }}</span>
                <Badge v-if="resident.overdue" variant="danger" dot>
                  {{ resident.overdue }} overdue
                </Badge>
                <Badge v-else-if="resident.due" variant="brand" dot>{{ resident.due }} due</Badge>
                <Badge v-if="!resident.onProgramme" variant="warning">
                  Programme flag cleared — live orders remain
                </Badge>
              </div>
              <p class="mt-0.5 text-sm">
                <span class="eyebrow">Allergies</span>
                <span
                  class="ml-2"
                  :class="resident.allergies ? 'font-semibold text-[var(--danger)]' : 'text-muted-foreground'"
                >
                  {{ resident.allergies || 'None recorded' }}
                </span>
              </p>
            </div>

            <div class="flex shrink-0 items-center gap-1.5">
              <Button variant="secondary" size="sm" @click="navigateTo(`/medications/${resident.tenantId}`)">
                <DsIcon name="file-text" :size="15" />
                Record
              </Button>
              <Button
                variant="secondary"
                size="sm"
                :disabled="!can('medications')"
                :title="denied('medications') ?? 'Add an order'"
                @click="addOrder(resident.tenantId)"
              >
                <DsIcon name="plus" :size="15" />
                Order
              </Button>
            </div>
          </div>

          <p v-if="!resident.medications.length" class="text-sm text-muted-foreground">
            No live orders on file for {{ isToday ? 'today' : formatShortDate(date) }}.
          </p>

          <div v-else class="flex flex-col divide-y divide-[var(--border-subtle)]">
            <div
              v-for="order in resident.medications"
              :key="order._id"
              class="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 first:pt-0 last:pb-0"
            >
              <div class="min-w-[200px] flex-1">
                <p class="text-base font-semibold text-[var(--text-strong)]">
                  {{ order.name }}
                  <span v-if="order.strength" class="font-normal text-muted-foreground">{{ order.strength }}</span>
                </p>
                <p class="text-xs text-muted-foreground">
                  {{ order.dose }} · {{ ROUTE_LABEL[order.route] }}
                  <template v-if="order.prn"> · as needed<template v-if="order.prnIndication">, {{ order.prnIndication }}</template></template>
                  <template v-if="order.instructions"> · {{ order.instructions }}</template>
                  <template v-if="order.discontinuedAt"> · <span class="font-semibold text-[var(--danger)]">stopped {{ clock(order.discontinuedAt) }}</span></template>
                </p>
              </div>

              <Button
                v-if="!order.discontinuedAt"
                variant="ghost"
                size="icon-sm"
                aria-label="Change or correct this order"
                :disabled="!can('medications')"
                :title="denied('medications') ?? 'Change the prescription, or correct a transcription'"
                @click="editOrder(resident.tenantId, order)"
              >
                <DsIcon name="pencil" :size="15" />
              </Button>

              <!-- Scheduled doses -->
              <div v-if="!order.prn" class="flex flex-wrap items-center gap-1.5">
                <template v-for="slot in order.slots" :key="slot.minutes">
                  <button
                    v-if="slot.administration"
                    type="button"
                    class="group flex min-w-[92px] flex-col items-start rounded-md border px-2.5 py-1.5 text-left"
                    :class="OUTCOME[slot.administration.outcome]!.classes"
                    :title="describe(slot.administration)"
                    :disabled="!can('medications')"
                    @click="strike(slot.administration._id)"
                  >
                    <span class="flex items-center gap-1 text-xs font-semibold tnum">
                      {{ formatMinutes(slot.minutes) }}
                      <span class="font-bold">{{ OUTCOME[slot.administration.outcome]!.code }}</span>
                      <span
                        v-if="slot.administration.timing && slot.administration.timing !== 'on-time'"
                        class="rounded-sm bg-[var(--warning)] px-1 text-[10px] uppercase leading-4 text-[var(--text-on-accent)]"
                      >
                        {{ slot.administration.timing }}
                      </span>
                    </span>
                    <span class="text-[11px] leading-tight opacity-80 tnum">
                      {{ slot.administration.outcome === 'given' ? 'given' : 'at' }} {{ clock(slot.administration.givenAt) }}
                      <template v-if="slot.administration.recordedBy"> · {{ slot.administration.recordedBy.split(' ')[0] }}</template>
                    </span>
                    <span v-if="slot.administration.backCharted" class="text-[10px] leading-tight opacity-70 tnum">
                      charted {{ clock(slot.administration.recordedAt) }}
                    </span>
                  </button>
                  <button
                    v-else
                    type="button"
                    class="flex min-w-[92px] flex-col items-start rounded-md border px-2.5 py-1.5 text-left transition-colors"
                    :class="STATUS[slot.status].classes"
                    :disabled="!can('medications') || slot.status === 'upcoming' && !isToday"
                    :title="denied('medications') ?? `${STATUS[slot.status].label} — chart this dose`"
                    @click="chart(resident, order, slot)"
                  >
                    <span class="text-xs font-semibold tnum">{{ formatMinutes(slot.minutes) }}</span>
                    <span class="text-[11px] leading-tight">{{ STATUS[slot.status].label }}</span>
                  </button>
                </template>
              </div>

              <!-- PRN -->
              <div v-else class="flex flex-wrap items-center gap-1.5">
                <span
                  v-for="row in order.prnToday"
                  :key="row._id"
                  class="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs"
                  :class="OUTCOME[row.outcome]!.classes"
                  :title="row.reason ?? undefined"
                >
                  <span class="font-bold">{{ OUTCOME[row.outcome]!.code }}</span>
                  {{ clock(row.givenAt) }}
                  <template v-if="row.recordedBy"> · {{ row.recordedBy }}</template>
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  :disabled="!can('medications') || (order.prnMaxPerDay !== null && order.prnToday.filter((r) => r.outcome === 'given').length >= order.prnMaxPerDay)"
                  :title="denied('medications') ?? (order.prnMaxPerDay !== null ? `Up to ${order.prnMaxPerDay} a day` : 'Chart an as-needed dose')"
                  @click="chart(resident, order, null)"
                >
                  <DsIcon name="plus" :size="15" />
                  PRN dose
                  <span v-if="order.prnMaxPerDay !== null" class="tnum text-muted-foreground">
                    {{ order.prnToday.filter((r) => r.outcome === 'given').length }}/{{ order.prnMaxPerDay }}
                  </span>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    <TsDoseDialog :open="doseOpen" :target="doseTarget" @close="doseOpen = false" />
    <TsMedicationDialog
      :open="orderOpen"
      :residents="programmeResidents"
      :tenant-id="orderTenant"
      :order="editing"
      @close="orderOpen = false"
    />
  </div>
</template>
