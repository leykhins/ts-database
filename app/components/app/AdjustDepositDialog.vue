<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { formatDate, money } from '~/utils/format'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * AdjustDepositDialog — collect, deduct or refund against a tenancy.
 *
 * One dialog rather than three: the movement is the same row either way, and
 * the direction is the thing staff get wrong when it is implicit.
 */
const props = defineProps<{
  open: boolean
  tenant: {
    _id: Id<'tenants'>
    name: string
    room: string
    heldCents: number
    requiredCents: number
    shortCents: number
  } | null
}>()

const emit = defineEmits<{ close: [] }>()

const { mutate: adjust, pending } = useConvexMutation(api.rents.adjustDeposit)
const { data: history } = useConvexQuery(api.deposits.historyFor, () =>
  props.tenant ? { tenantId: props.tenant._id } : null,
)

const REASONS = {
  collect: ['Deposit collected', 'Top-up to required amount', 'Instalment'],
  deduct: ['Damage', 'Cleaning', 'Unpaid rent applied'],
  refund: ['Refunded on exit', 'Refunded in part'],
}

const direction = ref<'collect' | 'deduct' | 'refund'>('collect')
const amount = ref('')
const reason = ref('')
const error = ref('')

watch(
  () => [props.open, props.tenant] as const,
  ([open, tenant]) => {
    if (!open || !tenant) return
    direction.value = tenant.shortCents > 0 ? 'collect' : 'refund'
    amount.value = ((tenant.shortCents || tenant.heldCents) / 100).toFixed(2)
    reason.value = ''
    error.value = ''
  },
  { immediate: true },
)

watch(direction, (value) => {
  if (!props.tenant) return
  amount.value = (
    (value === 'collect' ? props.tenant.shortCents || props.tenant.requiredCents : props.tenant.heldCents)
    / 100
  ).toFixed(2)
})

async function post() {
  if (!props.tenant) return
  error.value = ''

  const cents = dollarsToCents(amount.value)
  if (cents === null || cents === 0) {
    error.value = 'Enter an amount greater than zero.'
    return
  }
  if (!reason.value.trim()) {
    error.value = 'Say what this movement is for.'
    return
  }

  const signed = direction.value === 'collect' ? cents : -cents

  try {
    await adjust({ tenantId: props.tenant._id, amountCents: signed, reason: reason.value.trim() })
    toast.success(
      `${direction.value === 'collect' ? 'Collected' : direction.value === 'refund' ? 'Refunded' : 'Deducted'} ${money(cents)}`,
      { description: `${props.tenant.name} · Room ${props.tenant.room}` },
    )
    emit('close')
  } catch (e) {
    error.value = (e as Error).message || 'Could not post the movement.'
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && emit('close')">
    <DialogContent v-if="tenant" class="gap-0 p-0 sm:max-w-[460px]">
      <DialogHeader
        class="flex-row items-center gap-3 space-y-0 border-b border-[var(--border-subtle)] p-[22px]"
      >
        <span
          class="inline-flex size-[38px] shrink-0 items-center justify-center rounded-md bg-cyan-50 text-cyan-700"
        >
          <DsIcon name="lock" :size="20" />
        </span>
        <div class="min-w-0 flex-1 text-left">
          <DialogTitle class="text-lg font-semibold text-[var(--text-strong)]">
            Adjust deposit
          </DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground">
            {{ tenant.name }} · Room {{ tenant.room }} ·
            {{ money(tenant.heldCents) }} of {{ money(tenant.requiredCents) }} held
          </DialogDescription>
        </div>
      </DialogHeader>

      <div class="flex flex-col gap-4 p-[22px]">
        <Tabs v-model="direction">
          <TabsList class="w-full">
            <TabsTrigger value="collect" class="flex-1">Collect</TabsTrigger>
            <TabsTrigger value="deduct" class="flex-1">Deduct</TabsTrigger>
            <TabsTrigger value="refund" class="flex-1">Refund</TabsTrigger>
          </TabsList>
        </Tabs>

        <DsField v-slot="{ id }" label="Amount" required>
          <div class="relative">
            <span
              class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground"
            >
              $
            </span>
            <Input :id="id" v-model="amount" input-size="lg" inputmode="decimal" class="pl-7" />
          </div>
        </DsField>

        <DsField v-slot="{ id }" label="Reason" required :error="error">
          <Input
            :id="id"
            v-model="reason"
            :placeholder="REASONS[direction][0]"
            :aria-invalid="!!error"
          />
        </DsField>

        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="preset in REASONS[direction]"
            :key="preset"
            type="button"
            class="cursor-pointer rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-[var(--surface-hover)]"
            @click="reason = preset"
          >
            {{ preset }}
          </button>
        </div>

        <div v-if="history?.length" class="flex flex-col gap-1.5 border-t border-[var(--border-subtle)] pt-3">
          <span class="eyebrow">Movements</span>
          <div
            v-for="entry in history.slice(0, 5)"
            :key="entry._id"
            class="flex items-baseline justify-between gap-3 text-sm"
          >
            <span class="min-w-0 truncate text-muted-foreground">
              {{ formatDate(entry.postedAt) }} · {{ entry.reason }}
            </span>
            <span
              class="tnum font-semibold"
              :class="entry.amountCents < 0 ? 'text-destructive' : 'text-[var(--text-strong)]'"
            >
              {{ entry.amountCents < 0 ? '−' : '+' }}{{ money(Math.abs(entry.amountCents)) }}
            </span>
          </div>
        </div>
      </div>

      <DialogFooter
        class="gap-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-[22px] py-4"
      >
        <Button variant="ghost" :disabled="pending" @click="emit('close')">Cancel</Button>
        <Button variant="primary" :loading="pending" @click="post">
          <DsIcon name="check" :size="17" />
          {{ pending ? 'Posting…' : 'Post movement' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
