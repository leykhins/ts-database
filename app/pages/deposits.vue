<script setup lang="ts">
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { formatDate, money } from '~/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/** Security Deposits — funds held in trust, shortfalls first. */
const { selected } = useSelectedBuilding()
const { can, denied } = useMe()

const { data, isLoading } = useConvexQuery(api.deposits.overview, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
}))

usePageHeader(() => ({
  eyebrow: data.value?.building.name ?? '',
  title: 'Security Deposits',
}))

const adjustTenantId = ref<Id<'tenants'> | null>(null)
const dialogTenant = computed(
  () => data.value?.rows.find((r) => r._id === adjustTenantId.value) ?? null,
)
</script>

<template>
  <div class="flex flex-col gap-5">
    <DsSectionHeader
      :eyebrow="data?.building.name"
      title="Security Deposits"
      description="What is held against each tenancy, what is still to collect, and what is owed back on exit."
    />

    <div v-if="data" class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
      <DsStatCard
        icon="lock"
        accent="cyan"
        label="Held in trust"
        :value="money(data.totals.heldCents)"
        :sublabel="`Against ${money(data.totals.requiredCents)} required`"
      />
      <DsStatCard
        icon="alert-triangle"
        accent="amber"
        label="Short"
        :value="money(data.totals.shortCents)"
        :sublabel="`${data.totals.shortCount} tenancies under-collected`"
      />
      <DsStatCard
        icon="arrow-left"
        accent="rose"
        label="Refundable"
        :value="money(data.totals.refundableCents)"
        :sublabel="`${data.totals.refundCount} ended tenancies still holding funds`"
      />
    </div>

    <TsLoadingState v-if="isLoading" label="Loading deposits…" :rows="8" />

    <div v-else class="grid gap-5 lg:grid-cols-[1fr_300px]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-[70px]">Room</TableHead>
            <TableHead>Tenant</TableHead>
            <TableHead class="w-[110px] text-right">Held</TableHead>
            <TableHead class="w-[110px] text-right">Required</TableHead>
            <TableHead class="w-[130px]">Status</TableHead>
            <TableHead class="w-[60px]" />
          </TableRow>
        </TableHeader>

        <TableBody>
          <TableRow v-for="row in data?.rows ?? []" :key="row._id">
            <TableCell>
              <span class="mono font-semibold text-[var(--text-strong)]">{{ row.room }}</span>
            </TableCell>
            <TableCell>
              <NuxtLink
                :to="`/tenants/${row._id}`"
                class="flex items-center gap-2.5 font-semibold text-[var(--text-strong)] hover:underline"
              >
                <DsPersonAvatar :name="row.name" size="sm" />
                {{ row.name }}
              </NuxtLink>
            </TableCell>
            <TableCell class="tnum text-right">{{ money(row.heldCents) }}</TableCell>
            <TableCell class="tnum text-right text-muted-foreground">
              {{ money(row.requiredCents) }}
            </TableCell>
            <TableCell>
              <Badge v-if="row.refundableCents > 0" variant="rose" dot>
                Refund {{ money(row.refundableCents) }}
              </Badge>
              <Badge v-else-if="row.shortCents > 0" variant="warning" dot>
                Short {{ money(row.shortCents) }}
              </Badge>
              <Badge v-else variant="success" dot>Fully held</Badge>
            </TableCell>
            <TableCell class="text-right">
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label="Adjust funds"
                :title="denied('money') ?? 'Adjust funds'"
                :disabled="!can('money')"
                @click="adjustTenantId = row._id"
              >
                <DsIcon name="dollar-sign" :size="16" />
              </Button>
            </TableCell>
          </TableRow>

          <TableRow v-if="!data?.rows.length">
            <TableCell colspan="6" class="py-10 text-center text-muted-foreground">
              No tenancies on file for this building yet.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <Card class="h-fit">
        <CardContent class="flex flex-col gap-3 p-5">
          <span class="eyebrow">Recent movements</span>
          <div
            v-for="entry in data?.recent.slice(0, 12) ?? []"
            :key="entry._id"
            class="flex items-baseline justify-between gap-3 text-sm"
          >
            <span class="min-w-0">
              <span class="block truncate font-semibold text-[var(--text-strong)]">
                {{ entry.name }}
              </span>
              <span class="block truncate text-xs text-muted-foreground">
                {{ formatDate(entry.postedAt) }} · {{ entry.reason }}
              </span>
            </span>
            <span
              class="tnum shrink-0 font-semibold"
              :class="entry.amountCents < 0 ? 'text-destructive' : 'text-[var(--success)]'"
            >
              {{ entry.amountCents < 0 ? '−' : '+' }}{{ money(Math.abs(entry.amountCents)) }}
            </span>
          </div>
          <p v-if="!data?.recent.length" class="text-sm text-muted-foreground">
            Nothing posted yet.
          </p>
        </CardContent>
      </Card>
    </div>

    <TsAdjustDepositDialog
      :open="!!dialogTenant"
      :tenant="dialogTenant"
      @close="adjustTenantId = null"
    />
  </div>
</template>
