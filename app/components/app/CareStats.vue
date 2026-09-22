<script setup lang="ts">
import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../../convex/_generated/api'
import type StatCard from '~/components/ds/StatCard.vue'

/**
 * The Care Console's four numbers, chosen by the role standing the shift.
 *
 * The four care roles share a console and an authority, but not a job. An
 * RSW walks the building, so leads with the round and the rooms; a Wellness
 * Worker carries the care plans, so leads with whether the people most at risk
 * have been seen; a Home Support Worker does the personal care and the med
 * pass, so their own duty list sits second rather than off the edge. Same
 * data, one subscription — only the choice and order of tiles differ.
 */
const props = defineProps<{
  data: NonNullable<FunctionReturnType<typeof api.care.overview>>
}>()

type Tile = { key: string } & InstanceType<typeof StatCard>['$props']

const tiles = computed<Tile[]>(() => {
  const d = props.data
  const wi = d.wellnessIndex
  const critical = d.critical.length
  const criticalSeen = critical - wi.criticalUnseen.length
  const duty = d.me.dutyProgress
  const pct = (n: number, of: number) => (of ? (n / of) * 100 : 0)

  const wellness: Tile = {
    key: 'wellness',
    icon: 'heart',
    accent: 'brand',
    label: 'Wellness Index',
    value: wi.score,
    unit: '%',
    badge: wi.band,
    badgeTone: wi.score >= 80 ? 'success' : wi.score >= 65 ? 'warning' : 'danger',
    delta: d.trend.delta,
    deltaUnit: ' pts',
    deltaPeriod: 'from last shift',
    series: d.trend.wellness.map((p) => ({ label: p.label, value: p.score })),
    seriesLabel: 'Wellness Index, last 8 shifts',
    seriesFormat: (v: number) => `${v}%`,
  }

  const checks: Tile = {
    key: 'checks',
    icon: 'clipboard-check',
    accent: 'teal',
    label: 'Wellness checks',
    value: d.live.done,
    denominator: d.live.total,
    sublabel: d.live.overdue
      ? `${d.live.overdue} overdue · ${d.live.pending} left to see`
      : `${d.live.pending} resident${d.live.pending === 1 ? '' : 's'} left to see`,
    progress: pct(d.live.done, d.live.total),
    progressTone: d.live.overdue ? 'warning' : 'brand',
  }

  const occupancy: Tile = {
    key: 'occupancy',
    icon: 'building-2',
    accent: 'blue',
    label: 'Occupancy',
    value: d.occupancy.occupied,
    denominator: d.occupancy.units,
    sublabel: `${d.occupancy.available} available · ${d.occupancy.outOfService} out of service`,
    to: '/tenants',
  }

  const criticalNeeds: Tile = {
    key: 'critical',
    icon: 'flag',
    accent: 'rose',
    label: 'Open critical needs',
    value: critical,
    badge: wi.criticalUnseen.length ? `${wi.criticalUnseen.length} not seen` : undefined,
    badgeTone: 'danger',
    sublabel: critical
      ? wi.criticalUnseen.length
        ? 'A mandatory look this shift'
        : 'All seen this shift'
      : 'No open cases',
    to: '/critical',
  }

  // Seen, not unseen, fills the bar: a meter that grows as the work gets done
  // reads the right way round, and an empty bar at shift start is honest.
  const criticalSeenTile: Tile = {
    key: 'critical-seen',
    icon: 'heart-pulse',
    accent: 'rose',
    label: 'Critical residents seen',
    value: criticalSeen,
    denominator: critical,
    sublabel: wi.criticalUnseen.length
      ? `Still to see: ${wi.criticalUnseen.map((r) => r.room).slice(0, 3).join(', ')}${wi.criticalUnseen.length > 3 ? '…' : ''}`
      : critical ? 'Every open case seen' : 'No open cases',
    progress: critical ? pct(criticalSeen, critical) : undefined,
    progressTone: wi.criticalUnseen.length ? 'danger' : 'success',
    to: '/critical',
  }

  const offRound: Tile = {
    key: 'flagged',
    icon: 'clock',
    accent: 'amber',
    label: 'Off the round',
    value: d.flagged.length,
    badge: d.flagged.some((f) => f.critical) ? 'Includes critical' : undefined,
    badgeTone: 'danger',
    sublabel: 'Not seen in a day or more',
  }

  const duties: Tile = {
    key: 'duties',
    icon: d.me.dutyIcon,
    accent: d.me.dutyAccent as Tile['accent'],
    label: d.me.dutyTitle,
    value: duty.done,
    denominator: duty.total,
    sublabel:
      duty.done === duty.total ? 'All done this shift' : `${duty.total - duty.done} still to do`,
    progress: pct(duty.done, duty.total),
    progressTone: duty.done === duty.total ? 'success' : 'brand',
  }

  switch (d.me.role) {
    case 'wellness':
      return [wellness, criticalSeenTile, offRound, duties]
    case 'health-care-aide':
      return [duties, criticalSeenTile, checks, {
        key: 'observations', icon: 'file-text', accent: 'blue',
        label: 'My shift entries', value: d.me.entryCount,
        sublabel: `${d.me.significantCount} significant · observations and handover`,
        to: '/care/report',
      }]
    case 'home-support':
      return [checks, duties, criticalNeeds, wellness]
    // RSW, and anyone else who opens the console — the reference layout.
    default:
      return [wellness, checks, occupancy, criticalNeeds]
  }
})
</script>

<template>
  <DsStatGrid>
    <DsStatCard v-for="{ key, ...tile } in tiles" :key="key" v-bind="tile" />
  </DsStatGrid>
</template>
