<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { formatDate } from '~/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/** Critical Needs — the open cases, oldest first, and what was done about them. */
const { selected } = useSelectedBuilding()
const { can, denied } = useMe()

const includeResolved = ref(false)

const { data, isLoading } = useConvexQuery(api.needs.list, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
  includeResolved: includeResolved.value,
}))

usePageHeader(() => ({
  eyebrow: data.value?.building.name ?? '',
  title: 'Critical Needs',
}))

const { mutate: resolve } = useConvexMutation(api.needs.resolve)

const dialogOpen = ref(false)
const editingId = ref<Id<'criticalNeeds'> | null>(null)

const editing = computed(() => {
  const row = data.value?.rows.find((r) => r._id === editingId.value)
  return row
    ? {
        _id: row._id,
        tenantId: row.tenantId,
        name: row.name,
        summary: row.summary,
        detail: row.detail,
        caseManager: row.caseManager,
      }
    : null
})

function openNew() {
  editingId.value = null
  dialogOpen.value = true
}

function edit(id: Id<'criticalNeeds'>) {
  editingId.value = id
  dialogOpen.value = true
}

async function setResolved(needId: Id<'criticalNeeds'>, resolved: boolean) {
  try {
    await resolve({ needId, resolved })
    toast.success(resolved ? 'Case resolved' : 'Case reopened')
  } catch (e) {
    toast.error('Could not update the case', { description: (e as Error).message })
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <DsSectionHeader
      :eyebrow="data?.building.name"
      title="Critical Needs"
      description="Residents with an open case, what is on file, and who is carrying it. Resolved cases stay on the record."
    >
      <template #actions>
        <div class="flex items-center gap-2">
          <Switch id="show-resolved" v-model="includeResolved" />
          <Label for="show-resolved" class="cursor-pointer text-base">Show resolved</Label>
        </div>
        <Button
          variant="primary"
          :disabled="!can('care')"
          :title="denied('care') ?? 'Open a case'"
          @click="openNew"
        >
          <DsIcon name="plus" :size="17" />
          Open a case
        </Button>
      </template>
    </DsSectionHeader>

    <div v-if="data" class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
      <DsStatCard
        icon="heart-pulse"
        accent="rose"
        label="Open cases"
        :value="data.counts.open"
        :sublabel="`Across ${data.counts.residents} residents`"
      />
      <DsStatCard
        icon="alert-triangle"
        accent="amber"
        label="Open over a week"
        :value="data.counts.overSevenDays"
        sublabel="Cases that have not moved"
      />
      <DsStatCard
        icon="check-circle-2"
        accent="teal"
        label="Resolved"
        :value="data.counts.resolved"
        sublabel="On the record for this building"
      />
    </div>

    <TsLoadingState v-if="isLoading" label="Loading cases…" :rows="5" />

    <DsEmptyState
      v-else-if="!data?.rows.length"
      icon="heart-pulse"
      accent="var(--rose-600)"
      title="No open cases"
      description="Nothing is outstanding in this building. Open a case when a resident needs something the building has to act on."
    />

    <div v-else class="flex flex-col gap-3">
      <Card v-for="row in data.rows" :key="row._id">
        <CardContent class="flex flex-wrap items-start gap-4 p-5">
          <DsPersonAvatar :name="row.name" />

          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <NuxtLink
                :to="`/tenants/${row.tenantId}`"
                class="font-semibold text-[var(--text-strong)] hover:underline"
              >
                {{ row.name }}
              </NuxtLink>
              <span class="mono text-sm text-muted-foreground">Room {{ row.room }}</span>
              <Badge v-if="row.resolvedAt" variant="success" dot>
                Resolved {{ formatDate(row.resolvedAt) }}
              </Badge>
              <Badge v-else-if="row.daysOpen >= 7" variant="danger" dot>
                {{ row.daysOpen }} days open
              </Badge>
              <Badge v-else variant="warning" dot>
                {{ row.daysOpen === 0 ? 'Opened today' : `${row.daysOpen} days open` }}
              </Badge>
            </div>

            <p class="mt-1 text-base font-semibold text-[var(--text-strong)]">{{ row.summary }}</p>
            <p v-if="row.detail" class="mt-0.5 text-base text-muted-foreground">{{ row.detail }}</p>
            <p class="mt-1 text-xs text-muted-foreground">
              Opened {{ formatDate(row.openedAt) }}
              <template v-if="row.caseManager"> · Case manager: {{ row.caseManager }}</template>
            </p>
          </div>

          <div class="flex shrink-0 items-center gap-1.5">
            <DsSupportMeter :level="row.supportLevel" size="sm" :show-label="false" />
            <Button
              variant="secondary"
              size="icon-sm"
              aria-label="Edit case"
              :title="denied('care') ?? 'Edit case'"
              :disabled="!can('care')"
              @click="edit(row._id)"
            >
              <DsIcon name="pencil" :size="16" />
            </Button>
            <Button
              :variant="row.resolvedAt ? 'secondary' : 'primary'"
              size="sm"
              :disabled="!can('care')"
              :title="denied('care') ?? undefined"
              @click="setResolved(row._id, !row.resolvedAt)"
            >
              <DsIcon :name="row.resolvedAt ? 'refresh' : 'check'" :size="16" />
              {{ row.resolvedAt ? 'Reopen' : 'Resolve' }}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>

    <TsCriticalNeedDialog
      :open="dialogOpen"
      :residents="data?.residents ?? []"
      :need="editing"
      @close="dialogOpen = false"
    />
  </div>
</template>
