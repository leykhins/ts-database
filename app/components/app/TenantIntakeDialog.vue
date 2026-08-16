<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { money } from '~/utils/format'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogScrollContent,
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

/**
 * TenantIntakeDialog — start a tenancy.
 *
 * Picking a room fills in the rent and the deposit from what that room costs,
 * because that is the figure the tenancy actually starts at; both stay editable
 * for the subsidised cases.
 */
const props = defineProps<{
  open: boolean
  buildingId: Id<'buildings'> | null
  buildingName?: string
}>()

const emit = defineEmits<{ close: []; created: [id: Id<'tenants'>] }>()

const { mutate: createTenant, pending } = useConvexMutation(api.tenants.create)

const { data: vacancies } = useConvexQuery(api.tenants.vacancies, () =>
  props.buildingId ? { buildingId: props.buildingId } : null,
)

const NO_ROOM = 'none'

const LEVELS = [
  { value: 'independent', label: 'Independent' },
  { value: 'moderate', label: 'Moderate support' },
  { value: 'high', label: 'High support' },
  { value: 'critical', label: 'Critical' },
] as const

const STATUSES = [
  { value: 'current', label: 'Current — moving in' },
  { value: 'prospective', label: 'Prospective — on the list' },
] as const

const name = ref('')
const dob = ref('')
const intakeDate = ref('')
const roomId = ref<string>(NO_ROOM)
const status = ref<'current' | 'prospective'>('current')
const supportLevel = ref<'independent' | 'moderate' | 'high' | 'critical'>('moderate')
const rent = ref('')
const deposit = ref('')
const notes = ref('')
const error = ref('')

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    name.value = ''
    dob.value = ''
    intakeDate.value = today()
    roomId.value = NO_ROOM
    status.value = 'current'
    supportLevel.value = 'moderate'
    rent.value = ''
    deposit.value = ''
    notes.value = ''
    error.value = ''
  },
  { immediate: true },
)

// The room's rent is the starting figure for both the rent and the deposit.
watch(roomId, (value) => {
  const room = vacancies.value?.find((r) => r._id === value)
  if (!room) return
  const dollars = (room.monthlyRentCents / 100).toFixed(2)
  if (!rent.value) rent.value = dollars
  if (!deposit.value) deposit.value = dollars
})

async function save() {
  if (!props.buildingId) return
  error.value = ''

  if (!name.value.trim()) {
    error.value = 'Enter the resident’s name.'
    return
  }
  const rentCents = dollarsToCents(rent.value)
  const depositCents = dollarsToCents(deposit.value)
  if (rentCents === null) {
    error.value = 'Enter the monthly rent.'
    return
  }
  if (depositCents === null) {
    error.value = 'Enter the deposit required.'
    return
  }

  try {
    const id = await createTenant({
      buildingId: props.buildingId,
      ...(roomId.value !== NO_ROOM ? { roomId: roomId.value as Id<'rooms'> } : {}),
      name: name.value.trim(),
      ...(dob.value ? { dob: dob.value } : {}),
      intakeDate: intakeDate.value,
      status: status.value,
      supportLevel: supportLevel.value,
      monthlyRentCents: rentCents,
      depositRequiredCents: depositCents,
      ...(notes.value.trim() ? { notes: notes.value.trim() } : {}),
    })
    toast.success(`${name.value.trim()} added`, {
      description:
        roomId.value !== NO_ROOM
          ? `Housed in room ${vacancies.value?.find((r) => r._id === roomId.value)?.number ?? ''}.`
          : 'No room assigned yet.',
    })
    emit('created', id)
    emit('close')
  } catch (e) {
    error.value = (e as Error).message || 'Could not create the tenancy.'
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && emit('close')">
    <DialogScrollContent class="gap-0 p-0 sm:max-w-[480px]">
      <DialogHeader
        class="flex-row items-center gap-3 space-y-0 border-b border-[var(--border-subtle)] p-[22px]"
      >
        <span
          class="inline-flex size-[38px] shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700"
        >
          <DsIcon name="user-plus" :size="20" />
        </span>
        <div class="min-w-0 flex-1 text-left">
          <DialogTitle class="text-lg font-semibold text-[var(--text-strong)]">
            New tenancy
          </DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground">
            {{ buildingName ?? 'Intake' }}
          </DialogDescription>
        </div>
      </DialogHeader>

      <div class="flex flex-col gap-4 p-[22px]">
        <DsField v-slot="{ id }" label="Full name" required>
          <Input :id="id" v-model="name" placeholder="Dwayne Robinson" />
        </DsField>

        <div class="grid grid-cols-2 gap-3">
          <DsField v-slot="{ id }" label="Intake date" required>
            <Input :id="id" v-model="intakeDate" type="date" />
          </DsField>
          <DsField v-slot="{ id }" label="Date of birth">
            <Input :id="id" v-model="dob" type="date" />
          </DsField>
        </div>

        <DsField
          v-slot="{ id }"
          label="Room"
          :hint="
            vacancies && vacancies.length
              ? `${vacancies.length} available`
              : 'No rooms free — the tenancy can start without one.'
          "
        >
          <Select v-model="roomId">
            <SelectTrigger :id="id" class="w-full">
              <SelectValue placeholder="No room yet" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="NO_ROOM">No room yet</SelectItem>
              <SelectItem v-for="room in vacancies ?? []" :key="room._id" :value="room._id">
                {{ room.number }} · {{ room.floor }} · {{ money(room.monthlyRentCents) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </DsField>

        <div class="grid grid-cols-2 gap-3">
          <DsField v-slot="{ id }" label="Tenancy status">
            <Select v-model="status">
              <SelectTrigger :id="id" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="s in STATUSES" :key="s.value" :value="s.value">
                  {{ s.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </DsField>

          <DsField v-slot="{ id }" label="Support level">
            <Select v-model="supportLevel">
              <SelectTrigger :id="id" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="l in LEVELS" :key="l.value" :value="l.value">
                  {{ l.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </DsField>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <DsField v-slot="{ id }" label="Monthly rent" required>
            <div class="relative">
              <span
                class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground"
              >
                $
              </span>
              <Input :id="id" v-model="rent" inputmode="decimal" class="pl-7" />
            </div>
          </DsField>

          <DsField v-slot="{ id }" label="Deposit required" required>
            <div class="relative">
              <span
                class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground"
              >
                $
              </span>
              <Input :id="id" v-model="deposit" inputmode="decimal" class="pl-7" />
            </div>
          </DsField>
        </div>

        <DsField v-slot="{ id }" label="Notes" :error="error">
          <Input :id="id" v-model="notes" placeholder="Optional" :aria-invalid="!!error" />
        </DsField>
      </div>

      <DialogFooter
        class="gap-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-[22px] py-4"
      >
        <Button variant="ghost" :disabled="pending" @click="emit('close')">Cancel</Button>
        <Button variant="primary" :loading="pending" @click="save">
          <DsIcon name="check" :size="17" />
          {{ pending ? 'Saving…' : 'Start tenancy' }}
        </Button>
      </DialogFooter>
    </DialogScrollContent>
  </Dialog>
</template>
