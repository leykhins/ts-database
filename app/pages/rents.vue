<script setup lang="ts">
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { toast } from 'vue-sonner'
import { formatDate, money } from '~/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/** Rents — the roster of who owes what, worst first. */
const { selected } = useSelectedBuilding()
const { can, denied } = useMe()

const { data, isLoading } = useConvexQuery(api.rents.roster, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
}))

usePageHeader(() => ({
  eyebrow: data.value?.building.name ?? '',
  title: 'Rents',
}))

const onlyOwing = ref(false)

/**
 * Posting the month's charges. The cron does this on the 1st; the button is
 * here for the first run on a new building and for the month a deployment was
 * down. Both go through the same server helper, which refuses to charge a
 * tenant twice for the same period.
 */
const { mutate: chargeRent, pending: charging } = useConvexMutation(api.rents.chargeMonthlyRent)

async function postMonthlyRent() {
  const buildingId = data.value?.building._id
  if (!buildingId) return
  if (
    !window.confirm(
      `Charge ${data.value?.period} rent to every current tenancy in ${data.value?.building.name}? Tenants already charged for this period are skipped.`,
    )
  ) {
    return
  }
  try {
    const result = await chargeRent({ buildingId })
    toast.success(
      result.charged ? `${result.charged} tenancies charged` : 'Nothing left to charge',
      {
        description: result.charged
          ? `${money(result.amountCents)} posted for ${data.value?.period}. ${result.skipped} already charged.`
          : `Every current tenancy already has a ${data.value?.period} charge.`,
      },
    )
  } catch (e) {
    toast.error('Could not post the charges', { description: (e as Error).message })
  }
}

const rows = computed(() => {
  const all = data.value?.rows ?? []
  return onlyOwing.value ? all.filter((r) => r.balanceCents > 0) : all
})

const rentTenantId = ref<Id<'tenants'> | null>(null)
const dialogTenant = computed(() => {
  const t = rows.value.find((r) => r._id === rentTenantId.value)
  return t
    ? {
        _id: t._id,
        name: t.name,
        room: t.room,
        monthlyRentCents: t.monthlyRentCents,
        balanceCents: t.balanceCents,
      }
    : null
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <DsSectionHeader
      :eyebrow="data?.building.name"
      title="Rents"
      description="Cumulative amounts due, ordered by how far behind each tenancy is."
    >
      <template #actions>
        <div class="flex items-center gap-2">
          <Switch id="only-owing" v-model="onlyOwing" />
          <Label for="only-owing" class="cursor-pointer text-base">Only show balances</Label>
        </div>
        <Button
          variant="secondary"
          :loading="charging"
          :disabled="!can('money')"
          :title="denied('money') ?? `Charge ${data?.period} rent to every current tenancy`"
          @click="postMonthlyRent"
        >
          <DsIcon name="calendar" :size="17" />
          {{ charging ? 'Posting…' : `Post ${data?.period ?? 'monthly'} rent` }}
        </Button>
      </template>
    </DsSectionHeader>

    <div v-if="data" class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
      <DsStatCard
        icon="dollar-sign"
        accent="blue"
        label="Total due"
        :value="money(data.totals.dueCents)"
        sublabel="Across all current tenancies"
      />
      <DsStatCard
        icon="alert-triangle"
        accent="amber"
        label="Warnings"
        :value="data.totals.warnings"
        :sublabel="`${data.totals.highWarnings} high`"
      />
      <DsStatCard
        icon="users"
        accent="teal"
        label="Monthly roll"
        :value="money(data.totals.chargedCents)"
        :sublabel="
          data.chargedThisPeriod
            ? `${data.period} charged to ${data.chargedThisPeriod} tenancies`
            : `${data.period} not charged yet`
        "
      />
    </div>

    <TsLoadingState v-if="isLoading" label="Loading rent roster…" :rows="8" />

    <Table v-else>
      <TableHeader>
        <TableRow>
          <TableHead class="w-[70px]">Room</TableHead>
          <TableHead>Tenant</TableHead>
          <TableHead class="w-[120px] text-right">Monthly rent</TableHead>
          <TableHead class="w-[150px]">Last payment</TableHead>
          <TableHead class="w-[110px] text-right">Balance</TableHead>
          <TableHead class="w-[120px]">Warning</TableHead>
          <TableHead class="w-[60px]" />
        </TableRow>
      </TableHeader>

      <TableBody>
        <TableRow
          v-for="row in rows"
          :key="row._id"
          class="cursor-pointer hover:bg-[var(--surface-hover)]"
          @click="navigateTo(`/tenants/${row._id}`)"
        >
          <TableCell>
            <span class="mono font-semibold text-[var(--text-strong)]">{{ row.room }}</span>
          </TableCell>

          <TableCell>
            <div class="flex items-center gap-2.5">
              <DsPersonAvatar :name="row.name" size="sm" />
              <span class="font-semibold text-[var(--text-strong)]">{{ row.name }}</span>
            </div>
          </TableCell>

          <TableCell class="tnum text-right">{{ money(row.monthlyRentCents) }}</TableCell>

          <TableCell>
            <template v-if="row.lastPaymentAt">
              <span>{{ formatDate(row.lastPaymentAt) }}</span>
              <span class="tnum ml-1.5 text-xs text-[var(--text-subtle)]">
                {{ money(row.lastPaymentCents) }}
              </span>
            </template>
            <span v-else class="text-sm text-[var(--text-subtle)]">No payments on file</span>
          </TableCell>

          <TableCell class="tnum text-right">
            <span :class="row.balanceCents > 0 && 'font-bold text-destructive'">
              {{ money(row.balanceCents) }}
            </span>
          </TableCell>

          <TableCell>
            <Badge v-if="row.warning === 'high'" variant="danger" dot>High Warning</Badge>
            <Badge v-else-if="row.warning === 'low'" variant="warning" dot>Low Warning</Badge>
            <Badge v-else variant="success" dot>No Warning</Badge>
          </TableCell>

          <TableCell class="text-right">
            <div @click.stop>
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label="Receive rent"
                :title="denied('money') ?? 'Receive rent'"
                :disabled="!can('money')"
                @click="rentTenantId = row._id"
              >
                <DsIcon name="dollar-sign" :size="16" />
              </Button>
            </div>
          </TableCell>
        </TableRow>

        <TableRow v-if="rows.length === 0">
          <TableCell colspan="7" class="py-10 text-center text-muted-foreground">
            {{
              onlyOwing
                ? 'No outstanding balances — every rent is posted.'
                : 'No current tenancies.'
            }}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <TsReceiveRentDialog
      :open="!!dialogTenant"
      :tenant="dialogTenant"
      @close="rentTenantId = null"
    />
  </div>
</template>
