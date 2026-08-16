<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/** Admin → Buildings. The portfolio, and the way new sites get into the app. */
const { isReady, isAdmin } = useRequireAdmin()
usePageHeader({ eyebrow: 'Administration', title: 'Buildings' })

const { data: buildings, isLoading } = useConvexQuery(api.buildings.listForAdmin)
const { mutate: removeBuilding, pending: removePending } = useConvexMutation(
  api.buildings.remove,
)

type AdminBuilding = NonNullable<typeof buildings.value>[number]

const editing = ref<AdminBuilding | null>(null)
const dialogOpen = ref(false)

function addBuilding() {
  editing.value = null
  dialogOpen.value = true
}

function edit(building: AdminBuilding) {
  editing.value = building
  dialogOpen.value = true
}

async function remove(building: AdminBuilding) {
  if (
    !window.confirm(
      `Remove ${building.name}? Its ${building.roomCount} rooms go with it. This cannot be undone.`,
    )
  ) {
    return
  }
  try {
    await removeBuilding({ buildingId: building._id })
    toast.success(`${building.name} removed`)
  } catch (e) {
    toast.error('Could not remove the building', {
      description: (e as Error).message,
    })
  }
}

function openRooms(id: Id<'buildings'>) {
  navigateTo(`/admin/buildings/${id}`)
}
</script>

<template>
  <div v-if="isReady && isAdmin" class="flex flex-col gap-5">
    <DsSectionHeader
      eyebrow="Administration"
      title="Buildings"
      description="Every site this organisation operates. Rooms, and the unit counts the dashboards divide by, live inside each one."
    >
      <template #actions>
        <Button variant="primary" @click="addBuilding">
          <DsIcon name="plus" :size="17" />
          Add building
        </Button>
      </template>
    </DsSectionHeader>

    <TsLoadingState v-if="isLoading" label="Loading buildings…" :rows="4" />

    <DsEmptyState
      v-else-if="!buildings?.length"
      icon="building-2"
      title="No buildings yet"
      description="Add the first building, then give it rooms. Everything else in TS Database hangs off a building."
    >
      <template #action>
        <Button variant="primary" @click="addBuilding">
          <DsIcon name="plus" :size="17" />
          Add building
        </Button>
      </template>
    </DsEmptyState>

    <Table v-else>
      <TableHeader>
        <TableRow>
          <TableHead>Building</TableHead>
          <TableHead>Address</TableHead>
          <TableHead class="w-[90px] text-right">Rooms</TableHead>
          <TableHead class="w-[110px] text-right">Occupied</TableHead>
          <TableHead class="w-[130px]">Out of service</TableHead>
          <TableHead class="w-[150px]" />
        </TableRow>
      </TableHeader>

      <TableBody>
        <TableRow
          v-for="b in buildings"
          :key="b._id"
          class="cursor-pointer hover:bg-[var(--surface-hover)]"
          @click="openRooms(b._id)"
        >
          <TableCell>
            <span class="font-semibold text-[var(--text-strong)]">{{ b.name }}</span>
          </TableCell>
          <TableCell class="text-muted-foreground">{{ b.address ?? '—' }}</TableCell>
          <TableCell class="tnum text-right">{{ b.roomCount }}</TableCell>
          <TableCell class="tnum text-right">
            {{ b.currentTenants }}<span class="text-[var(--text-subtle)]">/{{ b.units }}</span>
          </TableCell>
          <TableCell>
            <Badge v-if="b.outOfService" variant="warning" dot>{{ b.outOfService }}</Badge>
            <span v-else class="text-sm text-[var(--text-subtle)]">None</span>
          </TableCell>
          <TableCell class="text-right">
            <div class="flex justify-end gap-1.5" @click.stop>
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label="Manage rooms"
                title="Manage rooms"
                @click="openRooms(b._id)"
              >
                <DsIcon name="door" :size="16" />
              </Button>
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label="Edit building"
                title="Edit building"
                @click="edit(b)"
              >
                <DsIcon name="pencil" :size="16" />
              </Button>
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label="Remove building"
                title="Remove building"
                :disabled="removePending"
                @click="remove(b)"
              >
                <DsIcon name="trash" :size="16" />
              </Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <TsBuildingDialog
      :open="dialogOpen"
      :building="editing"
      @close="dialogOpen = false"
      @saved="(id) => !editing && openRooms(id)"
    />
  </div>

  <TsLoadingState v-else label="Checking access…" :rows="3" />
</template>
