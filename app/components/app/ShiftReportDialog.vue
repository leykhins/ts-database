<script setup lang="ts">
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { formatDate } from '~/utils/format'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogScrollContent,
  DialogTitle,
} from '@/components/ui/dialog'

/** ShiftReportDialog — one submitted handover, read in full. */
const props = defineProps<{ reportId: Id<'shiftReports'> | null }>()
const emit = defineEmits<{ close: [] }>()

const { data, isLoading } = useConvexQuery(api.shiftReports.get, () =>
  props.reportId ? { reportId: props.reportId } : null,
)

const CONFIRMATIONS = [
  { key: 'radioCheck', label: 'Radio check' },
  { key: 'handover', label: 'Handover' },
  { key: 'readPrevious', label: 'Read previous' },
] as const

const time = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

/** Duty keys are slugs (`harm-reduction`); the person reads words. */
const dutyLabel = (key: string) => key.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

const logs = computed(() => {
  const entries = data.value?.entries ?? []
  return [
    { key: 'interaction', title: 'Interaction log', rows: entries.filter((e) => e.log === 'interaction') },
    { key: 'event', title: 'Event log', rows: entries.filter((e) => e.log === 'event') },
  ].filter((l) => l.rows.length)
})
</script>

<template>
  <Dialog :open="!!reportId" @update:open="(value) => !value && emit('close')">
    <DialogScrollContent class="gap-0 p-0 sm:max-w-[640px]">
      <DialogHeader
        class="flex-row items-center gap-3 space-y-0 border-b border-[var(--border-subtle)] p-[22px]"
      >
        <span class="inline-flex size-[38px] shrink-0 items-center justify-center rounded-md bg-[var(--blue-50)] text-[var(--blue-600)]">
          <DsIcon name="file-text" :size="20" />
        </span>
        <div class="min-w-0 flex-1 text-left">
          <DialogTitle class="text-lg font-semibold text-[var(--text-strong)]">
            {{ data ? `${data.label} · ${formatDate(data.shiftDate)}` : 'Shift report' }}
          </DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground">
            {{ data ? `${data.hours} · ${data.building} · ${data.author}` : 'Loading the report…' }}
          </DialogDescription>
        </div>
      </DialogHeader>

      <TsLoadingState v-if="isLoading || !data" class="p-[22px]" label="Loading report…" :rows="4" />

      <div v-else class="flex flex-col gap-5 p-[22px]">
        <section class="flex flex-col gap-1.5">
          <span class="eyebrow">Summary</span>
          <p class="text-base text-pretty text-[var(--text-body)]">{{ data.summary || '—' }}</p>
        </section>

        <section
          v-if="data.importantInfo"
          class="rounded-md bg-[var(--amber-50)] p-3 text-sm text-[var(--amber-700)]"
        >
          <span class="eyebrow block text-[var(--amber-700)]">For the next shift</span>
          {{ data.importantInfo }}
        </section>

        <section v-if="data.extraTasks" class="flex flex-col gap-1.5">
          <span class="eyebrow">Extra tasks</span>
          <p class="text-sm text-pretty text-[var(--text-body)]">{{ data.extraTasks }}</p>
        </section>

        <section v-for="log in logs" :key="log.key" class="flex flex-col gap-2">
          <span class="eyebrow">{{ log.title }}</span>
          <div
            v-for="entry in log.rows"
            :key="entry._id"
            class="flex flex-col gap-1 rounded-md p-3"
            :class="entry.significant ? 'bg-[var(--rose-50)]' : 'bg-[var(--surface-sunken)]'"
          >
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span class="font-bold tracking-wide text-[var(--text-strong)] uppercase">{{ entry.kindLabel }}</span>
              <span class="tnum text-muted-foreground">{{ time(entry.occurredAt) }} · {{ entry.location }}</span>
              <Badge v-if="entry.significant" variant="danger" dot>Significant</Badge>
              <Badge v-if="entry.cameraReview" variant="violet">Camera review</Badge>
              <Badge v-if="entry.emergencyServices" variant="rose">Emergency services</Badge>
              <Badge v-if="entry.evacuated" variant="rose">Evacuated</Badge>
            </div>
            <span v-if="entry.residents.length" class="text-xs font-semibold text-[var(--text-body)]">
              {{ entry.residents.join(', ') }}
            </span>
            <p class="text-sm text-pretty text-[var(--text-body)]">{{ entry.comments }}</p>
          </div>
        </section>

        <section class="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-4">
          <span class="eyebrow">Checklist</span>
          <div class="flex flex-wrap gap-x-4 gap-y-1.5">
            <span
              v-for="item in CONFIRMATIONS"
              :key="item.key"
              class="inline-flex items-center gap-1.5 text-sm"
              :class="data[item.key] ? 'text-[var(--text-body)]' : 'text-[var(--text-subtle)]'"
            >
              <DsIcon
                :name="data[item.key] ? 'check-circle-2' : 'minus'"
                :size="14"
                :class="data[item.key] ? 'text-[var(--success)]' : ''"
              />
              {{ item.label }}
            </span>
            <span
              v-for="(done, key) in data.duties"
              :key="key"
              class="inline-flex items-center gap-1.5 text-sm"
              :class="done ? 'text-[var(--text-body)]' : 'text-[var(--text-subtle)]'"
            >
              <DsIcon :name="done ? 'check-circle-2' : 'minus'" :size="14" :class="done ? 'text-[var(--success)]' : ''" />
              {{ dutyLabel(String(key)) }}
            </span>
          </div>
          <span class="text-xs text-muted-foreground">Submitted {{ formatDate(data.submittedAt) }}</span>
        </section>
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
