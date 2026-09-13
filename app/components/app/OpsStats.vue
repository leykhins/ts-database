<script setup lang="ts">
import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../../convex/_generated/api'
import type StatCard from '~/components/ds/StatCard.vue'
import { money } from '~/utils/format'

/**
 * The Home screen's four numbers, chosen by the role doing oversight.
 *
 * A Building Manager answers for the building as an asset — is it full, is it
 * paid, is it maintained. A Coordinator runs the day inside it, so leads with
 * the people at risk and whether the rooms are in hand, and the money comes
 * last. An Administrator reads the same building from above and gets the
 * headline of each: occupancy, money, care, checks.
 */
const props = defineProps<{
  data: NonNullable<FunctionReturnType<typeof api.dashboard.overview>>
  role?: string
}>()

type Tile = { key: string } & InstanceType<typeof StatCard>['$props']

const tiles = computed<Tile[]>(() => {
  const d = props.data
  const s = d.stats

  const occupancySeries = d.series.occupancy
  const priorOccupancy = occupancySeries.at(-2)
  const occupancy: Tile = {
    key: 'occupancy',
    icon: 'building-2',
    accent: 'blue',
    label: 'Occupancy',
    value: d.building.occupied,
    denominator: d.building.units,
    delta: priorOccupancy ? d.building.occupied - priorOccupancy.occupied : null,
    deltaPeriod: priorOccupancy ? `since ${priorOccupancy.label}` : undefined,
    sublabel: `${s.availableRooms} available · ${s.outOfServiceRooms} out of service`,
    series: occupancySeries.map((p) => ({ label: p.label, value: p.occupied })),
    seriesLabel: 'Occupied rooms, last 6 months',
    to: '/tenants',
  }

  /*
   * The rent line is the collection *rate*, not the amount collected. Every
   * month's amount starts at zero, so a line of amounts would plunge on the
   * first of each month and read as a collapse. A rate compares like with
   * like. Months with nothing charged have no rate and are left out rather
   * than drawn as zero.
   */
  const rate = s.chargedCents ? Math.round((s.collectedCents / s.chargedCents) * 100) : null
  const rent: Tile = {
    key: 'rent',
    icon: 'dollar-sign',
    accent: 'teal',
    label: 'Rent collected',
    value: money(s.collectedCents),
    badge: rate === null ? undefined : `${rate}%`,
    badgeTone: rate !== null && rate >= 90 ? 'success' : 'neutral',
    sublabel: s.chargedCents ? `of ${money(s.chargedCents)} charged this month` : 'Nothing charged yet this month',
    progress: rate ?? undefined,
    progressTone: rate !== null && rate >= 90 ? 'success' : 'brand',
    series: d.series.rent
      .filter((m) => m.chargedCents > 0)
      .map((m) => ({ label: m.label, value: Math.round((m.collectedCents / m.chargedCents) * 100) })),
    seriesLabel: 'Collection rate, last 6 months',
    seriesFormat: (v: number) => `${v}%`,
    to: '/rents',
  }

  const checks: Tile = {
    key: 'checks',
    icon: 'shield-check',
    accent: 'amber',
    label: 'Checks on time',
    value: d.streak,
    unit: d.streak === 1 ? ' day' : ' days',
    badge: s.roomsToCheck ? `${s.roomsToCheck} past due` : undefined,
    badgeTone: 'warning',
    sublabel: s.roomsToCheck ? 'Streak ends if they are missed' : 'Every room checked',
    series: d.series.checks.map((p) => ({ label: p.label, value: p.done })),
    seriesLabel: 'Room checks completed, last 14 days',
    seriesMin: 0,
    to: '/checks',
  }

  const critical: Tile = {
    key: 'critical',
    icon: 'heart-pulse',
    accent: 'rose',
    label: 'Critical needs',
    value: s.criticalCount,
    sublabel: s.criticalCount === 1 ? 'Resident with an open case' : 'Residents with an open case',
    to: '/critical',
  }

  const workOrders: Tile = {
    key: 'work-orders',
    icon: 'wrench',
    accent: 'indigo',
    label: 'Open work orders',
    value: s.openWorkOrders,
    sublabel: s.outOfServiceRooms
      ? `${s.outOfServiceRooms} room${s.outOfServiceRooms === 1 ? '' : 's'} out of service`
      : 'No rooms out of service',
    to: '/maintenance',
  }

  const clear: Tile = {
    key: 'clear',
    icon: 'check-circle-2',
    accent: 'brand',
    label: 'Rooms clear',
    value: s.clearRooms,
    denominator: s.totalRooms,
    sublabel: `${s.totalRooms - s.clearRooms} need something from you`,
    progress: s.totalRooms ? (s.clearRooms / s.totalRooms) * 100 : undefined,
    progressTone: s.clearRooms === s.totalRooms ? 'success' : 'brand',
  }

  switch (props.role) {
    case 'building-manager':
      return [occupancy, rent, workOrders, checks]
    case 'coordinator':
      return [critical, clear, checks, rent]
    default:
      return [occupancy, rent, critical, checks]
  }
})
</script>

<template>
  <DsStatGrid>
    <DsStatCard v-for="{ key, ...tile } in tiles" :key="key" v-bind="tile" />
  </DsStatGrid>
</template>
