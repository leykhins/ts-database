<script setup lang="ts">
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { SHIFTS, shiftAt } from '../../convex/shifts'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Home — leads with the shift you are standing in, not with a KPI.
 *
 * The reading path is the Evergreen one: who you are and where, then one
 * sentence on whether the building is in good hands, then the numbers, then
 * two independent columns — the work and the building on the left, the people
 * and the areas on the right. Nothing here is a link menu until the bottom of
 * the right column; the sidebar already carries navigation.
 */
const { selected } = useSelectedBuilding()
const { me } = useMe()

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

/** The shift on now, by the building's own schedule rather than "afternoon". */
const now = useNow()
const shiftLabel = computed(() => {
  const key = shiftAt(now.value, new Date().getTimezoneOffset()).key
  return SHIFTS.find((s) => s.key === key)!.label.replace(/ Staff$/, '').toLowerCase()
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
      <TsGreeting :site="overview.building.name" />

      <!--
        One sentence on whether the building is in good hands. It replaces the
        full-bleed banner: a whole coloured field for a status the rest of the
        page already details was the loudest thing on a quiet screen.
      -->
      <section class="status-strip" :class="allClear ? 'is-clear' : 'is-open'">
        <span class="status-strip__icon">
          <DsIcon :name="allClear ? 'shield-check' : 'bell'" :size="19" />
        </span>
        <p class="status-strip__copy">
          <strong>
            <template v-if="allClear">The building is in good hands.</template>
            <template v-else>
              <span class="tnum">{{ openCount }}</span> items from All Clear.
            </template>
          </strong>
          <span>
            <template v-if="allClear">
              Every room checked, every rent posted, no open critical needs. Finalize the shift
              report to hand off.
            </template>
            <template v-else>
              {{ highPriority }} need attention before end of shift. The rest of the building —
              {{ overview.stats.clearRooms }} of {{ overview.stats.totalRooms }} rooms — is clear.
            </template>
          </span>
        </p>
        <div class="status-strip__actions">
          <Button variant="primary" size="sm" @click="navigateTo('/checks')">
            <DsIcon name="shield-check" :size="16" />
            Start building check
          </Button>
          <Button variant="ghost" size="sm" @click="navigateTo('/reports')">
            Shift report
            <DsIcon name="arrow-right" :size="16" />
          </Button>
        </div>
      </section>

      <!-- KPI strip — which four numbers depends on the role; see TsOpsStats -->
      <TsOpsStats :data="overview" :role="me?.role" />

      <!--
        Two independent columns rather than one wrapping row. The left is the
        work and the building it happens in; the right is the people and the
        way into each area. Neither column's height is allowed to push the
        other's contents around.
      -->
      <div class="dashboard-grid">
        <div class="dashboard-column">
          <Card>
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
            </CardContent>
          </Card>

          <Card>
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
        </div>

        <div class="dashboard-column">
          <Card>
            <CardHeader>
              <span
                class="inline-flex size-7 shrink-0 items-center justify-center rounded-sm bg-[var(--rose-50)] text-[var(--rose-600)]"
              >
                <DsIcon name="heart-pulse" :size="18" />
              </span>
              <div class="flex min-w-0 flex-col gap-px">
                <span class="eyebrow">Read before you knock</span>
                <CardTitle>Critical residents</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <NuxtLink
                v-for="resident in overview.criticalResidents"
                :key="resident.tenantId"
                :to="`/tenants/${resident.tenantId}`"
                class="group flex w-full items-center gap-2.5 border-b border-[var(--border-subtle)] py-2.5 no-underline last:border-0 hover:no-underline"
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
              <DsEmptyState
                v-if="!overview.criticalResidents.length"
                icon="check-circle-2"
                title="Nobody on critical watch"
                description="No resident in this building has an open case."
                accent="var(--success)"
              />
            </CardContent>
          </Card>

          <!-- Area launcher — compact; the sidebar carries navigation -->
          <div class="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
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
        </div>
      </div>

      <footer class="dashboard-footer">
        <span>
          <DsIcon name="shield-check" :size="13" />
          A little clarity. More room for care.
        </span>
        <span>{{ overview.building.name }} · {{ shiftLabel }} shift</span>
      </footer>
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

<style scoped>
/* ---- Status strip ---- */
.status-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 11px;
  padding: 12px 15px;
  border: 1px solid;
  border-radius: 7px;
}

.status-strip.is-clear {
  background: var(--success-soft);
  border-color: color-mix(in srgb, var(--success) 18%, transparent);
  color: var(--success);
}

/* Not red: an open queue is the normal state of a working shift, not a
   fault. Sage says "there is work" without saying "something is wrong". */
.status-strip.is-open {
  background: var(--surface-sunken);
  border-color: var(--border);
  color: var(--brand);
}

.status-strip__icon {
  display: flex;
  align-items: center;
}

.status-strip__copy {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 9px;
  min-width: 240px;
  line-height: 1.4;
}

.status-strip__copy strong {
  font-weight: 600;
}

.status-strip__copy > span {
  font-size: 11px;
  color: var(--text-muted);
}

.status-strip__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}

/* ---- Columns ---- */
.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.52fr) minmax(310px, 1fr);
  gap: 22px;
  align-items: start;
}

.dashboard-column {
  display: flex;
  flex-direction: column;
  gap: 22px;
  min-width: 0;
}

@media (max-width: 1080px) {
  .dashboard-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.dashboard-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 25px;
  font-size: 10px;
  color: var(--text-muted);
}

.dashboard-footer > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
