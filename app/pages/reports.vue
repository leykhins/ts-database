<script setup lang="ts">
import { api } from '../../convex/_generated/api'
import { formatDate, money } from '~/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * Auxiliary Reports — the shift handover and the month's summaries.
 *
 * `now` is passed to the query rather than read inside it: a Convex query does
 * not re-run because the clock moved, so the client owns the clock and the
 * numbers stay live as the shift goes on.
 */
const { selected } = useSelectedBuilding()

const now = ref(Date.now())
const timer = setInterval(() => (now.value = Date.now()), 60_000)
onScopeDispose(() => clearInterval(timer))

const { data, isLoading } = useConvexQuery(api.reports.shift, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
  now: now.value,
}))

usePageHeader(() => ({
  eyebrow: data.value?.building.name ?? '',
  title: 'Auxiliary Reports',
}))

const tab = ref('shift')

function print() {
  window.print()
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <DsSectionHeader
      :eyebrow="data?.building.name"
      title="Auxiliary Reports"
      :description="
        data
          ? `Live as of ${new Date(data.generatedAt).toLocaleTimeString()}. Printing takes what is on screen.`
          : undefined
      "
    >
      <template #actions>
        <Button variant="secondary" @click="print">
          <DsIcon name="printer" :size="17" />
          Print
        </Button>
      </template>
    </DsSectionHeader>

    <TsLoadingState v-if="isLoading" label="Building the report…" :rows="8" />

    <template v-else-if="data">
      <Tabs v-model="tab">
        <TabsList class="print:hidden">
          <TabsTrigger value="shift">Shift handover</TabsTrigger>
          <TabsTrigger value="occupancy">Occupancy</TabsTrigger>
          <TabsTrigger value="roll">Rent roll</TabsTrigger>
          <TabsTrigger value="people">Birthdays</TabsTrigger>
        </TabsList>

        <!-- ------------------------------------------------ Shift handover -->
        <TabsContent value="shift" class="mt-5 flex flex-col gap-5">
          <div class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
            <DsStatCard
              icon="dollar-sign"
              accent="blue"
              label="Taken in 24h"
              :value="money(data.lastDay.paymentsCents)"
              :sublabel="`${data.lastDay.payments} payments posted`"
            />
            <DsStatCard
              icon="shield-check"
              accent="teal"
              label="Checks in 24h"
              :value="data.lastDay.checks"
              :sublabel="`${data.lastDay.deficiencies} deficiencies, ${data.lastDay.noEntry} no-entry`"
            />
            <DsStatCard
              icon="heart-pulse"
              accent="rose"
              label="Open cases"
              :value="data.handover.openNeeds.length"
              sublabel="Carried into the next shift"
            />
            <DsStatCard
              icon="wrench"
              accent="amber"
              label="Open work orders"
              :value="data.handover.openOrders.length"
              sublabel="Raised and not yet closed"
            />
          </div>

          <div class="grid gap-5 md:grid-cols-2">
            <Card>
              <CardContent class="flex flex-col gap-3 p-5">
                <span class="eyebrow">Rooms still to check</span>
                <p v-if="!data.handover.roomsToCheck.length" class="text-base text-muted-foreground">
                  Every room is inside the weekly interval.
                </p>
                <div v-else class="flex flex-wrap gap-1.5">
                  <span
                    v-for="room in data.handover.roomsToCheck"
                    :key="room"
                    class="mono rounded-sm bg-[var(--surface-sunken)] px-2 py-1 text-sm font-semibold text-[var(--text-strong)]"
                  >
                    {{ room }}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent class="flex flex-col gap-3 p-5">
                <span class="eyebrow">Two months or more behind</span>
                <p v-if="!data.handover.arrears.length" class="text-base text-muted-foreground">
                  Nobody is two months behind.
                </p>
                <div
                  v-for="row in data.handover.arrears"
                  :key="row.room + row.name"
                  class="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span class="text-[var(--text-strong)]">
                    <span class="mono">{{ row.room }}</span> · {{ row.name }}
                  </span>
                  <span class="tnum font-semibold text-destructive">
                    {{ money(row.balanceCents) }}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent class="flex flex-col gap-3 p-5">
                <span class="eyebrow">Open cases</span>
                <p v-if="!data.handover.openNeeds.length" class="text-base text-muted-foreground">
                  No open cases.
                </p>
                <div v-for="need in data.handover.openNeeds" :key="need._id" class="text-sm">
                  <span class="font-semibold text-[var(--text-strong)]">
                    {{ need.name }} <span class="mono text-muted-foreground">{{ need.room }}</span>
                  </span>
                  <p class="text-muted-foreground">
                    {{ need.summary }} · {{ need.daysOpen }}d open
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent class="flex flex-col gap-3 p-5">
                <span class="eyebrow">Open work orders</span>
                <p v-if="!data.handover.openOrders.length" class="text-base text-muted-foreground">
                  Nothing outstanding.
                </p>
                <div
                  v-for="order in data.handover.openOrders"
                  :key="order._id"
                  class="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span class="min-w-0">
                    <span class="font-semibold text-[var(--text-strong)]">{{ order.title }}</span>
                    <span class="mono text-muted-foreground"> · {{ order.room }}</span>
                    <span v-if="order.assignedTo" class="text-muted-foreground">
                      · {{ order.assignedTo }}
                    </span>
                  </span>
                  <Badge :variant="order.priority === 'high' ? 'danger' : 'neutral'">
                    {{ order.priority }}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <!-- --------------------------------------------------- Occupancy -->
        <TabsContent value="occupancy" class="mt-5 flex flex-col gap-5">
          <div class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
            <DsStatCard
              icon="building-2"
              accent="brand"
              label="Occupancy"
              :value="`${Math.round(data.occupancy.occupancyRate * 100)}%`"
              :sublabel="`${data.occupancy.occupied} of ${data.occupancy.rooms} rooms`"
            />
            <DsStatCard
              icon="door"
              accent="teal"
              label="Vacant"
              :value="data.occupancy.vacant"
              :sublabel="`${data.occupancy.outOfService} out of service`"
            />
            <DsStatCard
              icon="users"
              accent="indigo"
              label="Prospective"
              :value="data.occupancy.prospective"
              sublabel="On the list, not yet housed"
            />
            <DsStatCard
              icon="dollar-sign"
              accent="blue"
              label="Collected this month"
              :value="money(data.money.collectedCents)"
              :sublabel="`of ${money(data.money.chargedCents)} charged`"
            />
          </div>

          <div class="grid gap-5 md:grid-cols-2">
            <Card>
              <CardContent class="flex flex-col gap-3 p-5">
                <span class="eyebrow">Intakes this month</span>
                <p v-if="!data.movement.intakes.length" class="text-base text-muted-foreground">
                  No intakes recorded this month.
                </p>
                <div
                  v-for="row in data.movement.intakes"
                  :key="row._id"
                  class="flex items-baseline justify-between gap-3 text-sm"
                >
                  <NuxtLink
                    :to="`/tenants/${row._id}`"
                    class="font-semibold text-[var(--text-strong)] hover:underline"
                  >
                    {{ row.name }} <span class="mono text-muted-foreground">{{ row.room }}</span>
                  </NuxtLink>
                  <span class="text-muted-foreground">{{ formatDate(row.date) }}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent class="flex flex-col gap-3 p-5">
                <span class="eyebrow">Exits this month</span>
                <p v-if="!data.movement.exits.length" class="text-base text-muted-foreground">
                  No exits recorded this month.
                </p>
                <div v-for="row in data.movement.exits" :key="row._id" class="text-sm">
                  <div class="flex items-baseline justify-between gap-3">
                    <NuxtLink
                      :to="`/tenants/${row._id}`"
                      class="font-semibold text-[var(--text-strong)] hover:underline"
                    >
                      {{ row.name }}
                    </NuxtLink>
                    <span class="text-muted-foreground">{{ formatDate(row.date) }}</span>
                  </div>
                  <p v-if="row.reason" class="text-xs text-muted-foreground">{{ row.reason }}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <!-- --------------------------------------------------- Rent roll -->
        <TabsContent value="roll" class="mt-5 flex flex-col gap-4">
          <div class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
            <DsStatCard
              icon="dollar-sign"
              accent="blue"
              label="Monthly roll"
              :value="money(data.rentRoll.reduce((s, r) => s + r.monthlyRentCents, 0))"
              :sublabel="`${data.rentRoll.length} current tenancies`"
            />
            <DsStatCard
              icon="alert-triangle"
              accent="amber"
              label="Owed"
              :value="money(data.money.owedCents)"
              sublabel="Across all current tenancies"
            />
            <DsStatCard
              icon="lock"
              accent="cyan"
              label="Deposits held"
              :value="money(data.money.depositHeldCents)"
              :sublabel="`${money(data.money.depositShortCents)} still to collect`"
            />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead class="w-[70px]">Room</TableHead>
                <TableHead>Resident</TableHead>
                <TableHead class="w-[110px] text-right">Rent</TableHead>
                <TableHead class="w-[110px] text-right">Balance</TableHead>
                <TableHead class="w-[130px] text-right">Deposit held</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="row in data.rentRoll" :key="row._id">
                <TableCell>
                  <span class="mono font-semibold text-[var(--text-strong)]">{{ row.room }}</span>
                </TableCell>
                <TableCell>{{ row.name }}</TableCell>
                <TableCell class="tnum text-right">{{ money(row.monthlyRentCents) }}</TableCell>
                <TableCell class="tnum text-right">
                  <span :class="row.balanceCents > 0 && 'font-bold text-destructive'">
                    {{ money(row.balanceCents) }}
                  </span>
                </TableCell>
                <TableCell class="tnum text-right">
                  {{ money(row.depositHeldCents) }}
                  <span
                    v-if="row.depositHeldCents < row.depositRequiredCents"
                    class="text-xs text-[var(--warning)]"
                  >
                    /{{ money(row.depositRequiredCents) }}
                  </span>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TabsContent>

        <!-- --------------------------------------------------- Birthdays -->
        <TabsContent value="people" class="mt-5">
          <Card>
            <CardContent class="flex flex-col gap-3 p-5">
              <span class="eyebrow">Birthdays this month</span>
              <p v-if="!data.birthdays.length" class="text-base text-muted-foreground">
                No birthdays among current residents this month.
              </p>
              <div
                v-for="row in data.birthdays"
                :key="row._id"
                class="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-2 last:border-0"
              >
                <NuxtLink
                  :to="`/tenants/${row._id}`"
                  class="flex items-center gap-2.5 font-semibold text-[var(--text-strong)] hover:underline"
                >
                  <DsPersonAvatar :name="row.name" size="sm" />
                  {{ row.name }}
                  <span class="mono text-sm text-muted-foreground">Room {{ row.room }}</span>
                </NuxtLink>
                <span class="text-sm text-muted-foreground">
                  {{ formatDate(row.dob) }} · turning {{ row.turning }}
                </span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </template>
  </div>
</template>

<style>
/* Printing a handover is a real workflow: drop the chrome, keep the content. */
@media print {
  /* The sidebar has no print: variant of its own — everything else in the
     shell marks itself hidden, so only the rail is named here. */
  [data-slot='sidebar'],
  [data-slot='sidebar'] + div > header {
    display: none !important;
  }
  main {
    padding: 0 !important;
    max-width: none !important;
  }
}
</style>
