<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { formatDate, relativeDays } from '~/utils/format'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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

/** Room Checks — what has been walked this week and what hasn't. */
const { selected } = useSelectedBuilding()
const { can, denied } = useMe()

const { data, isLoading } = useConvexQuery(api.checks.list, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
}))

usePageHeader(() => ({
  eyebrow: data.value?.building.name ?? '',
  title: 'Room Checks',
}))

const { mutate: completeRoom, pending: roomPending } = useConvexMutation(
  api.checks.completeRoomCheck,
)
const { mutate: completeBuilding, pending: buildingPending } = useConvexMutation(
  api.checks.completeBuildingCheck,
)

const onlyDue = ref(true)

const rows = computed(() => {
  const all = data.value?.rows ?? []
  return onlyDue.value ? all.filter((r) => r.due) : all
})

const OUTCOME: Record<string, { label: string; variant: 'success' | 'warning' | 'neutral' }> = {
  'all-clear': { label: 'All Clear', variant: 'success' },
  deficiency: { label: 'Deficiency', variant: 'warning' },
  'no-entry': { label: 'No entry', variant: 'neutral' },
}

async function signOffRoom(
  roomId: Id<'rooms'>,
  number: string,
  outcome: 'all-clear' | 'no-entry',
) {
  await completeRoom({ roomId, outcome })
  if (outcome === 'all-clear') {
    toast.success(`Room ${number} checked`, { description: 'Marked All Clear.' })
  } else {
    toast.info(`Room ${number} checked`, { description: 'Recorded as no entry.' })
  }
}

async function signOffBuilding() {
  const buildingId = data.value?.building._id
  if (!buildingId) return
  await completeBuilding({ buildingId, outcome: 'all-clear' })
  toast.success('Building check complete', {
    description: 'Fire route and common areas signed off.',
  })
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <DsSectionHeader
      :eyebrow="data?.building.name"
      title="Room Checks"
      description="Policy is a check per room every seven days, plus a whole-building walk."
    >
      <template #actions>
        <div class="flex items-center gap-2">
          <Switch id="only-due" v-model="onlyDue" />
          <Label for="only-due" class="cursor-pointer text-base">Only show due</Label>
        </div>
        <Button
          variant="primary"
          :disabled="buildingPending || !can('checks')"
          :title="denied('checks') ?? 'Sign off the building check'"
          @click="signOffBuilding"
        >
          <DsIcon name="shield-check" :size="17" />
          {{ buildingPending ? 'Recording…' : 'Complete building check' }}
        </Button>
      </template>
    </DsSectionHeader>

    <Alert v-if="data?.summary.buildingCheckDue" variant="warning">
      <DsIcon name="alert-triangle" :size="17" :stroke-width="2" />
      <div>
        <AlertTitle>Building check is overdue</AlertTitle>
        <AlertDescription>
          <template v-if="data.summary.lastBuildingCheckAt">
            Last completed {{ formatDate(data.summary.lastBuildingCheckAt) }}<template
              v-if="data.summary.lastBuildingCheckBy"
            > by {{ data.summary.lastBuildingCheckBy }}</template>. Fire route and common areas
            are outstanding.
          </template>
          <template v-else>
            No building check has been recorded in TS Database yet.
          </template>
        </AlertDescription>
      </div>
    </Alert>

    <div v-if="data" class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
      <DsStatCard
        icon="shield-check"
        accent="amber"
        label="Rooms due"
        :value="data.summary.due"
        :sublabel="`of ${data.summary.total} rooms`"
      />
      <DsStatCard
        icon="check-circle-2"
        accent="brand"
        label="Up to date"
        :value="data.summary.total - data.summary.due"
        sublabel="Checked within the last 7 days"
      />
      <DsStatCard
        icon="building-2"
        accent="blue"
        label="Building check"
        :value="data.summary.lastBuildingCheckAt ? relativeDays(data.summary.lastBuildingCheckAt) : 'never'"
        :sublabel="data.summary.lastBuildingCheckBy ?? 'Fire route & common areas'"
      />
    </div>

    <TsLoadingState v-if="isLoading" label="Loading check history…" :rows="8" />

    <Table v-else>
      <TableHeader>
        <TableRow>
          <TableHead class="w-[80px]">Room</TableHead>
          <TableHead>Resident</TableHead>
          <TableHead class="w-[180px]">Last checked</TableHead>
          <TableHead class="w-[130px]">Outcome</TableHead>
          <TableHead class="w-[190px]" />
        </TableRow>
      </TableHeader>

      <TableBody>
        <TableRow v-for="row in rows" :key="row.roomId">
          <TableCell>
            <span class="mono font-semibold text-[var(--text-strong)]">{{ row.number }}</span>
            <span class="block text-[11px] text-[var(--text-subtle)]">{{ row.floor }}</span>
          </TableCell>

          <TableCell>
            <NuxtLink
              v-if="row.tenantId"
              :to="`/tenants/${row.tenantId}`"
              class="font-semibold text-[var(--text-strong)] no-underline hover:text-[var(--brand-strong)] hover:no-underline"
            >
              {{ row.tenantName }}
            </NuxtLink>
            <span v-else class="text-[var(--text-subtle)]">Vacant</span>
          </TableCell>

          <TableCell>
            <template v-if="row.lastCheckedAt">
              <span :class="row.due && 'font-semibold text-destructive'">
                {{ relativeDays(row.lastCheckedAt) }}
              </span>
              <span v-if="row.lastCheckedBy" class="block text-[11px] text-[var(--text-subtle)]">
                {{ row.lastCheckedBy }}
              </span>
            </template>
            <span v-else class="font-semibold text-destructive">Never checked</span>
          </TableCell>

          <TableCell>
            <Badge v-if="row.lastOutcome" :variant="OUTCOME[row.lastOutcome]?.variant ?? 'neutral'" dot>
              {{ OUTCOME[row.lastOutcome]?.label ?? row.lastOutcome }}
            </Badge>
            <span v-else class="text-[var(--text-subtle)]">—</span>
          </TableCell>

          <TableCell class="text-right">
            <div class="inline-flex gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                :disabled="roomPending"
                @click="signOffRoom(row.roomId, row.number, 'no-entry')"
              >
                No entry
              </Button>
              <Button
                variant="primary"
                size="sm"
                :disabled="roomPending"
                @click="signOffRoom(row.roomId, row.number, 'all-clear')"
              >
                <DsIcon name="check" :size="15" />
                All Clear
              </Button>
            </div>
          </TableCell>
        </TableRow>

        <TableRow v-if="rows.length === 0">
          <TableCell colspan="5" class="py-10 text-center text-muted-foreground">
            {{
              onlyDue
                ? 'Every room has been checked this week.'
                : 'No rooms in this building yet.'
            }}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>
