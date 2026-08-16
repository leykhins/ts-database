<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { money } from '~/utils/format'
import { Badge } from '@/components/ui/badge'
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

/** ReceiveRentDialog — post a rent payment against a tenant's ledger. */
const props = defineProps<{
  open: boolean
  tenant: {
    _id: Id<'tenants'>
    name: string
    room: string
    monthlyRentCents: number
    balanceCents: number
  } | null
}>()

const emit = defineEmits<{ close: []; posted: [] }>()

const { mutate, pending } = useConvexMutation(api.rents.receivePayment)

const amount = ref('')
const method = ref('cheque')
const reference = ref('')
const error = ref('')

// Default to what they actually owe, falling back to one month's rent — the
// two most common amounts to type, pre-typed.
watch(
  () => [props.open, props.tenant] as const,
  ([open, tenant]) => {
    if (!open || !tenant) return
    const suggested = tenant.balanceCents > 0 ? tenant.balanceCents : tenant.monthlyRentCents
    amount.value = (suggested / 100).toFixed(2)
    method.value = 'cheque'
    reference.value = ''
    error.value = ''
  },
  { immediate: true },
)

const METHODS = [
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash', label: 'Cash' },
  { value: 'eft', label: 'Direct deposit (EFT)' },
  { value: 'money-order', label: 'Money order' },
]

async function post() {
  if (!props.tenant) return
  error.value = ''

  const parsed = Number.parseFloat(amount.value.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(parsed) || parsed <= 0) {
    error.value = 'Enter an amount greater than zero.'
    return
  }
  const cents = Math.round(parsed * 100)

  try {
    await mutate({
      tenantId: props.tenant._id,
      amountCents: cents,
      method: method.value as 'cheque' | 'cash' | 'eft' | 'money-order',
      reference: reference.value.trim() || undefined,
    })
    toast.success(`Rent received — ${money(cents)}`, {
      description: `Posted to Room ${props.tenant.room}.`,
    })
    emit('posted')
    emit('close')
  } catch (e) {
    error.value = (e as Error).message || 'Could not post the payment.'
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && emit('close')">
    <DialogContent v-if="tenant" class="gap-0 p-0 sm:max-w-[440px]">
      <DialogHeader class="flex-row items-center gap-3 space-y-0 border-b border-[var(--border-subtle)] p-[22px]">
        <span
          class="inline-flex size-[38px] shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600"
        >
          <DsIcon name="dollar-sign" :size="20" />
        </span>
        <div class="min-w-0 flex-1 text-left">
          <DialogTitle class="text-lg font-semibold text-[var(--text-strong)]">
            Receive Rent
          </DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground">
            {{ tenant.name }} · Room {{ tenant.room }}
          </DialogDescription>
        </div>
        <Badge v-if="tenant.balanceCents > 0" variant="warning">
          Owes {{ money(tenant.balanceCents) }}
        </Badge>
        <Badge v-else variant="success" dot>Clear</Badge>
      </DialogHeader>

      <div class="flex flex-col gap-4 p-[22px]">
        <DsField v-slot="{ id }" label="Amount" :error="error">
          <div class="relative">
            <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
              $
            </span>
            <Input
              :id="id"
              v-model="amount"
              input-size="lg"
              inputmode="decimal"
              class="pl-7"
              :aria-invalid="!!error"
            />
          </div>
        </DsField>

        <DsField v-slot="{ id }" label="Payment method">
          <Select v-model="method">
            <SelectTrigger :id="id" class="w-full">
              <SelectValue placeholder="Choose a method" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="m in METHODS" :key="m.value" :value="m.value">
                {{ m.label }}
              </SelectItem>
            </SelectContent>
          </Select>
        </DsField>

        <DsField v-slot="{ id }" label="Reference / cheque #">
          <div class="relative">
            <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
              <DsIcon name="hash" :size="16" />
            </span>
            <Input :id="id" v-model="reference" placeholder="Optional" class="pl-9" />
          </div>
        </DsField>
      </div>

      <DialogFooter class="gap-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-[22px] py-4">
        <Button variant="ghost" :disabled="pending" @click="emit('close')">Cancel</Button>
        <Button variant="primary" :loading="pending" @click="post">
          <DsIcon name="check" :size="17" />
          {{ pending ? 'Posting…' : 'Post payment' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
