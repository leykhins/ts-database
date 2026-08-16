<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { formatDate } from '~/utils/format'
import { Badge } from '@/components/ui/badge'
import type { BadgeVariants } from '@/components/ui/badge'
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

/** Maintenance — open work orders by priority, with how long they have sat. */
const { selected } = useSelectedBuilding()
const { can, denied } = useMe()

const includeClosed = ref(false)

const { data, isLoading } = useConvexQuery(api.maintenance.list, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
  includeClosed: includeClosed.value,
}))

usePageHeader(() => ({
  eyebrow: data.value?.building.name ?? '',
  title: 'Maintenance',
}))

const { mutate: updateOrder } = useConvexMutation(api.maintenance.update)

const dialogOpen = ref(false)
const editingId = ref<Id<'workOrders'> | null>(null)

const editing = computed(() => data.value?.rows.find((r) => r._id === editingId.value) ?? null)

type Variant = NonNullable<BadgeVariants['variant']>

const PRIORITY_VARIANT: Record<string, Variant> = {
  high: 'danger',
  med: 'warning',
  low: 'neutral',
}

const PRIORITY_LABEL: Record<string, string> = { high: 'High', med: 'Medium', low: 'Low' }

const STATUS_VARIANT: Record<string, Variant> = {
  open: 'warning',
  assigned: 'info',
  closed: 'success',
}

function raise() {
  editingId.value = null
  dialogOpen.value = true
}

function edit(id: Id<'workOrders'>) {
  editingId.value = id
  dialogOpen.value = true
}

async function close(id: Id<'workOrders'>, title: string) {
  try {
    await updateOrder({ workOrderId: id, status: 'closed' })
    toast.success('Work order closed', { description: title })
  } catch (e) {
    toast.error('Could not close the work order', { description: (e as Error).message })
  }
}

async function reopen(id: Id<'workOrders'>) {
  try {
    await updateOrder({ workOrderId: id, status: 'open' })
    toast.success('Work order reopened')
  } catch (e) {
    toast.error('Could not reopen the work order', { description: (e as Error).message })
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <DsSectionHeader
      :eyebrow="data?.building.name"
      title="Maintenance"
      description="What the building needs fixed, who has it, and how long it has been waiting."
    >
      <template #actions>
        <div class="flex items-center gap-2">
          <Switch id="show-closed" v-model="includeClosed" />
          <Label for="show-closed" class="cursor-pointer text-base">Show closed</Label>
        </div>
        <Button
          variant="primary"
          :disabled="!can('checks')"
          :title="denied('checks') ?? 'Raise a request'"
          @click="raise"
        >
          <DsIcon name="plus" :size="17" />
          Raise a request
        </Button>
      </template>
    </DsSectionHeader>

    <div v-if="data" class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
      <DsStatCard
        icon="wrench"
        accent="amber"
        label="Open"
        :value="data.counts.open"
        :sublabel="`${data.counts.assigned} assigned to trades`"
      />
      <DsStatCard
        icon="alert-triangle"
        accent="rose"
        label="High priority"
        :value="data.counts.high"
        sublabel="Safety, heat and water first"
      />
      <DsStatCard
        icon="calendar"
        accent="blue"
        label="Oldest open"
        :value="`${data.counts.oldestDays}d`"
        sublabel="Age of the longest-waiting request"
      />
    </div>

    <TsLoadingState v-if="isLoading" label="Loading work orders…" :rows="6" />

    <DsEmptyState
      v-else-if="!data?.rows.length"
      icon="wrench"
      accent="var(--slate-600)"
      title="Nothing outstanding"
      description="No open work orders in this building."
    />

    <Table v-else>
      <TableHeader>
        <TableRow>
          <TableHead class="w-[110px]">Where</TableHead>
          <TableHead>Request</TableHead>
          <TableHead class="w-[110px]">Priority</TableHead>
          <TableHead class="w-[160px]">Assigned</TableHead>
          <TableHead class="w-[110px]">Age</TableHead>
          <TableHead class="w-[130px]" />
        </TableRow>
      </TableHeader>

      <TableBody>
        <TableRow v-for="row in data.rows" :key="row._id">
          <TableCell>
            <span class="mono font-semibold text-[var(--text-strong)]">{{ row.room }}</span>
          </TableCell>

          <TableCell>
            <span class="block font-semibold text-[var(--text-strong)]">{{ row.title }}</span>
            <span v-if="row.detail" class="block text-xs text-muted-foreground">
              {{ row.detail }}
            </span>
            <Badge :variant="STATUS_VARIANT[row.status] ?? 'neutral'" class="mt-1 capitalize" dot>
              {{ row.status }}
            </Badge>
          </TableCell>

          <TableCell>
            <Badge :variant="PRIORITY_VARIANT[row.priority] ?? 'neutral'" class="capitalize">
              {{ PRIORITY_LABEL[row.priority] ?? row.priority }}
            </Badge>
          </TableCell>

          <TableCell class="text-muted-foreground">
            {{ row.assignedTo ?? 'Unassigned' }}
          </TableCell>

          <TableCell class="text-muted-foreground">
            <span class="tnum">{{ row.ageDays }}d</span>
            <span class="block text-xs">{{ formatDate(row.openedAt) }}</span>
          </TableCell>

          <TableCell class="text-right">
            <div class="flex justify-end gap-1.5">
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label="Edit work order"
                :title="denied('checks') ?? 'Assign or re-prioritise'"
                :disabled="!can('checks')"
                @click="edit(row._id)"
              >
                <DsIcon name="pencil" :size="16" />
              </Button>
              <Button
                v-if="row.status !== 'closed'"
                variant="secondary"
                size="sm"
                :disabled="!can('checks')"
                :title="denied('checks') ?? undefined"
                @click="close(row._id, row.title)"
              >
                <DsIcon name="check" :size="15" />
                Close
              </Button>
              <Button
                v-else
                variant="secondary"
                size="sm"
                :disabled="!can('checks')"
                @click="reopen(row._id)"
              >
                <DsIcon name="refresh" :size="15" />
                Reopen
              </Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <TsWorkOrderDialog
      :open="dialogOpen"
      :building-id="data?.building._id ?? null"
      :rooms="data?.rooms ?? []"
      :order="editing"
      @close="dialogOpen = false"
    />
  </div>
</template>
