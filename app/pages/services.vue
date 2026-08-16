<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { formatMinutes, formatShortDate } from '~/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * Services — the things a building hands out, books and keeps an eye on.
 *
 * Meals, the laundry room, harm-reduction supplies, the bike room and the
 * pets. Each is a checklist a worker runs during a shift, so they share a
 * screen and a date rather than being scattered across five.
 */
const { selected } = useSelectedBuilding()
const { can, denied } = useMe()

const tz = new Date().getTimezoneOffset()
const now = ref(Date.now())
const timer = setInterval(() => (now.value = Date.now()), 60_000)
onScopeDispose(() => clearInterval(timer))

/** Today, in the building's local time, as the date every tab opens on. */
function localToday() {
  const local = new Date(Date.now() - tz * 60_000)
  return local.toISOString().slice(0, 10)
}
const date = ref(localToday())
const isToday = computed(() => date.value === localToday())

const tab = ref('meals')
const buildingArg = computed(() => (selected.value ? { buildingId: selected.value } : {}))

const { data: mealsData } = useConvexQuery(api.services.meals, () => ({
  ...buildingArg.value,
  date: date.value,
}))
const { data: laundryData } = useConvexQuery(api.services.laundry, () => ({
  ...buildingArg.value,
  date: date.value,
}))
const { data: suppliesData } = useConvexQuery(api.services.supplies, () => ({
  ...buildingArg.value,
  date: date.value,
}))
const { data: wheeledData } = useConvexQuery(api.services.wheeled, () => buildingArg.value)
const { data: petsData } = useConvexQuery(api.services.petRoster, () => ({
  ...buildingArg.value,
  now: now.value,
}))

usePageHeader(() => ({
  eyebrow: mealsData.value?.building.name ?? '',
  title: 'Services',
}))

const buildingId = computed(
  () => selected.value ?? mealsData.value?.building._id ?? null,
)

const { mutate: setMealServed } = useConvexMutation(api.services.setMealServed)
const { mutate: bookLaundry, pending: booking } = useConvexMutation(api.services.bookLaundry)
const { mutate: cancelLaundry } = useConvexMutation(api.services.cancelLaundry)
const { mutate: issueSupply } = useConvexMutation(api.services.issueSupply)
const { mutate: signInWheeled, pending: signingIn } = useConvexMutation(api.services.signInWheeled)
const { mutate: signOutWheeled } = useConvexMutation(api.services.signOutWheeled)
const { mutate: addPet, pending: addingPet } = useConvexMutation(api.services.addPet)
const { mutate: logPetSighting } = useConvexMutation(api.services.logPetSighting)
const { mutate: retirePet } = useConvexMutation(api.services.retirePet)

const MEAL_LABEL: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
}

const WHEELED_LABEL: Record<string, string> = {
  bike: 'Bike',
  'e-bike': 'E-bike',
  scooter: 'Scooter',
  'e-scooter': 'E-scooter',
  other: 'Other',
}

function shiftDate(days: number) {
  const d = new Date(`${date.value}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  date.value = d.toISOString().slice(0, 10)
}

/* ---------------------------------------------------------------- Meals -- */
const mealFilter = ref('')
const activeMeal = ref<string | null>(null)

const mealResidents = computed(() => {
  const all = mealsData.value?.residents ?? []
  const q = mealFilter.value.trim().toLowerCase()
  if (!q) return all
  return all.filter((r) => r.name.toLowerCase().includes(q) || r.room.toLowerCase().includes(q))
})

const currentSitting = computed(() => {
  const sittings = mealsData.value?.sittings ?? []
  return sittings.find((s) => s.meal === activeMeal.value) ?? sittings[0] ?? null
})

watchEffect(() => {
  const sittings = mealsData.value?.sittings ?? []
  if (sittings.length && !sittings.some((s) => s.meal === activeMeal.value)) {
    activeMeal.value = sittings[0]!.meal
  }
})

async function toggleMeal(tenantId: Id<'tenants'>, served: boolean) {
  const sitting = currentSitting.value
  if (!buildingId.value || !sitting) return
  try {
    await setMealServed({
      buildingId: buildingId.value,
      tenantId,
      date: date.value,
      meal: sitting.meal,
      served,
      now: Date.now(),
    })
  } catch (e) {
    toast.error('Could not update the checklist', { description: (e as Error).message })
  }
}

/* -------------------------------------------------------------- Laundry -- */
const laundryTenant = ref<string>('')
const laundrySlot = ref<number | null>(null)

async function book(startMinutes: number) {
  if (!buildingId.value || !laundryTenant.value) {
    toast.error('Pick a resident first')
    return
  }
  try {
    await bookLaundry({
      buildingId: buildingId.value,
      tenantId: laundryTenant.value as Id<'tenants'>,
      date: date.value,
      startMinutes,
      now: Date.now(),
    })
    toast.success('Laundry slot booked')
    laundryTenant.value = ''
    laundrySlot.value = null
  } catch (e) {
    toast.error('Could not book the slot', { description: (e as Error).message })
  }
}

async function cancel(bookingId: Id<'laundryBookings'>) {
  try {
    await cancelLaundry({ bookingId })
    toast.success('Slot freed')
  } catch (e) {
    toast.error('Could not cancel', { description: (e as Error).message })
  }
}

/* ------------------------------------------------------------- Supplies -- */
const supplyFilter = ref('')
const supplyItem = ref('bubble-pipe')

const supplyResidents = computed(() => {
  const all = suppliesData.value?.residents ?? []
  const q = supplyFilter.value.trim().toLowerCase()
  if (!q) return all
  return all.filter((r) => r.name.toLowerCase().includes(q) || r.room.toLowerCase().includes(q))
})

const activeLimit = computed(
  () => suppliesData.value?.items.find((i) => i.item === supplyItem.value)?.limit ?? 0,
)

async function issue(tenantId: Id<'tenants'>) {
  if (!buildingId.value) return
  try {
    await issueSupply({
      buildingId: buildingId.value,
      tenantId,
      item: supplyItem.value as 'bubble-pipe',
      date: date.value,
      now: Date.now(),
    })
    toast.success('Issued')
  } catch (e) {
    toast.error('Not issued', { description: (e as Error).message })
  }
}

/* ------------------------------------------------------------ Bike room -- */
const bikeTenant = ref<string>('')
const bikeKind = ref('bike')
const bikeDescription = ref('')

// Somebody's machine is usually the same machine — pre-fill from last time.
watch(bikeTenant, (tenantId) => {
  const known = wheeledData.value?.known?.[tenantId]
  if (known) {
    bikeKind.value = known.kind
    bikeDescription.value = known.description
  }
})

async function signIn() {
  if (!buildingId.value || !bikeTenant.value) {
    toast.error('Pick a resident first')
    return
  }
  try {
    await signInWheeled({
      buildingId: buildingId.value,
      tenantId: bikeTenant.value as Id<'tenants'>,
      kind: bikeKind.value as 'bike',
      description: bikeDescription.value,
      now: Date.now(),
    })
    toast.success('Signed in to the bike room')
    bikeTenant.value = ''
    bikeDescription.value = ''
  } catch (e) {
    toast.error('Could not sign it in', { description: (e as Error).message })
  }
}

async function signOut(movementId: Id<'wheeledMovements'>) {
  try {
    await signOutWheeled({ movementId, now: Date.now() })
    toast.success('Signed out')
  } catch (e) {
    toast.error('Could not sign it out', { description: (e as Error).message })
  }
}

/* ----------------------------------------------------------------- Pets -- */
const petFormOpen = ref(false)
const petName = ref('')
const petKind = ref('')
const petOwner = ref<string>('')
const petDescription = ref('')

async function createPet() {
  if (!buildingId.value) return
  try {
    await addPet({
      buildingId: buildingId.value,
      ...(petOwner.value ? { tenantId: petOwner.value as Id<'tenants'> } : {}),
      name: petName.value,
      kind: petKind.value,
      description: petDescription.value || undefined,
    })
    toast.success(`${petName.value.trim()} added to the roster`)
    petName.value = ''
    petKind.value = ''
    petOwner.value = ''
    petDescription.value = ''
    petFormOpen.value = false
  } catch (e) {
    toast.error('Could not add the animal', { description: (e as Error).message })
  }
}

async function seePet(petId: Id<'pets'>, name: string) {
  try {
    await logPetSighting({ petId, now: Date.now() })
    toast.success(`${name} seen`)
  } catch (e) {
    toast.error('Could not log the sighting', { description: (e as Error).message })
  }
}

async function removePet(petId: Id<'pets'>, name: string) {
  if (!window.confirm(`Take ${name} off the roster? Sightings stay on the record.`)) return
  try {
    await retirePet({ petId, now: Date.now() })
    toast.success(`${name} taken off the roster`)
  } catch (e) {
    toast.error('Could not update the roster', { description: (e as Error).message })
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <DsSectionHeader
      :eyebrow="mealsData?.building.name"
      title="Services"
      description="Meals, the laundry room, harm-reduction supplies, the bike room and the pets — what the building hands out and keeps an eye on."
    >
      <template #actions>
        <div class="flex items-center gap-1">
          <Button variant="secondary" size="icon-sm" aria-label="Previous day" @click="shiftDate(-1)">
            <DsIcon name="chevron-left" :size="16" />
          </Button>
          <Input v-model="date" type="date" class="w-[150px]" />
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label="Next day"
            :disabled="isToday"
            @click="shiftDate(1)"
          >
            <DsIcon name="chevron-right" :size="16" />
          </Button>
        </div>
        <Button v-if="!isToday" variant="ghost" size="sm" @click="date = localToday()">
          Back to today
        </Button>
      </template>
    </DsSectionHeader>

    <Tabs v-model="tab">
      <TabsList>
        <TabsTrigger value="meals">
          <DsIcon name="notes" :size="15" />
          Meals
        </TabsTrigger>
        <TabsTrigger value="laundry">
          <DsIcon name="refresh" :size="15" />
          Laundry
        </TabsTrigger>
        <TabsTrigger value="supplies">
          <DsIcon name="shield-check" :size="15" />
          Supplies
        </TabsTrigger>
        <TabsTrigger value="bikes">
          <DsIcon name="route" :size="15" />
          Bike room
          <span
            v-if="wheeledData?.inside.length"
            class="tnum rounded-full bg-[var(--slate-200)] px-1.5 text-xs font-bold text-[var(--text-body)]"
          >{{ wheeledData.inside.length }}</span>
        </TabsTrigger>
        <TabsTrigger value="pets">
          <DsIcon name="heart" :size="15" />
          Pets
        </TabsTrigger>
      </TabsList>

      <!-- ================================================================ Meals -->
      <TabsContent value="meals" class="mt-5 flex flex-col gap-5">
        <TsLoadingState v-if="!mealsData" label="Loading the food checklist…" :rows="4" />

        <template v-else>
          <div class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
            <button
              v-for="sitting in mealsData.sittings"
              :key="sitting.meal"
              type="button"
              class="cursor-pointer rounded-lg border p-4 text-left transition-colors"
              :class="
                currentSitting?.meal === sitting.meal
                  ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                  : 'border-border bg-card hover:bg-[var(--surface-hover)]'
              "
              @click="activeMeal = sitting.meal"
            >
              <div class="flex items-baseline justify-between gap-2">
                <span class="font-semibold text-[var(--text-strong)]">
                  {{ MEAL_LABEL[sitting.meal] }}
                </span>
                <span class="text-xs text-muted-foreground">
                  {{ formatMinutes(sitting.fromMinutes) }} – {{ formatMinutes(sitting.toMinutes) }}
                </span>
              </div>
              <div class="mt-1 flex items-baseline gap-1.5">
                <span class="tnum text-2xl font-extrabold text-[var(--text-strong)]">
                  {{ sitting.servedCount }}
                </span>
                <span class="tnum text-sm font-semibold text-[var(--text-subtle)]">
                  / {{ mealsData.total }} served
                </span>
              </div>
              <p v-if="sitting.menu" class="mt-1 truncate text-sm text-muted-foreground">
                {{ sitting.menu }}
              </p>
              <p v-else class="mt-1 text-sm text-[var(--text-subtle)]">No menu set</p>
            </button>
          </div>

          <Card v-if="currentSitting">
            <CardContent class="flex flex-col gap-3 p-5">
              <div class="flex flex-wrap items-center gap-3">
                <span class="eyebrow">
                  {{ MEAL_LABEL[currentSitting.meal] }} · {{ formatShortDate(date) }}
                </span>
                <div class="flex-1" />
                <DsSearchField v-model="mealFilter" placeholder="Filter by name or room…" :width="220" />
              </div>

              <div
                v-for="resident in mealResidents"
                :key="resident.tenantId"
                class="flex items-center gap-3 border-b border-[var(--border-subtle)] py-2 last:border-0"
              >
                <button
                  type="button"
                  class="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm border transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  :class="
                    currentSitting.servedIds.includes(resident.tenantId)
                      ? 'border-[var(--green-500)] bg-[var(--green-500)]'
                      : 'border-[var(--border-strong)] bg-card'
                  "
                  :aria-label="`${resident.name} served`"
                  :disabled="!can('wellness')"
                  :title="denied('wellness') ?? undefined"
                  @click="toggleMeal(resident.tenantId, !currentSitting.servedIds.includes(resident.tenantId))"
                >
                  <DsIcon
                    v-if="currentSitting.servedIds.includes(resident.tenantId)"
                    name="check"
                    :size="15"
                    :stroke-width="2.6"
                    class="text-white"
                  />
                </button>

                <TsResidentAvatar
                  :name="resident.name"
                  :tenant-id="resident.tenantId"
                  :photo-url="resident.photoUrl"
                  :room="resident.room"
                  :support-level="resident.supportLevel"
                  size="sm"
                />
                <span class="mono w-10 text-sm font-semibold text-[var(--text-strong)]">
                  {{ resident.room }}
                </span>
                <span class="min-w-0 flex-1 truncate text-sm text-[var(--text-strong)]">
                  {{ resident.name }}
                </span>
              </div>

              <p v-if="!mealResidents.length" class="py-6 text-center text-muted-foreground">
                No resident matches that filter.
              </p>
            </CardContent>
          </Card>
        </template>
      </TabsContent>

      <!-- ============================================================== Laundry -->
      <TabsContent value="laundry" class="mt-5 flex flex-col gap-5">
        <TsLoadingState v-if="!laundryData" label="Loading the laundry book…" :rows="4" />

        <template v-else>
          <Card>
            <CardContent class="flex flex-wrap items-end gap-3 p-5">
              <DsField v-slot="{ id }" label="Book for" class="min-w-[240px] flex-1">
                <Select v-model="laundryTenant">
                  <SelectTrigger :id="id" class="w-full">
                    <SelectValue placeholder="Choose a resident" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="r in laundryData.residents"
                      :key="r.tenantId"
                      :value="r.tenantId"
                    >
                      {{ r.room }} — {{ r.name }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </DsField>
              <p class="pb-2 text-sm text-muted-foreground">
                {{ formatMinutes(laundryData.laundry.fromMinutes) }} –
                {{ formatMinutes(laundryData.laundry.toMinutes) }} ·
                {{ laundryData.laundry.slotMinutes / 60 }}-hour slots ·
                {{
                  laundryData.laundry.maxPerResidentPerWeek
                    ? `${laundryData.laundry.maxPerResidentPerWeek} a week each`
                    : 'no weekly cap'
                }}
              </p>
            </CardContent>
          </Card>

          <div class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
            <Card
              v-for="slot in laundryData.slots"
              :key="slot.startMinutes"
              :class="slot.booking && 'border-[var(--brand)]'"
            >
              <CardContent class="flex flex-col gap-3 p-4">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-semibold text-[var(--text-strong)]">
                    {{ formatMinutes(slot.startMinutes) }} – {{ formatMinutes(slot.endMinutes) }}
                  </span>
                  <Badge :variant="slot.booking ? 'brand' : 'neutral'" dot>
                    {{ slot.booking ? 'Booked' : 'Free' }}
                  </Badge>
                </div>

                <div v-if="slot.booking" class="flex items-center gap-2.5">
                  <TsResidentAvatar
                    :name="slot.booking.name"
                    :tenant-id="slot.booking.tenantId"
                    :photo-url="slot.booking.photoUrl"
                    :room="slot.booking.room"
                    size="sm"
                  />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-semibold text-[var(--text-strong)]">
                      {{ slot.booking.name }}
                    </span>
                    <span class="mono block text-xs text-muted-foreground">
                      Room {{ slot.booking.room }}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Free the slot"
                    :disabled="!can('wellness')"
                    @click="cancel(slot.booking._id)"
                  >
                    <DsIcon name="x" :size="16" />
                  </Button>
                </div>

                <Button
                  v-else
                  variant="soft"
                  size="sm"
                  :loading="booking"
                  :disabled="!can('wellness')"
                  :title="denied('wellness') ?? undefined"
                  @click="book(slot.startMinutes)"
                >
                  <DsIcon name="plus" :size="15" />
                  Book this slot
                </Button>
              </CardContent>
            </Card>
          </div>

          <p v-if="!laundryData.slots.length" class="text-muted-foreground">
            No slots — the laundry hours for this site have not been set.
          </p>
        </template>
      </TabsContent>

      <!-- ============================================================= Supplies -->
      <TabsContent value="supplies" class="mt-5 flex flex-col gap-5">
        <TsLoadingState v-if="!suppliesData" label="Loading supplies…" :rows="4" />

        <template v-else>
          <div class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
            <button
              v-for="item in suppliesData.items"
              :key="item.item"
              type="button"
              class="cursor-pointer rounded-lg border p-4 text-left transition-colors"
              :class="
                supplyItem === item.item
                  ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                  : 'border-border bg-card hover:bg-[var(--surface-hover)]'
              "
              @click="supplyItem = item.item"
            >
              <span class="block text-sm font-semibold text-[var(--text-strong)]">
                {{ item.label }}
              </span>
              <span class="tnum block text-lg font-bold text-[var(--text-strong)]">
                {{ item.issuedToday }}
              </span>
              <span class="block text-xs text-muted-foreground">
                issued today · {{ item.limit ? `${item.limit} each` : 'no cap' }}
              </span>
            </button>
          </div>

          <div class="grid gap-5 lg:grid-cols-[1.4fr_1fr] items-start">
            <Card>
              <CardContent class="flex flex-col gap-3 p-5">
                <div class="flex flex-wrap items-center gap-3">
                  <span class="eyebrow">
                    {{ suppliesData.items.find((i) => i.item === supplyItem)?.label }} ·
                    {{ activeLimit ? `${activeLimit} per resident per day` : 'no daily cap' }}
                  </span>
                  <div class="flex-1" />
                  <DsSearchField v-model="supplyFilter" placeholder="Filter…" :width="200" />
                </div>

                <div
                  v-for="resident in supplyResidents"
                  :key="resident.tenantId"
                  class="flex items-center gap-3 border-b border-[var(--border-subtle)] py-2 last:border-0"
                >
                  <TsResidentAvatar
                    :name="resident.name"
                    :tenant-id="resident.tenantId"
                    :photo-url="resident.photoUrl"
                    :room="resident.room"
                    :support-level="resident.supportLevel"
                    size="sm"
                  />
                  <span class="mono w-10 text-sm font-semibold text-[var(--text-strong)]">
                    {{ resident.room }}
                  </span>
                  <span class="min-w-0 flex-1 truncate text-sm text-[var(--text-strong)]">
                    {{ resident.name }}
                  </span>
                  <Badge v-if="resident.taken[supplyItem]" variant="neutral">
                    {{ resident.taken[supplyItem] }} today
                  </Badge>
                  <Button
                    size="sm"
                    variant="soft"
                    :disabled="
                      !can('wellness') || (!!activeLimit && resident.taken[supplyItem]! >= activeLimit)
                    "
                    :title="
                      denied('wellness')
                        ?? (activeLimit && resident.taken[supplyItem]! >= activeLimit
                          ? 'At the site limit for today'
                          : 'Issue one')
                    "
                    @click="issue(resident.tenantId)"
                  >
                    <DsIcon name="plus" :size="15" />
                    Issue
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card class="h-fit">
              <CardContent class="flex flex-col gap-3 p-5">
                <span class="eyebrow">Issued today</span>
                <p v-if="!suppliesData.log.length" class="text-base text-muted-foreground">
                  Nothing handed out yet today.
                </p>
                <div
                  v-for="row in suppliesData.log"
                  :key="row._id"
                  class="flex items-baseline justify-between gap-3 border-b border-[var(--border-subtle)] py-1.5 text-sm last:border-0"
                >
                  <span class="min-w-0">
                    <span class="block truncate font-semibold text-[var(--text-strong)]">
                      {{ row.label }} · {{ row.name }}
                    </span>
                    <span class="block text-xs text-muted-foreground">
                      Room {{ row.room }}<template v-if="row.by"> · {{ row.by }}</template>
                    </span>
                  </span>
                  <span class="shrink-0 text-xs text-muted-foreground">
                    {{ new Date(row.issuedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </template>
      </TabsContent>

      <!-- ============================================================ Bike room -->
      <TabsContent value="bikes" class="mt-5 flex flex-col gap-5">
        <TsLoadingState v-if="!wheeledData" label="Loading the bike room…" :rows="4" />

        <template v-else>
          <Card>
            <CardContent class="flex flex-wrap items-end gap-3 p-5">
              <DsField v-slot="{ id }" label="Resident" class="min-w-[200px] flex-1">
                <Select v-model="bikeTenant">
                  <SelectTrigger :id="id" class="w-full">
                    <SelectValue placeholder="Choose a resident" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="r in wheeledData.residents" :key="r.tenantId" :value="r.tenantId">
                      {{ r.room }} — {{ r.name }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </DsField>

              <DsField v-slot="{ id }" label="Type" class="w-[150px]">
                <Select v-model="bikeKind">
                  <SelectTrigger :id="id" class="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="(label, value) in WHEELED_LABEL" :key="value" :value="value">
                      {{ label }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </DsField>

              <DsField
                v-slot="{ id }"
                label="Brand or description"
                class="min-w-[220px] flex-1"
                hint="Enough to tell two apart."
              >
                <Input :id="id" v-model="bikeDescription" placeholder="Blue Norco, rear rack" />
              </DsField>

              <Button
                variant="primary"
                class="mb-[2px]"
                :loading="signingIn"
                :disabled="!can('wellness')"
                :title="denied('wellness') ?? undefined"
                @click="signIn"
              >
                <DsIcon name="check" :size="17" />
                Sign in
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent class="flex flex-col gap-3 p-5">
              <div class="flex items-center gap-3">
                <span class="eyebrow">In the building now</span>
                <Badge variant="brand">{{ wheeledData.inside.length }}</Badge>
              </div>

              <p v-if="!wheeledData.inside.length" class="text-base text-muted-foreground">
                The bike room is empty.
              </p>

              <div
                v-for="row in wheeledData.inside"
                :key="row._id"
                class="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] py-2.5 last:border-0"
              >
                <TsResidentAvatar
                  :name="row.name"
                  :tenant-id="row.tenantId"
                  :photo-url="row.photoUrl"
                  :room="row.room"
                  size="sm"
                />
                <span class="mono w-10 text-sm font-semibold text-[var(--text-strong)]">
                  {{ row.room }}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold text-[var(--text-strong)]">
                    {{ row.name }}
                  </span>
                  <span class="block truncate text-xs text-muted-foreground">
                    {{ WHEELED_LABEL[row.kind] }} · {{ row.description }}
                  </span>
                </span>
                <span class="text-xs text-muted-foreground">
                  In {{ formatShortDate(row.signedInAt) }}
                  {{ new Date(row.signedInAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  :disabled="!can('wellness')"
                  @click="signOut(row._id)"
                >
                  <DsIcon name="arrow-right" :size="15" />
                  Sign out
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card v-if="wheeledData.history.length">
            <CardContent class="flex flex-col gap-2 p-5">
              <span class="eyebrow">Recently out</span>
              <div
                v-for="row in wheeledData.history.slice(0, 10)"
                :key="row._id"
                class="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border-subtle)] py-1.5 text-sm last:border-0"
              >
                <span class="text-[var(--text-strong)]">
                  <span class="mono">{{ row.room }}</span> · {{ row.name }} ·
                  <span class="text-muted-foreground">{{ WHEELED_LABEL[row.kind] }}</span>
                </span>
                <span class="text-xs text-muted-foreground">
                  Out {{ formatShortDate(row.signedOutAt) }}
                </span>
              </div>
            </CardContent>
          </Card>
        </template>
      </TabsContent>

      <!-- ================================================================= Pets -->
      <TabsContent value="pets" class="mt-5 flex flex-col gap-5">
        <TsLoadingState v-if="!petsData" label="Loading the pet roster…" :rows="3" />

        <template v-else>
          <div class="flex justify-end">
            <Button
              variant="primary"
              :disabled="!can('wellness')"
              :title="denied('wellness') ?? undefined"
              @click="petFormOpen = !petFormOpen"
            >
              <DsIcon name="plus" :size="17" />
              Add an animal
            </Button>
          </div>

          <Card v-if="petFormOpen">
            <CardContent class="flex flex-wrap items-end gap-3 p-5">
              <DsField v-slot="{ id }" label="Name" class="w-[160px]">
                <Input :id="id" v-model="petName" placeholder="Biscuit" />
              </DsField>
              <DsField v-slot="{ id }" label="Kind" class="w-[160px]">
                <Input :id="id" v-model="petKind" placeholder="Cat" />
              </DsField>
              <DsField v-slot="{ id }" label="Owner" class="min-w-[200px] flex-1">
                <Select v-model="petOwner">
                  <SelectTrigger :id="id" class="w-full">
                    <SelectValue placeholder="No owner on file" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="r in petsData.residents" :key="r.tenantId" :value="r.tenantId">
                      {{ r.room }} — {{ r.name }}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </DsField>
              <DsField v-slot="{ id }" label="Description" class="min-w-[200px] flex-1">
                <Input :id="id" v-model="petDescription" placeholder="Tabby, wary of strangers" />
              </DsField>
              <Button variant="primary" class="mb-[2px]" :loading="addingPet" @click="createPet">
                <DsIcon name="check" :size="17" />
                Add
              </Button>
            </CardContent>
          </Card>

          <DsEmptyState
            v-if="!petsData.pets.length"
            icon="heart"
            accent="var(--teal-600)"
            title="No animals on the roster"
            description="Add the pets living in the building so staff can confirm they have been seen and are well."
          />

          <div v-else class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
            <Card v-for="pet in petsData.pets" :key="pet._id" :class="pet.overdue && 'border-[var(--amber-500)]'">
              <CardContent class="flex flex-col gap-3 p-5">
                <div class="flex items-start gap-3">
                  <span
                    class="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-[var(--teal-50)] text-[var(--teal-700)]"
                  >
                    <DsIcon name="heart" :size="20" />
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="font-semibold text-[var(--text-strong)]">{{ pet.name }}</div>
                    <div class="text-xs text-muted-foreground">
                      {{ pet.kind }}<template v-if="pet.owner"> · {{ pet.owner }}, room {{ pet.room }}</template>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Take off the roster"
                    :disabled="!can('wellness')"
                    @click="removePet(pet._id, pet.name)"
                  >
                    <DsIcon name="trash" :size="15" />
                  </Button>
                </div>

                <p v-if="pet.description" class="text-sm text-muted-foreground">
                  {{ pet.description }}
                </p>

                <div class="flex flex-wrap items-center gap-2">
                  <Badge v-if="pet.lastSeenAt === null" variant="warning" dot>Never seen</Badge>
                  <Badge v-else-if="pet.overdue" variant="warning" dot>
                    {{ pet.daysSince }}d since seen
                  </Badge>
                  <Badge v-else variant="success" dot>
                    Seen {{ pet.daysSince === 0 ? 'today' : `${pet.daysSince}d ago` }}
                  </Badge>
                  <div class="flex-1" />
                  <Button
                    size="sm"
                    :variant="pet.overdue ? 'primary' : 'secondary'"
                    :disabled="!can('wellness')"
                    :title="denied('wellness') ?? undefined"
                    @click="seePet(pet._id, pet.name)"
                  >
                    <DsIcon name="check" :size="15" />
                    Seen now
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </template>
      </TabsContent>
    </Tabs>
  </div>
</template>
