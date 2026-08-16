<script setup lang="ts">
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { formatDate } from '~/utils/format'
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

/** Support Levels — the distribution first, because it is what staffs a shift. */
const { selected } = useSelectedBuilding()
const { can, denied } = useMe()

const { data, isLoading } = useConvexQuery(api.support.overview, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
}))

usePageHeader(() => ({
  eyebrow: data.value?.building.name ?? '',
  title: 'Support Levels',
}))

const LEVEL_COLOR: Record<string, string> = {
  independent: 'var(--green-600)',
  moderate: 'var(--amber-500)',
  high: 'var(--amber-600)',
  critical: 'var(--red-600)',
}

const LEVEL_LABEL: Record<string, string> = {
  independent: 'Independent',
  moderate: 'Moderate',
  high: 'High',
  critical: 'Critical',
}

const filter = ref<string | null>(null)
const editingId = ref<Id<'tenants'> | null>(null)

const residents = computed(() => {
  const all = data.value?.residents ?? []
  return filter.value ? all.filter((r) => r.supportLevel === filter.value) : all
})

const dialogTenant = computed(
  () => data.value?.residents.find((r) => r._id === editingId.value) ?? null,
)

const total = computed(
  () => data.value?.distribution.reduce((sum, d) => sum + d.count, 0) ?? 0,
)
</script>

<template>
  <div class="flex flex-col gap-5">
    <DsSectionHeader
      :eyebrow="data?.building.name"
      title="Support Levels"
      description="Where each resident sits between independent living and critical care. Changing a level asks for a reason, and the reason is kept."
    />

    <TsLoadingState v-if="isLoading" label="Loading support levels…" :rows="6" />

    <template v-else-if="data">
      <!-- Distribution -->
      <Card>
        <CardContent class="flex flex-col gap-4 p-5">
          <div class="flex flex-wrap items-baseline justify-between gap-3">
            <span class="eyebrow">Distribution across {{ total }} current residents</span>
            <span class="text-sm text-muted-foreground">
              Average load
              <strong class="tnum text-[var(--text-strong)]">
                {{ data.averageLoad.toFixed(2) }}
              </strong>
              of 4.00
            </span>
          </div>

          <div class="flex h-3 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
            <span
              v-for="slice in data.distribution"
              :key="slice.level"
              :style="{
                width: total ? `${(slice.count / total) * 100}%` : '0%',
                background: LEVEL_COLOR[slice.level],
              }"
              :title="`${LEVEL_LABEL[slice.level]}: ${slice.count}`"
            />
          </div>

          <div class="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
            <button
              v-for="slice in data.distribution"
              :key="slice.level"
              type="button"
              class="flex cursor-pointer items-center gap-2.5 rounded-lg border p-3 text-left transition-colors"
              :class="
                filter === slice.level
                  ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                  : 'border-border hover:bg-[var(--surface-hover)]'
              "
              @click="filter = filter === slice.level ? null : slice.level"
            >
              <span
                class="size-2.5 shrink-0 rounded-full"
                :style="{ background: LEVEL_COLOR[slice.level] }"
              />
              <span class="min-w-0 flex-1">
                <span class="block text-xs text-muted-foreground">
                  {{ LEVEL_LABEL[slice.level] }}
                </span>
                <span class="tnum block text-lg font-bold text-[var(--text-strong)]">
                  {{ slice.count }}
                </span>
              </span>
            </button>
          </div>
        </CardContent>
      </Card>

      <div class="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div class="flex flex-col gap-3">
          <div v-if="filter" class="flex items-center gap-2">
            <Badge variant="brand">{{ LEVEL_LABEL[filter] }} only</Badge>
            <Button variant="ghost" size="sm" @click="filter = null">
              <DsIcon name="x" :size="15" />
              Clear filter
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead class="w-[70px]">Room</TableHead>
                <TableHead>Resident</TableHead>
                <TableHead class="w-[200px]">Level</TableHead>
                <TableHead class="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="row in residents" :key="row._id">
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
                    <Badge v-if="row.critical" variant="danger" dot>Open case</Badge>
                  </NuxtLink>
                </TableCell>
                <TableCell>
                  <DsSupportMeter :level="row.supportLevel" size="sm" />
                </TableCell>
                <TableCell class="text-right">
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    aria-label="Change support level"
                    :title="denied('care') ?? 'Change support level'"
                    :disabled="!can('care')"
                    @click="editingId = row._id"
                  >
                    <DsIcon name="pencil" :size="16" />
                  </Button>
                </TableCell>
              </TableRow>

              <TableRow v-if="!residents.length">
                <TableCell colspan="4" class="py-10 text-center text-muted-foreground">
                  No residents at this level.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <div class="flex flex-col gap-5">
          <Card class="h-fit">
            <CardContent class="flex flex-col gap-3 p-5">
              <span class="eyebrow">By floor</span>
              <div v-for="floor in data.byFloor" :key="floor.floor" class="flex flex-col gap-1">
                <span class="text-sm font-semibold text-[var(--text-strong)]">
                  {{ floor.floor }}
                </span>
                <div class="flex h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                  <span
                    v-for="slice in floor.counts"
                    :key="slice.level"
                    :style="{
                      width: `${(slice.count / Math.max(1, floor.counts.reduce((s, c) => s + c.count, 0))) * 100}%`,
                      background: LEVEL_COLOR[slice.level],
                    }"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card class="h-fit">
            <CardContent class="flex flex-col gap-3 p-5">
              <span class="eyebrow">Recent changes</span>
              <div v-for="change in data.recentChanges.slice(0, 8)" :key="change._id" class="text-sm">
                <NuxtLink
                  :to="`/tenants/${change.tenantId}`"
                  class="font-semibold text-[var(--text-strong)] hover:underline"
                >
                  {{ change.name }}
                </NuxtLink>
                <span class="text-muted-foreground">
                  · {{ LEVEL_LABEL[change.from] }} → {{ LEVEL_LABEL[change.to] }}
                </span>
                <p class="text-xs text-muted-foreground">
                  {{ formatDate(change.changedAt) }} · {{ change.reason }}
                </p>
              </div>
              <p v-if="!data.recentChanges.length" class="text-sm text-muted-foreground">
                No level changes recorded yet.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </template>

    <TsSupportLevelDialog
      :open="!!dialogTenant"
      :tenant="dialogTenant"
      @close="editingId = null"
    />
  </div>
</template>
