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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * AddRoomsDialog — add a floor at a time, or a single room.
 *
 * Entering a 20-room floor one form at a time is how buildings end up half
 * entered, so the range is the default and the single room is the exception.
 */
const props = defineProps<{
  open: boolean
  buildingId: Id<'buildings'> | null
  /** Pre-fills the rent, so a floor of identical rooms is two fields. */
  defaultRentCents?: number
}>()

const emit = defineEmits<{ close: [] }>()

const { mutate: createRange, pending: rangePending } = useConvexMutation(api.rooms.createRange)
const { mutate: createRoom, pending: roomPending } = useConvexMutation(api.rooms.create)

const mode = ref('floor')
const floor = ref('Floor 1')
const from = ref('101')
const to = ref('120')
const number = ref('')
const rent = ref('')
const error = ref('')

const pending = computed(() => rangePending.value || roomPending.value)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    mode.value = 'floor'
    floor.value = 'Floor 1'
    from.value = '101'
    to.value = '120'
    number.value = ''
    rent.value = ((props.defaultRentCents ?? 54000) / 100).toFixed(2)
    error.value = ''
  },
  { immediate: true },
)

async function save() {
  if (!props.buildingId) return
  error.value = ''

  const cents = dollarsToCents(rent.value)
  if (cents === null) {
    error.value = 'Enter the monthly rent for these rooms.'
    return
  }
  if (!floor.value.trim()) {
    error.value = 'Give the floor a label.'
    return
  }

  try {
    if (mode.value === 'floor') {
      const first = Number.parseInt(from.value.replace(/[^0-9]/g, ''), 10)
      const last = Number.parseInt(to.value.replace(/[^0-9]/g, ''), 10)
      if (!Number.isInteger(first) || !Number.isInteger(last)) {
        error.value = 'Enter the first and last room number on this floor.'
        return
      }
      const result = await createRange({
        buildingId: props.buildingId,
        floor: floor.value.trim(),
        from: first,
        to: last,
        monthlyRentCents: cents,
      })
      toast.success(`${result.created} rooms added`, {
        description: result.skipped
          ? `${result.skipped} already existed and were left alone.`
          : `${floor.value.trim()} now has rooms ${first}–${last}.`,
      })
    } else {
      if (!number.value.trim()) {
        error.value = 'Enter the room number.'
        return
      }
      await createRoom({
        buildingId: props.buildingId,
        number: number.value.trim(),
        floor: floor.value.trim(),
        monthlyRentCents: cents,
      })
      toast.success(`Room ${number.value.trim()} added`)
    }
    emit('close')
  } catch (e) {
    error.value = (e as Error).message || 'Could not add the rooms.'
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && emit('close')">
    <DialogContent class="gap-0 p-0 sm:max-w-[460px]">
      <DialogHeader
        class="flex-row items-center gap-3 space-y-0 border-b border-[var(--border-subtle)] p-[22px]"
      >
        <span
          class="inline-flex size-[38px] shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700"
        >
          <DsIcon name="door" :size="20" />
        </span>
        <div class="min-w-0 flex-1 text-left">
          <DialogTitle class="text-lg font-semibold text-[var(--text-strong)]">
            Add rooms
          </DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground">
            Rooms carry the rent a tenancy starts from.
          </DialogDescription>
        </div>
      </DialogHeader>

      <div class="flex flex-col gap-4 p-[22px]">
        <Tabs v-model="mode">
          <TabsList class="w-full">
            <TabsTrigger value="floor" class="flex-1">A whole floor</TabsTrigger>
            <TabsTrigger value="single" class="flex-1">One room</TabsTrigger>
          </TabsList>

          <TabsContent value="floor" class="mt-4 flex flex-col gap-4">
            <DsField v-slot="{ id }" label="Floor label" required>
              <Input :id="id" v-model="floor" placeholder="Floor 1" />
            </DsField>
            <div class="grid grid-cols-2 gap-3">
              <DsField v-slot="{ id }" label="First room">
                <Input :id="id" v-model="from" inputmode="numeric" placeholder="101" />
              </DsField>
              <DsField v-slot="{ id }" label="Last room">
                <Input :id="id" v-model="to" inputmode="numeric" placeholder="120" />
              </DsField>
            </div>
          </TabsContent>

          <TabsContent value="single" class="mt-4 flex flex-col gap-4">
            <DsField v-slot="{ id }" label="Floor label" required>
              <Input :id="id" v-model="floor" placeholder="Floor 1" />
            </DsField>
            <DsField v-slot="{ id }" label="Room number" required>
              <Input :id="id" v-model="number" placeholder="121" />
            </DsField>
          </TabsContent>
        </Tabs>

        <DsField v-slot="{ id }" label="Monthly rent" required :error="error">
          <div class="relative">
            <span
              class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground"
            >
              $
            </span>
            <Input
              :id="id"
              v-model="rent"
              inputmode="decimal"
              class="pl-7"
              :aria-invalid="!!error"
            />
          </div>
        </DsField>
      </div>

      <DialogFooter
        class="gap-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-[22px] py-4"
      >
        <Button variant="ghost" :disabled="pending" @click="emit('close')">Cancel</Button>
        <Button variant="primary" :loading="pending" @click="save">
          <DsIcon name="plus" :size="17" />
          {{ pending ? 'Adding…' : 'Add rooms' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
