<script setup lang="ts">
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { money } from '~/utils/format'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

/**
 * Home — leads with building state and the next action, not a menu of links.
 * All Clear banner → room grid + priority queue → KPIs → area launcher.
 */
const { selected } = useSelectedBuilding()

// A frontline worker's home is the shift, not the building's books — the
// layout's area guard sends them to /care, so there is nothing to do here.

const { data: overview, isLoading } = useConvexQuery(api.dashboard.overview, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
}))

usePageHeader(() => ({
  eyebrow: overview.value?.building.name ?? '',
  title: 'Home',
}))

const openCount = computed(() => overview.value?.actions.length ?? 0)
const allClear = computed(() => !isLoading.value && openCount.value === 0)
const highPriority = computed(
  () => overview.value?.actions.filter((a) => a.priority === 'high').length ?? 0,
)

const collectionRate = computed(() => {
  const s = overview.value?.stats
  if (!s || s.chargedCents === 0) return null
  return Math.round((s.collectedCents / s.chargedCents) * 100)
})

/* ---- Receive Rent, launched straight from the queue ---- */
const rentTenantId = ref<Id<'tenants'> | null>(null)
const { data: rentTenant } = useConvexQuery(api.tenants.get, () =>
  rentTenantId.value ? { tenantId: rentTenantId.value } : null,
)

const dialogTenant = computed(() =>
  rentTenant.value && rentTenantId.value
    ? {
        _id: rentTenant.value._id,
        name: rentTenant.value.name,
        room: rentTenant.value.room,
        monthlyRentCents: rentTenant.value.monthlyRentCents,
        balanceCents: rentTenant.value.balanceCents,
      }
    : null,
)

function act(item: { kind: string; tenantId: Id<'tenants'> | null; href: string }) {
  if (item.kind === 'rent' && item.tenantId) {
    rentTenantId.value = item.tenantId
    return
  }
  navigateTo(item.href)
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <template v-if="overview">
      <!-- All Clear banner — the metric staff work toward -->
      <section
        class="flex flex-col items-start gap-6 rounded-xl p-6 text-white sm:flex-row sm:items-center"
        :class="allClear ? 'bg-[var(--emerald-700)]' : 'bg-[var(--slate-950)]'"
      >
        <div class="min-w-0 flex-1">
          <div class="eyebrow text-white/60">{{ overview.building.name }} · Shift status</div>
          <h2 class="mt-1.5 text-2xl font-extrabold tracking-tight text-white">
            <template v-if="allClear">All Clear</template>
            <template v-else>
              <span class="tnum">{{ openCount }}</span> items from All Clear
            </template>
          </h2>
          <p class="mt-1.5 max-w-[560px] text-base text-pretty text-white/70">
            <template v-if="allClear">
              Every room checked, every rent posted, no open critical needs.
              Finalize the shift report to hand off.
            </template>
            <template v-else>
              {{ highPriority }} need attention before end of shift. The rest of the building —
              {{ overview.stats.clearRooms }} of {{ overview.stats.totalRooms }} rooms — is clear.
            </template>
          </p>
          <div class="mt-4 flex flex-wrap gap-3">
            <Button variant="primary" @click="navigateTo('/checks')">
              <DsIcon name="shield-check" :size="17" />
              Start building check
            </Button>
            <Button variant="ghost" class="text-white hover:bg-white/10" @click="navigateTo('/reports')">
              Shift Report
              <DsIcon name="arrow-right" :size="17" />
            </Button>
          </div>
        </div>

        <div class="shrink-0 border-white/15 sm:border-l sm:pl-6 sm:text-right">
          <div class="tnum text-2xl font-extrabold text-white">{{ overview.streak }}</div>
          <div class="max-w-[120px] text-xs text-white/65">
            days of checks completed on time
          </div>
        </div>
      </section>

      <!-- Building state + what to do next -->
      <div class="flex flex-wrap items-start gap-6">
        <Card class="min-w-0 flex-[1_1_540px]">
          <CardHeader>
            <span
              class="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-[var(--surface-sunken)] text-muted-foreground"
            >
              <DsIcon name="building-2" :size="18" />
            </span>
            <div class="flex min-w-0 flex-col gap-px">
              <span class="eyebrow">Live · {{ overview.stats.totalRooms }} rooms</span>
              <CardTitle>Building state</CardTitle>
            </div>
            <CardAction>
              <Button variant="ghost" size="sm" @click="navigateTo('/tenants')">
                Roster
                <DsIcon name="arrow-right" :size="15" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <TsRoomGrid :floors="overview.floors" />
          </CardContent>
        </Card>

        <Card class="min-w-0 flex-[1_1_340px]">
          <CardHeader>
            <span
              class="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-[var(--surface-sunken)] text-muted-foreground"
            >
              <DsIcon name="bell" :size="18" />
            </span>
            <div class="flex min-w-0 flex-col gap-px">
              <span class="eyebrow">Blocking All Clear</span>
              <CardTitle>Do next</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div v-if="overview.actions.length" class="flex flex-col gap-0.5">
              <TsActionRow
                v-for="item in overview.actions"
                :key="item.id"
                :item="item"
                @act="act(item)"
              />
            </div>
            <DsEmptyState
              v-else
              icon="check-circle-2"
              title="Work queue is clear"
              description="Nothing is blocking All Clear in this building."
              accent="var(--success)"
            />

            <div v-if="overview.criticalResidents.length" class="mt-5">
              <Separator class="mb-4" />
              <div class="eyebrow mb-2 block">Critical residents</div>
              <NuxtLink
                v-for="resident in overview.criticalResidents"
                :key="resident.tenantId"
                :to="`/tenants/${resident.tenantId}`"
                class="group flex w-full items-center gap-2.5 py-2 no-underline hover:no-underline"
              >
                <span
                  class="flex-1 text-sm font-semibold text-[var(--text-strong)] transition-colors group-hover:text-[var(--brand-strong)]"
                >
                  {{ resident.name }}
                </span>
                <span class="tnum text-xs text-[var(--text-subtle)]">{{ resident.room }}</span>
                <DsSupportMeter :level="resident.supportLevel" size="sm" :show-label="false" />
                <DsIcon name="chevron-right" :size="15" class="text-[var(--text-subtle)]" />
              </NuxtLink>
            </div>
          </CardContent>
        </Card>
      </div>

      <!-- KPI strip -->
      <div class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
        <DsStatCard
          icon="users"
          accent="teal"
          label="Current tenants"
          :value="overview.stats.currentTenants"
          :sublabel="`${overview.building.occupied} of ${overview.building.units} rooms occupied`"
        />
        <DsStatCard
          icon="dollar-sign"
          accent="blue"
          label="Rent collected"
          :value="money(overview.stats.collectedCents)"
          :trend="collectionRate ? `${collectionRate}% of ${money(overview.stats.chargedCents)}` : undefined"
          :trend-dir="collectionRate && collectionRate >= 90 ? 'up' : 'down'"
        />
        <DsStatCard
          icon="heart-pulse"
          accent="rose"
          label="Critical needs"
          :value="overview.stats.criticalCount"
          sublabel="Residents with an open case"
        />
        <DsStatCard
          icon="shield-check"
          accent="amber"
          label="Rooms to check"
          :value="overview.stats.roomsToCheck"
          :trend-dir="overview.stats.roomsToCheck > 0 ? 'down' : 'up'"
          :trend="overview.stats.roomsToCheck > 0 ? 'past due' : 'on time'"
        />
      </div>

      <!-- Area launcher — compact; the sidebar carries navigation -->
      <div class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <DsCategoryTile
          icon="info"
          title="Tenant Information"
          color="teal"
          :count="`${overview.stats.currentTenants} current`"
          to="/tenants"
        />
        <DsCategoryTile
          icon="dollar-sign"
          title="Rents"
          color="blue"
          :count="`${overview.counts.rentWarnings} warnings`"
          to="/rents"
        />
        <DsCategoryTile
          icon="shield-check"
          title="Room Checks"
          color="green"
          :count="`${overview.stats.roomsToCheck} overdue`"
          to="/checks"
        />
        <DsCategoryTile icon="lock" title="Security Deposits" color="cyan" to="/deposits" />
        <DsCategoryTile
          icon="heart-pulse"
          title="Critical Needs"
          color="rose"
          :count="`${overview.stats.criticalCount} residents`"
          to="/critical"
        />
        <DsCategoryTile
          icon="clipboard-list"
          title="Auxiliary Reports"
          color="violet"
          to="/reports"
        />
      </div>
    </template>

    <TsLoadingState v-else-if="isLoading" label="Loading building state…" :rows="6" />

    <DsEmptyState
      v-else
      icon="building-2"
      title="No buildings yet"
      description="Seed the development data with `npx convex run seed:run` to see the dashboard with sample residents."
    />

    <TsReceiveRentDialog
      :open="!!dialogTenant"
      :tenant="dialogTenant"
      @close="rentTenantId = null"
    />
  </div>
</template>
