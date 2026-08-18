<script setup lang="ts">
import { api } from '../../../convex/_generated/api'
import { formatDate } from '~/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/** Shift Reports — the handover archive, newest first. */
const { selected } = useSelectedBuilding()

const { data, isLoading } = useConvexQuery(api.shiftReports.list, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
}))

usePageHeader(() => ({
  eyebrow: data.value?.building.name ?? '',
  title: 'Shift Reports',
}))

const CONFIRMATIONS = [
  { key: 'radioCheck', label: 'Radio check' },
  { key: 'handover', label: 'Handover' },
  { key: 'readPrevious', label: 'Read previous' },
] as const
</script>

<template>
  <div class="flex flex-col gap-5">
    <DsSectionHeader
      :eyebrow="data?.building.name"
      title="Shift Reports"
      description="Every handover on file for this building. What happened, what was outstanding, and who carried it."
    >
      <template #actions>
        <Button variant="primary" @click="navigateTo('/care/report')">
          <DsIcon name="file-text" :size="17" />
          My shift report
        </Button>
      </template>
    </DsSectionHeader>

    <TsLoadingState v-if="isLoading" label="Loading reports…" :rows="5" />

    <DsEmptyState
      v-else-if="!data?.reports.length"
      icon="file-text"
      accent="var(--indigo-600)"
      title="No reports yet"
      description="Shift reports appear here once staff finalize and submit them at handover."
    />

    <div v-else class="flex flex-col gap-4">
      <Card v-for="report in data.reports" :key="report._id">
        <CardContent class="flex flex-col gap-3 p-5">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-semibold text-[var(--text-strong)]">{{ report.label }}</span>
            <span class="text-sm text-[var(--text-subtle)]">
              {{ report.hours }} · {{ formatDate(report.shiftDate) }}
            </span>
            <div class="ml-auto flex items-center gap-2">
              <DsPersonAvatar :name="report.author" size="sm" />
              <span class="text-sm font-semibold text-[var(--text-body)]">{{ report.author }}</span>
              <Badge variant="neutral">{{ ROLE_SHORT[report.authorRole] ?? report.authorRole }}</Badge>
            </div>
          </div>

          <div v-if="report.significant || report.cameraReview" class="flex flex-wrap gap-1.5">
            <Badge v-if="report.significant" variant="danger">
              {{ report.significant }} significant {{ report.significant === 1 ? 'entry' : 'entries' }}
            </Badge>
            <Badge v-if="report.cameraReview" variant="violet">Camera review required</Badge>
          </div>

          <p class="text-base text-[var(--text-body)]">{{ report.summary }}</p>

          <div
            v-if="report.importantInfo"
            class="rounded-md bg-[var(--amber-50)] p-3 text-sm text-[var(--amber-700)]"
          >
            <span class="eyebrow block text-[var(--amber-700)]">For the next shift</span>
            {{ report.importantInfo }}
          </div>

          <div
            class="flex flex-wrap gap-5 border-y border-[var(--border-subtle)] py-2.5 text-sm"
          >
            <span class="inline-flex items-center gap-1.5">
              <DsIcon name="users" :size="15" />
              <span class="tnum font-semibold">{{ report.interactions }}</span>
              <span class="text-muted-foreground">interactions</span>
            </span>
            <span class="inline-flex items-center gap-1.5">
              <DsIcon
                name="alert-triangle"
                :size="15"
                :class="report.events ? 'text-[var(--warning)]' : ''"
              />
              <span class="tnum font-semibold">{{ report.events }}</span>
              <span class="text-muted-foreground">events</span>
            </span>
            <span class="inline-flex items-center gap-1.5">
              <DsIcon name="list-checks" :size="15" />
              <span class="tnum font-semibold">{{ report.dutiesDone }}</span>
              <span class="text-muted-foreground">duties done</span>
            </span>
            <span class="text-muted-foreground">
              Submitted {{ formatDate(report.submittedAt) }}
            </span>
          </div>

          <div class="flex flex-wrap gap-4">
            <span
              v-for="item in CONFIRMATIONS"
              :key="item.key"
              class="inline-flex items-center gap-1.5 text-sm"
              :class="report[item.key] ? 'text-[var(--text-body)]' : 'text-[var(--text-subtle)]'"
            >
              <DsIcon
                :name="report[item.key] ? 'check-circle-2' : 'minus'"
                :size="14"
                :class="report[item.key] ? 'text-[var(--success)]' : ''"
              />
              {{ item.label }}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
