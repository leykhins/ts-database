<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { money } from '~/utils/format'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * TenantEditDialog — the tenancy changes that are not money: the record
 * itself, the room someone is in, and ending the tenancy.
 *
 * Ending a tenancy deliberately does not touch the balance or the deposit. An
 * exit is not a settlement; the refund is posted from Security Deposits, where
 * it leaves a movement row with a reason on it.
 */
const props = defineProps<{
  open: boolean
  tenant: {
    _id: Id<'tenants'>
    buildingId: Id<'buildings'>
    name: string
    room: string
    roomId: Id<'rooms'> | null
    dob?: string
    intakeDate: string
    status: string
    monthlyRentCents: number
    depositRequiredCents: number
    depositHeldCents: number
    balanceCents: number
    notes?: string
  } | null
}>()

const emit = defineEmits<{ close: [] }>()

const { mutate: updateTenant, pending: updatePending } = useConvexMutation(api.tenants.update)
const { mutate: transferRoom, pending: transferPending } = useConvexMutation(
  api.tenants.transferRoom,
)
const { mutate: exitTenancy, pending: exitPending } = useConvexMutation(api.tenants.exit)

const { data: vacancies } = useConvexQuery(api.tenants.vacancies, () =>
  props.tenant ? { buildingId: props.tenant.buildingId } : null,
)

const NO_ROOM = 'none'

const tab = ref('record')
const name = ref('')
const dob = ref('')
const intakeDate = ref('')
const rent = ref('')
const deposit = ref('')
const notes = ref('')
const room = ref<string>(NO_ROOM)
const exitDate = ref('')
const exitReason = ref('')
const error = ref('')

const pending = computed(
  () => updatePending.value || transferPending.value || exitPending.value,
)

function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

watch(
  () => [props.open, props.tenant] as const,
  ([open, tenant]) => {
    if (!open || !tenant) return
    tab.value = 'record'
    name.value = tenant.name
    dob.value = tenant.dob ?? ''
    intakeDate.value = tenant.intakeDate
    rent.value = (tenant.monthlyRentCents / 100).toFixed(2)
    deposit.value = (tenant.depositRequiredCents / 100).toFixed(2)
    notes.value = tenant.notes ?? ''
    room.value = tenant.roomId ?? NO_ROOM
    exitDate.value = today()
    exitReason.value = ''
    error.value = ''
  },
  { immediate: true },
)

async function saveRecord() {
  if (!props.tenant) return
  error.value = ''

  const rentCents = dollarsToCents(rent.value)
  const depositCents = dollarsToCents(deposit.value)
  if (!name.value.trim()) {
    error.value = 'Enter the resident’s name.'
    return
  }
  if (rentCents === null || depositCents === null) {
    error.value = 'Rent and deposit must be amounts.'
    return
  }

  try {
    await updateTenant({
      tenantId: props.tenant._id,
      name: name.value.trim(),
      dob: dob.value,
      intakeDate: intakeDate.value,
      monthlyRentCents: rentCents,
      depositRequiredCents: depositCents,
      notes: notes.value,
    })
    toast.success('Record updated')
    emit('close')
  } catch (e) {
    error.value = (e as Error).message || 'Could not save the record.'
  }
}

async function saveRoom() {
  if (!props.tenant) return
  error.value = ''
  try {
    await transferRoom({
      tenantId: props.tenant._id,
      roomId: room.value === NO_ROOM ? null : (room.value as Id<'rooms'>),
    })
    toast.success(
      room.value === NO_ROOM
        ? `${props.tenant.name} is no longer assigned a room`
        : 'Room updated',
    )
    emit('close')
  } catch (e) {
    error.value = (e as Error).message || 'Could not move the resident.'
  }
}

async function endTenancy() {
  if (!props.tenant) return
  error.value = ''

  if (!exitReason.value.trim()) {
    error.value = 'Record why the tenancy ended.'
    return
  }
  if (
    !window.confirm(
      `End ${props.tenant.name}'s tenancy on ${exitDate.value}? Room ${props.tenant.room} is released.`,
    )
  ) {
    return
  }

  try {
    const result = await exitTenancy({
      tenantId: props.tenant._id,
      exitDate: exitDate.value,
      reason: exitReason.value.trim(),
    })
    toast.success('Tenancy ended', {
      description:
        result.balanceCents > 0
          ? `${money(result.balanceCents)} still owed — settle it from Rents.`
          : result.depositHeldCents > 0
            ? `${money(result.depositHeldCents)} deposit still held — refund it from Security Deposits.`
            : 'Nothing outstanding.',
    })
    emit('close')
  } catch (e) {
    error.value = (e as Error).message || 'Could not end the tenancy.'
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && emit('close')">
    <DialogScrollContent v-if="tenant" class="gap-0 p-0 sm:max-w-[480px]">
      <DialogHeader
        class="flex-row items-center gap-3 space-y-0 border-b border-[var(--border-subtle)] p-[22px]"
      >
        <DsPersonAvatar :name="tenant.name" size="sm" />
        <div class="min-w-0 flex-1 text-left">
          <DialogTitle class="text-lg font-semibold text-[var(--text-strong)]">
            {{ tenant.name }}
          </DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground">
            Room {{ tenant.room }} · {{ tenant.status }}
          </DialogDescription>
        </div>
      </DialogHeader>

      <div class="flex flex-col gap-4 p-[22px]">
        <Tabs v-model="tab">
          <TabsList class="w-full">
            <TabsTrigger value="record" class="flex-1">Record</TabsTrigger>
            <TabsTrigger value="room" class="flex-1">Room</TabsTrigger>
            <TabsTrigger value="exit" class="flex-1">End tenancy</TabsTrigger>
          </TabsList>

          <!-- ------------------------------------------------------ Record -->
          <TabsContent value="record" class="mt-4 flex flex-col gap-4">
            <DsField v-slot="{ id }" label="Full name" required>
              <Input :id="id" v-model="name" />
            </DsField>

            <div class="grid grid-cols-2 gap-3">
              <DsField v-slot="{ id }" label="Intake date">
                <Input :id="id" v-model="intakeDate" type="date" />
              </DsField>
              <DsField v-slot="{ id }" label="Date of birth">
                <Input :id="id" v-model="dob" type="date" />
              </DsField>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <DsField v-slot="{ id }" label="Monthly rent">
                <div class="relative">
                  <span
                    class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground"
                  >
                    $
                  </span>
                  <Input :id="id" v-model="rent" inputmode="decimal" class="pl-7" />
                </div>
              </DsField>
              <DsField v-slot="{ id }" label="Deposit required">
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

            <DsField v-slot="{ id }" label="Notes" :error="tab === 'record' ? error : undefined">
              <Input :id="id" v-model="notes" placeholder="Optional" />
            </DsField>
          </TabsContent>

          <!-- -------------------------------------------------------- Room -->
          <TabsContent value="room" class="mt-4 flex flex-col gap-4">
            <DsField
              v-slot="{ id }"
              label="Room"
              :hint="`Currently ${tenant.roomId ? `in room ${tenant.room}` : 'not assigned a room'}.`"
              :error="tab === 'room' ? error : undefined"
            >
              <Select v-model="room">
                <SelectTrigger :id="id" class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="NO_ROOM">No room</SelectItem>
                  <SelectItem v-if="tenant.roomId" :value="tenant.roomId">
                    {{ tenant.room }} · current
                  </SelectItem>
                  <SelectItem v-for="r in vacancies ?? []" :key="r._id" :value="r._id">
                    {{ r.number }} · {{ r.floor }} · {{ money(r.monthlyRentCents) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </DsField>

            <p class="text-xs text-muted-foreground">
              Moving rooms does not change the rent on this tenancy. Change that on the Record
              tab if the new room is billed differently.
            </p>
          </TabsContent>

          <!-- -------------------------------------------------------- Exit -->
          <TabsContent value="exit" class="mt-4 flex flex-col gap-4">
            <Alert v-if="tenant.balanceCents > 0 || tenant.depositHeldCents > 0" variant="warning">
              <DsIcon name="alert-triangle" :size="17" :stroke-width="2" />
              <AlertDescription>
                <span v-if="tenant.balanceCents > 0">
                  {{ money(tenant.balanceCents) }} is still owed.
                </span>
                <span v-if="tenant.depositHeldCents > 0">
                  {{ money(tenant.depositHeldCents) }} deposit is still held.
                </span>
                Ending the tenancy leaves both as they are — settle them from Rents and
                Security Deposits.
              </AlertDescription>
            </Alert>

            <DsField v-slot="{ id }" label="Exit date" required>
              <Input :id="id" v-model="exitDate" type="date" />
            </DsField>

            <DsField
              v-slot="{ id }"
              label="Reason"
              required
              :error="tab === 'exit' ? error : undefined"
            >
              <Input
                :id="id"
                v-model="exitReason"
                placeholder="Moved to supported housing; tenancy ended by agreement"
              />
            </DsField>
          </TabsContent>
        </Tabs>
      </div>

      <DialogFooter
        class="gap-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-[22px] py-4"
      >
        <Button variant="ghost" :disabled="pending" @click="emit('close')">Cancel</Button>
        <Button v-if="tab === 'record'" variant="primary" :loading="pending" @click="saveRecord">
          <DsIcon name="check" :size="17" />
          {{ pending ? 'Saving…' : 'Save record' }}
        </Button>
        <Button v-else-if="tab === 'room'" variant="primary" :loading="pending" @click="saveRoom">
          <DsIcon name="door" :size="17" />
          {{ pending ? 'Saving…' : 'Move resident' }}
        </Button>
        <Button v-else variant="destructive" :loading="pending" @click="endTenancy">
          <DsIcon name="log-out" :size="17" />
          {{ pending ? 'Ending…' : 'End tenancy' }}
        </Button>
      </DialogFooter>
    </DialogScrollContent>
  </Dialog>
</template>
