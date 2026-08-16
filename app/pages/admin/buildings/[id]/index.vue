<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { money, relativeDays } from '~/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/** Admin → Buildings → one building's rooms. */
const { isReady, isAdmin } = useRequireAdmin()
const route = useRoute()
const buildingId = computed(() => route.params.id as Id<'buildings'>)

const { data: building } = useConvexQuery(api.buildings.get, () => ({
  buildingId: buildingId.value,
}))
const { data: rooms, isLoading } = useConvexQuery(api.rooms.list, () => ({
  buildingId: buildingId.value,
}))

usePageHeader(() => ({
  eyebrow: 'Administration',
  title: building.value?.name ?? 'Rooms',
}))

const { mutate: updateRoom } = useConvexMutation(api.rooms.update)
const { mutate: removeRoom, pending: removePending } = useConvexMutation(api.rooms.remove)

const addOpen = ref(false)

const occupiedCount = computed(() => rooms.value?.filter((r) => r.occupant).length ?? 0)
const medianRentCents = computed(() => {
  const values = (rooms.value ?? []).map((r) => r.monthlyRentCents).sort((a, b) => a - b)
  return values.length ? values[Math.floor(values.length / 2)]! : 0
})

async function toggleService(roomId: Id<'rooms'>, outOfService: boolean) {
  try {
    await updateRoom({ roomId, outOfService })
    toast.success(outOfService ? 'Room taken out of service' : 'Room back in service')
  } catch (e) {
    toast.error('Could not change the room', { description: (e as Error).message })
  }
}

async function remove(roomId: Id<'rooms'>, number: string) {
  if (!window.confirm(`Remove room ${number}? This cannot be undone.`)) return
  try {
    await removeRoom({ roomId })
    toast.success(`Room ${number} removed`)
  } catch (e) {
    toast.error('Could not remove the room', { description: (e as Error).message })
  }
}
</script>

<template>
  <div v-if="isReady && isAdmin" class="flex flex-col gap-5">
    <DsSectionHeader
      :eyebrow="building?.address ?? 'Administration'"
      :title="building?.name ?? 'Rooms'"
      description="The rooms staff walk, in the order they walk them. Rent set here is what an intake starts from."
    >
      <template #actions>
        <Button variant="secondary" @click="navigateTo('/admin/buildings')">
          <DsIcon name="arrow-left" :size="17" />
          All buildings
        </Button>
        <Button variant="secondary" @click="navigateTo(`/admin/buildings/${buildingId}/settings`)">
          <DsIcon name="settings" :size="17" />
          Site settings
        </Button>
        <Button variant="primary" @click="addOpen = true">
          <DsIcon name="plus" :size="17" />
          Add rooms
        </Button>
      </template>
    </DsSectionHeader>

    <div class="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
      <DsStatCard
        icon="door"
        accent="teal"
        label="Rooms"
        :value="rooms?.length ?? 0"
        sublabel="On file for this building"
      />
      <DsStatCard
        icon="users"
        accent="brand"
        label="Occupied"
        :value="occupiedCount"
        :sublabel="`${(rooms?.length ?? 0) - occupiedCount} available`"
      />
      <DsStatCard
        icon="dollar-sign"
        accent="blue"
        label="Median rent"
        :value="money(medianRentCents)"
        sublabel="Across the room list"
      />
    </div>

    <TsLoadingState v-if="isLoading" label="Loading rooms…" :rows="8" />

    <DsEmptyState
      v-else-if="!rooms?.length"
      icon="door"
      title="No rooms yet"
      description="Add a floor at a time — first and last room number, and the rent they share."
    >
      <template #action>
        <Button variant="primary" @click="addOpen = true">
          <DsIcon name="plus" :size="17" />
          Add rooms
        </Button>
      </template>
    </DsEmptyState>

    <Table v-else>
      <TableHeader>
        <TableRow>
          <TableHead class="w-[80px]">Room</TableHead>
          <TableHead class="w-[110px]">Floor</TableHead>
          <TableHead>Occupant</TableHead>
          <TableHead class="w-[120px] text-right">Rent</TableHead>
          <TableHead class="w-[130px]">Last check</TableHead>
          <TableHead class="w-[150px]">In service</TableHead>
          <TableHead class="w-[60px]" />
        </TableRow>
      </TableHeader>

      <TableBody>
        <TableRow v-for="room in rooms" :key="room._id">
          <TableCell>
            <span class="mono font-semibold text-[var(--text-strong)]">{{ room.number }}</span>
          </TableCell>
          <TableCell class="text-muted-foreground">{{ room.floor }}</TableCell>
          <TableCell>
            <NuxtLink
              v-if="room.occupant"
              :to="`/tenants/${room.occupant._id}`"
              class="flex items-center gap-2.5 font-semibold text-[var(--text-strong)] hover:underline"
            >
              <DsPersonAvatar :name="room.occupant.name" size="sm" />
              {{ room.occupant.name }}
            </NuxtLink>
            <Badge v-else-if="room.outOfService" variant="warning">Out of service</Badge>
            <span v-else class="text-sm text-[var(--text-subtle)]">Vacant</span>
          </TableCell>
          <TableCell class="tnum text-right">{{ money(room.monthlyRentCents) }}</TableCell>
          <TableCell class="text-muted-foreground">{{ relativeDays(room.lastCheckedAt) }}</TableCell>
          <TableCell>
            <Switch
              :model-value="!room.outOfService"
              :aria-label="`Room ${room.number} in service`"
              @update:model-value="(value) => toggleService(room._id, !value)"
            />
          </TableCell>
          <TableCell class="text-right">
            <Button
              variant="secondary"
              size="icon-sm"
              aria-label="Remove room"
              title="Remove room"
              :disabled="removePending"
              @click="remove(room._id, room.number)"
            >
              <DsIcon name="trash" :size="16" />
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <TsAddRoomsDialog
      :open="addOpen"
      :building-id="buildingId"
      :default-rent-cents="medianRentCents || undefined"
      @close="addOpen = false"
    />
  </div>

  <TsLoadingState v-else label="Checking access…" :rows="3" />
</template>
