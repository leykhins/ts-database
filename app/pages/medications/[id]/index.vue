<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { formatDate, formatMinutes, formatShortDate, yearsSince } from '~/utils/format'
import type { MedicationOrder } from '~/components/app/MedicationDialog.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * One resident's medication record: every order they have had, and the last
 * fortnight of doses with voided entries struck through rather than hidden.
 */
const route = useRoute()
const tenantId = computed(() => route.params.id as Id<'tenants'>)
const { can, denied } = useMe()

const tz = new Date().getTimezoneOffset()
const now = useNow()

const { data, isLoading } = useConvexQuery(api.medications.forResident, () => ({
  tenantId: tenantId.value,
  now: now.value,
  tzOffsetMinutes: tz,
}))

usePageHeader(() => ({
  eyebrow: 'Medication record',
  title: data.value?.tenant.name ?? 'Resident',
}))

const thisMonth = computed(() => new Date(Date.now() - tz * 60_000).toISOString().slice(0, 7))

/* ---- Orders --------------------------------------------------------- */

const orderOpen = ref(false)
const editing = ref<MedicationOrder | null>(null)

function addOrder() {
  editing.value = null
  orderOpen.value = true
}

type Order = NonNullable<typeof data.value>['active'][number]

function edit(order: Order) {
  editing.value = order
  orderOpen.value = true
}

const { mutate: discontinue } = useConvexMutation(api.medications.discontinue)

async function stop(order: Order) {
  const reason = window.prompt(`Why is ${order.name} being discontinued? It stays on the record.`)
  if (reason === null) return
  try {
    await discontinue({ medicationId: order._id, reason })
    toast.success('Order discontinued')
  } catch (e) {
    toast.error('Could not discontinue the order', { description: (e as Error).message })
  }
}

const { mutate: voidEntry } = useConvexMutation(api.medications.voidEntry)

async function strike(administrationId: Id<'medicationAdministrations'>) {
  const reason = window.prompt('Why is this entry being voided? It stays on the record, struck through.')
  if (reason === null) return
  try {
    await voidEntry({ administrationId, reason })
    toast.success('Entry voided')
  } catch (e) {
    toast.error('Could not void the entry', { description: (e as Error).message })
  }
}

/* ---- Presentation --------------------------------------------------- */

const ROUTE_LABEL: Record<string, string> = {
  oral: 'Oral',
  sublingual: 'Sublingual',
  topical: 'Topical',
  inhaled: 'Inhaled',
  injection: 'Injection',
  'eye-ear': 'Eye / ear',
  other: 'Other',
}

const OUTCOME_VARIANT: Record<string, 'success' | 'warning' | 'danger'> = {
  given: 'success',
  refused: 'warning',
  held: 'warning',
  absent: 'warning',
  'not-given': 'danger',
}

const OUTCOME_LABEL: Record<string, string> = {
  given: 'Given',
  refused: 'Refused',
  held: 'Held',
  absent: 'Absent',
  'not-given': 'Not given',
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function schedule(order: Order): string {
  if (order.prn) {
    return `As needed${order.prnIndication ? ` — ${order.prnIndication}` : ''}${order.prnMaxPerDay ? `, up to ${order.prnMaxPerDay}/day` : ''}`
  }
  return order.times.map(formatMinutes).join(' · ')
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <TsLoadingState v-if="isLoading" label="Loading the record…" :rows="4" />

    <DsEmptyState
      v-else-if="!data"
      icon="pill"
      title="No such resident"
      description="This record does not exist, or belongs to a building you are not assigned to."
    />

    <template v-else>
      <Card>
        <CardContent class="flex flex-wrap items-start gap-4 p-5">
          <TsResidentAvatar
            :name="data.tenant.name"
            :tenant-id="data.tenant._id"
            :photo-url="data.tenant.photoUrl"
            :room="data.tenant.room"
            size="xl"
          />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="text-xl font-semibold text-[var(--text-strong)]">{{ data.tenant.name }}</h1>
              <span class="mono text-sm text-muted-foreground">Room {{ data.tenant.room }}</span>
              <span v-if="data.tenant.dob" class="text-sm text-muted-foreground">
                · {{ yearsSince(data.tenant.dob) }} · {{ formatDate(data.tenant.dob) }}
              </span>
              <Badge v-if="!data.tenant.onProgramme" variant="warning">Programme flag cleared</Badge>
            </div>
            <p class="mt-1 text-sm">
              <span class="eyebrow">Allergies</span>
              <span
                class="ml-2"
                :class="data.tenant.allergies ? 'font-semibold text-[var(--danger)]' : 'text-muted-foreground'"
              >
                {{ data.tenant.allergies || 'None recorded' }}
              </span>
            </p>
          </div>
          <div class="flex shrink-0 flex-wrap items-center gap-1.5">
            <Button variant="secondary" size="sm" @click="navigateTo(`/tenants/${data.tenant._id}`)">
              <DsIcon name="user" :size="15" />
              Resident record
            </Button>
            <Button
              variant="secondary"
              size="sm"
              @click="navigateTo(`/medications/${data.tenant._id}/print?month=${thisMonth}`)"
            >
              <DsIcon name="printer" :size="15" />
              Print MAR
            </Button>
            <Button
              variant="primary"
              size="sm"
              :disabled="!can('medications') || !data.tenant.onProgramme"
              :title="denied('medications') ?? (data.tenant.onProgramme ? 'Add an order' : 'Mark the resident as on the programme first')"
              @click="addOrder"
            >
              <DsIcon name="plus" :size="15" />
              Add order
            </Button>
          </div>
        </CardContent>
      </Card>

      <div class="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div class="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader>
              <span class="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-[var(--surface-sunken)] text-muted-foreground">
                <DsIcon name="pill" :size="18" />
              </span>
              <div class="flex min-w-0 flex-col gap-px">
                <span class="eyebrow">Current</span>
                <CardTitle>Active orders</CardTitle>
              </div>
              <CardAction>
                <Badge variant="neutral">{{ data.active.length }}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent class="flex flex-col divide-y divide-[var(--border-subtle)] p-0">
              <p v-if="!data.active.length" class="p-5 text-sm text-muted-foreground">No active orders.</p>
              <div
                v-for="order in data.active"
                :key="order._id"
                class="flex flex-wrap items-start gap-3 px-5 py-3.5"
              >
                <div class="min-w-0 flex-1">
                  <p class="text-base font-semibold text-[var(--text-strong)]">
                    {{ order.name }}
                    <span v-if="order.strength" class="font-normal text-muted-foreground">{{ order.strength }}</span>
                  </p>
                  <p class="text-sm text-[var(--text-body)]">
                    {{ order.dose }} · {{ ROUTE_LABEL[order.route] }} · {{ schedule(order) }}
                  </p>
                  <p v-if="order.replaces" class="text-xs font-medium text-[var(--brand)]">
                    Replaced {{ order.replaces }}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    <template v-if="order.instructions">{{ order.instructions }} · </template>
                    Since {{ formatShortDate(order.startDate) }}
                    <template v-if="order.endDate"> until {{ formatShortDate(order.endDate) }}</template>
                    <template v-if="order.prescriber"> · {{ order.prescriber }}</template>
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    aria-label="Change or correct order"
                    :disabled="!can('medications')"
                    :title="denied('medications') ?? 'Change the prescription, or correct a transcription'"
                    @click="edit(order)"
                  >
                    <DsIcon name="pencil" :size="16" />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    :disabled="!can('medications')"
                    :title="denied('medications') ?? 'Discontinue'"
                    @click="stop(order)"
                  >
                    <DsIcon name="x" :size="15" />
                    Discontinue
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card v-if="data.inactive.length">
            <CardHeader>
              <span class="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-[var(--surface-sunken)] text-muted-foreground">
                <DsIcon name="clock" :size="18" />
              </span>
              <div class="flex min-w-0 flex-col gap-px">
                <span class="eyebrow">History</span>
                <CardTitle>Discontinued and ended orders</CardTitle>
              </div>
            </CardHeader>
            <CardContent class="flex flex-col divide-y divide-[var(--border-subtle)] p-0">
              <div v-for="order in data.inactive" :key="order._id" class="px-5 py-3.5">
                <p class="text-base font-semibold text-[var(--text-body)]">
                  {{ order.name }}
                  <span v-if="order.strength" class="font-normal text-muted-foreground">{{ order.strength }}</span>
                </p>
                <p class="text-sm text-muted-foreground">
                  {{ order.dose }} · {{ ROUTE_LABEL[order.route] }} · {{ schedule(order) }}
                </p>
                <p class="text-xs text-muted-foreground">
                  {{ formatShortDate(order.startDate) }}
                  <template v-if="order.discontinuedAt">
                    – discontinued {{ formatDate(order.discontinuedAt) }}
                    <template v-if="order.discontinuedBy"> by {{ order.discontinuedBy }}</template>
                    <template v-if="order.discontinuedReason">: {{ order.discontinuedReason }}</template>
                  </template>
                  <template v-else-if="order.endDate"> – ended {{ formatShortDate(order.endDate) }}</template>
                  <template v-else> – starts {{ formatShortDate(order.startDate) }}</template>
                </p>
                <p v-if="order.replacedBy" class="text-xs font-medium text-[var(--brand)]">
                  Replaced by {{ order.replacedBy }}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card class="min-w-0">
          <CardHeader>
            <span class="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-[var(--surface-sunken)] text-muted-foreground">
              <DsIcon name="list-checks" :size="18" />
            </span>
            <div class="flex min-w-0 flex-col gap-px">
              <span class="eyebrow">Last 14 days</span>
              <CardTitle>Doses charted</CardTitle>
            </div>
          </CardHeader>
          <CardContent class="flex flex-col divide-y divide-[var(--border-subtle)] p-0">
            <p v-if="!data.history.length" class="p-5 text-sm text-muted-foreground">
              Nothing charted in the last fortnight.
            </p>
            <div
              v-for="row in data.history"
              :key="row._id"
              class="flex flex-wrap items-start gap-2 px-5 py-3"
              :class="row.voidedAt ? 'opacity-60' : ''"
            >
              <div class="min-w-0 flex-1">
                <p class="text-sm" :class="row.voidedAt ? 'line-through' : ''">
                  <span class="font-semibold text-[var(--text-strong)]">{{ row.medication }}</span>
                  <span v-if="row.dose" class="text-muted-foreground"> · {{ row.dose }}</span>
                </p>
                <p class="text-xs text-muted-foreground tnum">
                  {{ formatShortDate(row.date) }}
                  <template v-if="row.scheduledMinutes !== null"> · {{ formatMinutes(row.scheduledMinutes) }} dose</template>
                  <template v-else> · PRN</template>
                  · <span class="font-semibold text-[var(--text-body)]">{{ row.outcome === 'given' ? 'given' : 'at' }} {{ clock(row.givenAt) }}</span>
                  <span
                    v-if="row.timing && row.timing !== 'on-time'"
                    class="ml-1 rounded-sm bg-[var(--warning-soft)] px-1 font-semibold uppercase text-[var(--warning)]"
                  >{{ row.timing }}</span>
                  <template v-if="row.recordedBy"> · {{ row.recordedBy }}</template>
                  <template v-if="row.backCharted"> · charted {{ formatShortDate(row.recordedAt) }} {{ clock(row.recordedAt) }}</template>
                </p>
                <p v-if="row.reason" class="text-xs text-[var(--text-body)]">{{ row.reason }}</p>
                <p v-if="row.note" class="text-xs text-muted-foreground">{{ row.note }}</p>
                <p v-if="row.voidedAt" class="text-xs font-medium text-[var(--danger)]">
                  Voided {{ formatDate(row.voidedAt) }}<template v-if="row.voidedBy"> by {{ row.voidedBy }}</template>:
                  {{ row.voidReason }}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <Badge :variant="OUTCOME_VARIANT[row.outcome]" dot>{{ OUTCOME_LABEL[row.outcome] }}</Badge>
                <Button
                  v-if="!row.voidedAt"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Void entry"
                  :disabled="!can('medications')"
                  :title="denied('medications') ?? 'Void this entry'"
                  @click="strike(row._id)"
                >
                  <DsIcon name="x" :size="15" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </template>

    <TsMedicationDialog
      :open="orderOpen"
      :residents="[]"
      :tenant-id="tenantId"
      :order="editing"
      @close="orderOpen = false"
    />
  </div>
</template>
