<script setup lang="ts">
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { money } from '~/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

/** Tenants — the roster, with tabs for current / prospective / prior. */
const route = useRoute()
const { selected } = useSelectedBuilding()
const { can, denied } = useMe()

const tab = ref<'current' | 'prospective' | 'prior'>('current')
const level = ref('all')
const search = ref((route.query.q as string) ?? '')

watch(
  () => route.query.q,
  (q) => {
    search.value = (q as string) ?? ''
  },
)

const { data, isLoading } = useConvexQuery(api.tenants.list, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
  status: tab.value,
  ...(level.value !== 'all' ? { supportLevel: level.value as 'independent' } : {}),
}))

usePageHeader(() => ({
  eyebrow: data.value?.building?.name ?? '',
  title: 'Tenants',
}))

const rows = computed(() => {
  const all = data.value?.tenants ?? []
  const q = search.value.trim().toLowerCase()
  if (!q) return all
  return all.filter(
    (t) => t.name.toLowerCase().includes(q) || t.room.toLowerCase().includes(q),
  )
})

const LEVELS = [
  { value: 'all', label: 'All support levels' },
  { value: 'independent', label: 'Independent' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

/* ---- Intake ---- */
const intakeOpen = ref(false)
const intakeBuildingId = computed(() => selected.value ?? data.value?.building?._id ?? null)

/* ---- Receive Rent from a row ---- */
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
      :eyebrow="data?.building?.name"
      title="Tenants"
      :description="
        data
          ? `${data.counts.current} current residents across ${data.building?.units ?? 0} rooms.`
          : undefined
      "
    >
      <template #actions>
        <Button variant="secondary" @click="navigateTo('/reports')">
          <DsIcon name="printer" :size="17" />
          Shift Report
        </Button>
        <Button
          variant="primary"
          :disabled="!intakeBuildingId || !can('tenancy')"
          :title="denied('tenancy') ?? 'Start a new tenancy'"
          @click="intakeOpen = true"
        >
          <DsIcon name="user-plus" :size="17" />
          New Tenant
        </Button>
      </template>
    </DsSectionHeader>

    <div class="flex flex-wrap items-end justify-between gap-4">
      <Tabs v-model="tab">
        <TabsList>
          <TabsTrigger value="current">
            Current
            <span
              v-if="data"
              class="tnum rounded-full bg-[var(--slate-200)] px-1.5 text-xs font-bold text-[var(--text-body)]"
            >{{ data.counts.current }}</span>
          </TabsTrigger>
          <TabsTrigger value="prospective">
            Prospective
            <span
              v-if="data?.counts.prospective"
              class="tnum rounded-full bg-[var(--slate-200)] px-1.5 text-xs font-bold text-[var(--text-body)]"
            >{{ data.counts.prospective }}</span>
          </TabsTrigger>
          <TabsTrigger value="prior">Prior</TabsTrigger>
        </TabsList>
      </Tabs>

      <!-- Search (220) + filter (200) exceed a phone's width, so they wrap. -->
      <div class="flex flex-wrap items-center gap-3">
        <DsSearchField v-model="search" placeholder="Filter by name or room…" :width="220" />
        <Select v-model="level">
          <SelectTrigger size="sm" class="w-[200px]">
            <SelectValue placeholder="All support levels" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="l in LEVELS" :key="l.value" :value="l.value">
              {{ l.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <TsLoadingState v-if="isLoading" label="Loading roster…" :rows="8" />

    <Table v-else>
      <TableHeader>
        <TableRow>
          <TableHead class="w-[70px]">Room</TableHead>
          <TableHead>Tenant</TableHead>
          <TableHead class="w-[190px]">Support</TableHead>
          <TableHead class="w-[90px] text-right">Rent</TableHead>
          <TableHead class="w-[100px] text-right">Balance</TableHead>
          <TableHead class="w-[110px]">Status</TableHead>
          <TableHead class="w-[96px]" />
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
              <TsResidentAvatar
                :name="row.name"
                :tenant-id="row._id"
                :photo-url="row.photoUrl"
                :room="row.room"
                :support-level="row.supportLevel"
                :critical="row.critical"
                size="sm"
                :status="row.critical ? 'alert' : undefined"
              />
              <span class="font-semibold text-[var(--text-strong)]">{{ row.name }}</span>
              <Badge v-if="row.critical" variant="rose">
                <DsIcon name="heart-pulse" :size="12" :stroke-width="2.5" />
                Critical
              </Badge>
            </div>
          </TableCell>

          <TableCell>
            <DsSupportMeter :level="row.supportLevel" size="sm" />
          </TableCell>

          <TableCell class="tnum text-right">{{ money(row.monthlyRentCents) }}</TableCell>

          <TableCell class="tnum text-right">
            <span :class="row.balanceCents > 0 && 'font-bold text-destructive'">
              {{ money(row.balanceCents) }}
            </span>
          </TableCell>

          <TableCell>
            <Badge v-if="row.balanceCents > 0" variant="warning" dot>Rent Due</Badge>
            <Badge v-else variant="success" dot>Clear</Badge>
          </TableCell>

          <TableCell class="text-right">
            <div class="inline-flex gap-1.5" @click.stop>
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
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Open tenant"
                title="Open tenant"
                @click="navigateTo(`/tenants/${row._id}`)"
              >
                <DsIcon name="arrow-right" :size="16" />
              </Button>
            </div>
          </TableCell>
        </TableRow>

        <TableRow v-if="rows.length === 0">
          <TableCell colspan="7" class="py-10 text-center text-muted-foreground">
            {{ search ? `No tenants match “${search}”.` : 'No tenants in this list yet.' }}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <TsReceiveRentDialog
      :open="!!dialogTenant"
      :tenant="dialogTenant"
      @close="rentTenantId = null"
    />

    <TsTenantIntakeDialog
      :open="intakeOpen"
      :building-id="intakeBuildingId"
      :building-name="data?.building?.name"
      @close="intakeOpen = false"
      @created="(id) => navigateTo(`/tenants/${id}`)"
    />
  </div>
</template>
