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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** WorkOrderDialog — raise a request, or assign and re-prioritise an open one. */
const props = defineProps<{
  open: boolean
  buildingId: Id<'buildings'> | null
  rooms: { _id: Id<'rooms'>; number: string; floor: string }[]
  order: {
    _id: Id<'workOrders'>
    title: string
    detail?: string
    priority: string
    status: string
    roomId: Id<'rooms'> | null
    assignedTo?: string
  } | null
}>()

const emit = defineEmits<{ close: [] }>()

const { mutate: createOrder, pending: createPending } = useConvexMutation(api.maintenance.create)
const { mutate: updateOrder, pending: updatePending } = useConvexMutation(api.maintenance.update)

const COMMON = 'common'

const PRIORITIES = [
  { value: 'high', label: 'High — safety, heat, water' },
  { value: 'med', label: 'Medium — affects the room' },
  { value: 'low', label: 'Low — cosmetic' },
] as const

const title = ref('')
const detail = ref('')
const priority = ref<string>('med')
const room = ref<string>(COMMON)
const assignedTo = ref('')
const error = ref('')

const isEdit = computed(() => props.order !== null)
const pending = computed(() => createPending.value || updatePending.value)

watch(
  () => [props.open, props.order] as const,
  ([open, order]) => {
    if (!open) return
    title.value = order?.title ?? ''
    detail.value = order?.detail ?? ''
    priority.value = order?.priority ?? 'med'
    room.value = order?.roomId ?? COMMON
    assignedTo.value = order?.assignedTo ?? ''
    error.value = ''
  },
  { immediate: true },
)

async function save() {
  error.value = ''
  if (!title.value.trim()) {
    error.value = 'Say what needs doing.'
    return
  }

  try {
    if (props.order) {
      await updateOrder({
        workOrderId: props.order._id,
        priority: priority.value as 'high',
        detail: detail.value.trim(),
        assignedTo: assignedTo.value.trim(),
      })
      toast.success('Work order updated')
    } else {
      if (!props.buildingId) return
      await createOrder({
        buildingId: props.buildingId,
        ...(room.value !== COMMON ? { roomId: room.value as Id<'rooms'> } : {}),
        title: title.value.trim(),
        detail: detail.value.trim() || undefined,
        priority: priority.value as 'high',
      })
      toast.success('Work order raised')
    }
    emit('close')
  } catch (e) {
    error.value = (e as Error).message || 'Could not save the work order.'
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
          class="inline-flex size-[38px] shrink-0 items-center justify-center rounded-md bg-[var(--surface-sunken)] text-[var(--slate-700)]"
        >
          <DsIcon name="wrench" :size="20" />
        </span>
        <div class="min-w-0 flex-1 text-left">
          <DialogTitle class="text-lg font-semibold text-[var(--text-strong)]">
            {{ isEdit ? 'Work order' : 'Raise a request' }}
          </DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground">
            {{ isEdit ? 'Assign it, or change its priority.' : 'Anything the building needs fixed.' }}
          </DialogDescription>
        </div>
      </DialogHeader>

      <div class="flex flex-col gap-4 p-[22px]">
        <DsField v-slot="{ id }" label="What needs doing" required :error="error">
          <Input
            :id="id"
            v-model="title"
            placeholder="Radiator not heating"
            :disabled="isEdit"
            :aria-invalid="!!error"
          />
        </DsField>

        <DsField v-if="!isEdit" v-slot="{ id }" label="Where">
          <Select v-model="room">
            <SelectTrigger :id="id" class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="COMMON">Common area</SelectItem>
              <SelectItem v-for="r in rooms" :key="r._id" :value="r._id">
                Room {{ r.number }} · {{ r.floor }}
              </SelectItem>
            </SelectContent>
          </Select>
        </DsField>

        <DsField v-slot="{ id }" label="Priority">
          <Select v-model="priority">
            <SelectTrigger :id="id" class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="p in PRIORITIES" :key="p.value" :value="p.value">
                {{ p.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </DsField>

        <DsField v-slot="{ id }" label="Detail">
          <Input :id="id" v-model="detail" placeholder="Optional" />
        </DsField>

        <DsField
          v-if="isEdit"
          v-slot="{ id }"
          label="Assigned to"
          hint="Naming a trade moves the order to assigned."
        >
          <Input :id="id" v-model="assignedTo" placeholder="Plumber — Kerr & Sons" />
        </DsField>
      </div>

      <DialogFooter
        class="gap-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-[22px] py-4"
      >
        <Button variant="ghost" :disabled="pending" @click="emit('close')">Cancel</Button>
        <Button variant="primary" :loading="pending" @click="save">
          <DsIcon name="check" :size="17" />
          {{ pending ? 'Saving…' : isEdit ? 'Save' : 'Raise request' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
