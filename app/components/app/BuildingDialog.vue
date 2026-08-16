<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

/**
 * BuildingDialog — add a building, or rename/re-address an existing one.
 *
 * Unit count is only asked for on a new building. Once rooms exist it is
 * derived from them, so a typed number here would just drift from the truth.
 */
const props = defineProps<{
  open: boolean
  building: {
    _id: Id<'buildings'>
    name: string
    address?: string
    units: number
    roomCount: number
  } | null
}>()

const emit = defineEmits<{ close: []; saved: [id: Id<'buildings'>] }>()

const createBuilding = useConvexMutation(api.buildings.create)
const updateBuilding = useConvexMutation(api.buildings.update)

const name = ref('')
const address = ref('')
const units = ref('')
const error = ref('')

const isEdit = computed(() => props.building !== null)
const pending = computed(() => createBuilding.pending.value || updateBuilding.pending.value)

watch(
  () => [props.open, props.building] as const,
  ([open, building]) => {
    if (!open) return
    name.value = building?.name ?? ''
    address.value = building?.address ?? ''
    units.value = String(building?.units ?? '')
    error.value = ''
  },
  { immediate: true },
)

async function save() {
  error.value = ''

  const trimmed = name.value.trim()
  if (!trimmed) {
    error.value = 'Give the building a name.'
    return
  }

  const parsedUnits = Number.parseInt(units.value.replace(/[^0-9]/g, ''), 10)
  if (!isEdit.value && (!Number.isInteger(parsedUnits) || parsedUnits < 0)) {
    error.value = 'Enter how many units the building has.'
    return
  }

  try {
    if (props.building) {
      await updateBuilding.mutate({
        buildingId: props.building._id,
        name: trimmed,
        address: address.value.trim() || undefined,
        // Rooms are the source of truth once any exist.
        units: props.building.roomCount || props.building.units,
      })
      toast.success(`${trimmed} updated`)
      emit('saved', props.building._id)
    } else {
      const id = await createBuilding.mutate({
        name: trimmed,
        address: address.value.trim() || undefined,
        units: parsedUnits,
      })
      toast.success(`${trimmed} added`, { description: 'Add its rooms next.' })
      emit('saved', id)
    }
    emit('close')
  } catch (e) {
    error.value = (e as Error).message || 'Could not save the building.'
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && emit('close')">
    <DialogContent class="gap-0 p-0 sm:max-w-[440px]">
      <DialogHeader
        class="flex-row items-center gap-3 space-y-0 border-b border-[var(--border-subtle)] p-[22px]"
      >
        <span
          class="inline-flex size-[38px] shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700"
        >
          <DsIcon name="building-2" :size="20" />
        </span>
        <div class="min-w-0 flex-1 text-left">
          <DialogTitle class="text-lg font-semibold text-[var(--text-strong)]">
            {{ isEdit ? 'Edit building' : 'Add building' }}
          </DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground">
            {{ isEdit ? building?.name : 'A site this organisation operates.' }}
          </DialogDescription>
        </div>
      </DialogHeader>

      <div class="flex flex-col gap-4 p-[22px]">
        <DsField v-slot="{ id }" label="Name" required :error="error">
          <Input :id="id" v-model="name" placeholder="Dodson Rooms" :aria-invalid="!!error" />
        </DsField>

        <DsField v-slot="{ id }" label="Address">
          <Input :id="id" v-model="address" placeholder="25 East Hastings Street" />
        </DsField>

        <DsField
          v-if="!isEdit"
          v-slot="{ id }"
          label="Units"
          required
          hint="A starting figure. Once you add rooms, this follows the room list."
        >
          <Input :id="id" v-model="units" inputmode="numeric" placeholder="48" />
        </DsField>

        <p v-else class="text-xs text-muted-foreground">
          {{ building?.roomCount ?? 0 }} rooms on file — unit count follows the room list.
        </p>
      </div>

      <DialogFooter
        class="gap-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-[22px] py-4"
      >
        <Button variant="ghost" :disabled="pending" @click="emit('close')">Cancel</Button>
        <Button variant="primary" :loading="pending" @click="save">
          <DsIcon name="check" :size="17" />
          {{ pending ? 'Saving…' : isEdit ? 'Save changes' : 'Add building' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
