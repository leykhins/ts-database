<script setup lang="ts">
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { ShiftKey } from '../../../convex/shifts'
import { localDate } from '../../../convex/shifts'
import { formatDate } from '~/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * My Shifts — a worker's own handovers, found by the day they worked.
 *
 * The calendar is the index and the list is the page: pick a month, see which
 * days were worked, tap one to narrow the list to that day, tap a report to
 * read it in full.
 */
const tz = new Date().getTimezoneOffset()
const today = localDate(Date.now(), tz)
const thisMonth = today.slice(0, 7)

const month = ref(thisMonth)
const selectedDay = ref<string | null>(null)
const openReport = ref<Id<'shiftReports'> | null>(null)

const { data, isLoading } = useConvexQuery(api.shiftReports.mine, () => ({ month: month.value }))

usePageHeader({ eyebrow: 'Care', title: 'My Shifts' })

const monthLabel = computed(() => {
  const [y, m] = month.value.split('-').map(Number) as [number, number]
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})

function shiftMonth(by: number) {
  const [y, m] = month.value.split('-').map(Number) as [number, number]
  const next = new Date(y, m - 1 + by, 1)
  month.value = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
  selectedDay.value = null
}

/**
 * How far back the arrows go.
 *
 * Deliberately a window and not "your first shift". Stopping at the earliest
 * report read as a broken control: a worker whose whole history sits in one
 * month had both arrows disabled at once and no way to move, which is exactly
 * what somebody looking for last month's handover reaches for first. An empty
 * month is a fine answer — the empty state says so, and says where the
 * reports actually start.
 */
const MONTHS_BACK = 24

const floorMonth = computed(() => {
  const [y, m] = thisMonth.split('-').map(Number) as [number, number]
  const floor = new Date(y, m - 1 - MONTHS_BACK, 1)
  return `${floor.getFullYear()}-${String(floor.getMonth() + 1).padStart(2, '0')}`
})

const canGoBack = computed(() => month.value > floorMonth.value)
const floorLabel = computed(() => {
  const [y, m] = floorMonth.value.split('-').map(Number) as [number, number]
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})
const canGoForward = computed(() => month.value < thisMonth)
const isThisMonth = computed(() => month.value === thisMonth)

/** Where this worker's history actually begins, as a month a person can read. */
const earliestLabel = computed(() => {
  const earliest = data.value?.earliest
  if (!earliest) return null
  const [y, m] = earliest.split('-').map(Number) as [number, number]
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})

/** ISO day → shifts filed, for the calendar. */
const days = computed(() => {
  const out: Record<string, ShiftKey[]> = {}
  for (const r of data.value?.reports ?? []) (out[r.shiftDate] ??= []).push(r.shiftKey)
  return out
})

const visible = computed(() => {
  const reports = data.value?.reports ?? []
  return selectedDay.value ? reports.filter((r) => r.shiftDate === selectedDay.value) : reports
})

const SHIFT_ICON: Record<ShiftKey, string> = { overnight: 'moon', morning: 'sunrise', evening: 'sunset' }
</script>

<template>
  <div class="flex flex-col gap-5">
    <DsSectionHeader
      eyebrow="Care"
      title="My Shifts"
      description="Every shift report you have filed, found by the day you worked it."
    >
      <template #actions>
        <Button variant="primary" @click="navigateTo('/care/report')">
          <DsIcon name="file-text" :size="17" />
          My shift report
        </Button>
      </template>
    </DsSectionHeader>

    <div class="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
      <DsPanel
        :title="monthLabel"
        :count="data ? data.reports.length : null"
        subtitle="Darker days carried more shifts. Tap a day to see its reports."
      >
        <template #action>
          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous month"
              :disabled="!canGoBack"
              :title="canGoBack ? 'Previous month' : `This view goes back to ${floorLabel}`"
              @click="shiftMonth(-1)"
            >
              <DsIcon name="chevron-left" :size="18" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next month"
              :disabled="!canGoForward"
              :title="canGoForward ? 'Next month' : 'This is the current month'"
              @click="shiftMonth(1)"
            >
              <DsIcon name="chevron-right" :size="18" />
            </Button>
          </div>
        </template>

        <TsShiftHeatmap
          v-model:selected="selectedDay"
          :month="month"
          :days="days"
          :today="today"
        />

        <template v-if="selectedDay" #footer>
          <button type="button" class="inline-flex items-center gap-1.5" @click="selectedDay = null">
            <DsIcon name="x" :size="15" />
            Clear {{ formatDate(selectedDay) }}
          </button>
        </template>
      </DsPanel>

      <div class="flex min-w-0 flex-col gap-4">
        <TsLoadingState v-if="isLoading" label="Loading your shifts…" :rows="4" />

        <div v-else-if="!visible.length" class="flex flex-col items-center gap-3">
          <DsEmptyState
            icon="calendar"
            accent="var(--green-600)"
            :title="selectedDay ? `Nothing filed on ${formatDate(selectedDay)}` : `No shifts in ${monthLabel}`"
            :description="
              selectedDay
                ? 'Pick another day on the calendar, or clear it to see the whole month.'
                : earliestLabel
                  ? `Your shift reports start in ${earliestLabel}. Reports you submit at handover appear here, on the day you worked.`
                  : 'Reports you submit at handover appear here, on the day you worked.'
            "
          />
          <Button v-if="!selectedDay && !isThisMonth" variant="secondary" size="sm" @click="month = thisMonth">
            <DsIcon name="calendar" :size="15" />
            Back to this month
          </Button>
        </div>

        <template v-else>
          <Card
            v-for="report in visible"
            :key="report._id"
            class="cursor-pointer transition-[border-color,box-shadow] hover:border-[var(--border-strong)] focus-within:border-[var(--border-strong)]"
            role="button"
            tabindex="0"
            @click="openReport = report._id"
            @keydown.enter.prevent="openReport = report._id"
            @keydown.space.prevent="openReport = report._id"
          >
            <CardContent class="flex flex-col gap-3 p-5">
              <div class="flex flex-wrap items-center gap-2">
                <span class="inline-flex size-8 items-center justify-center rounded-md bg-[var(--green-50)] text-[var(--green-700)]">
                  <DsIcon :name="SHIFT_ICON[report.shiftKey]" :size="16" />
                </span>
                <span class="font-semibold text-[var(--text-strong)]">{{ report.label }}</span>
                <span class="text-sm text-[var(--text-subtle)]">
                  {{ report.hours }} · {{ formatDate(report.shiftDate) }}
                </span>
                <Badge variant="neutral" class="ml-auto">{{ report.building }}</Badge>
              </div>

              <div v-if="report.significant || report.cameraReview" class="flex flex-wrap gap-1.5">
                <Badge v-if="report.significant" variant="danger">
                  {{ report.significant }} significant {{ report.significant === 1 ? 'entry' : 'entries' }}
                </Badge>
                <Badge v-if="report.cameraReview" variant="violet">Camera review required</Badge>
              </div>

              <p class="line-clamp-3 text-base text-pretty text-[var(--text-body)]">{{ report.summary }}</p>

              <div class="flex flex-wrap items-center gap-5 border-t border-[var(--border-subtle)] pt-2.5 text-sm">
                <span class="inline-flex items-center gap-1.5">
                  <DsIcon name="users" :size="15" />
                  <span class="tnum font-semibold">{{ report.interactions }}</span>
                  <span class="text-muted-foreground">interactions</span>
                </span>
                <span class="inline-flex items-center gap-1.5">
                  <DsIcon name="alert-triangle" :size="15" :class="report.events ? 'text-[var(--warning)]' : ''" />
                  <span class="tnum font-semibold">{{ report.events }}</span>
                  <span class="text-muted-foreground">events</span>
                </span>
                <span class="ml-auto inline-flex items-center gap-1 text-muted-foreground">
                  Read in full
                  <DsIcon name="arrow-right" :size="14" />
                </span>
              </div>
            </CardContent>
          </Card>
        </template>
      </div>
    </div>

    <TsShiftReportDialog :report-id="openReport" @close="openReport = null" />
  </div>
</template>
