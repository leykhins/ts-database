<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { formatDate } from '~/utils/format'
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
 * SupportLevelDialog — move a resident between support levels.
 *
 * The reason is mandatory and goes into the history table. "Why is she on high
 * support" is a question that gets asked months later, by someone who was not
 * on shift.
 */
const props = defineProps<{
  open: boolean
  tenant: { _id: Id<'tenants'>; name: string; room: string; supportLevel: string } | null
}>()

const emit = defineEmits<{ close: [] }>()

const { mutate: setLevel, pending } = useConvexMutation(api.support.setLevel)
const { data: history } = useConvexQuery(api.support.historyFor, () =>
  props.tenant ? { tenantId: props.tenant._id } : null,
)

const LEVELS = [
  { value: 'independent', label: 'Independent', hint: 'Lives independently; routine contact only.' },
  { value: 'moderate', label: 'Moderate', hint: 'Regular check-ins and some coordination.' },
  { value: 'high', label: 'High', hint: 'Daily support; care plan in place.' },
  { value: 'critical', label: 'Critical', hint: 'Active crisis or intensive daily care.' },
] as const

const level = ref<string>('moderate')
const reason = ref('')
const error = ref('')

watch(
  () => [props.open, props.tenant] as const,
  ([open, tenant]) => {
    if (!open || !tenant) return
    level.value = tenant.supportLevel
    reason.value = ''
    error.value = ''
  },
  { immediate: true },
)

async function save() {
  if (!props.tenant) return
  error.value = ''

  if (level.value === props.tenant.supportLevel) {
    error.value = 'Pick a different level, or close this dialog.'
    return
  }
  if (!reason.value.trim()) {
    error.value = 'Record why the level is changing.'
    return
  }

  try {
    await setLevel({
      tenantId: props.tenant._id,
      supportLevel: level.value as 'independent',
      reason: reason.value.trim(),
    })
    toast.success(`${props.tenant.name} moved to ${LEVELS.find((l) => l.value === level.value)?.label}`)
    emit('close')
  } catch (e) {
    error.value = (e as Error).message || 'Could not change the support level.'
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
          class="inline-flex size-[38px] shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-700"
        >
          <DsIcon name="traffic-cone" :size="20" />
        </span>
        <div class="min-w-0 flex-1 text-left">
          <DialogTitle class="text-lg font-semibold text-[var(--text-strong)]">
            Support level
          </DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground">
            {{ tenant.name }} · Room {{ tenant.room }}
          </DialogDescription>
        </div>
      </DialogHeader>

      <div class="flex flex-col gap-4 p-[22px]">
        <div class="flex flex-col gap-2">
          <button
            v-for="option in LEVELS"
            :key="option.value"
            type="button"
            class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors"
            :class="
              level === option.value
                ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                : 'border-border hover:bg-[var(--surface-hover)]'
            "
            @click="level = option.value"
          >
            <DsSupportMeter :level="option.value" size="sm" :show-label="false" />
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-semibold text-[var(--text-strong)]">
                {{ option.label }}
                <span v-if="option.value === tenant.supportLevel" class="text-muted-foreground">
                  · current
                </span>
              </span>
              <span class="block text-xs text-muted-foreground">{{ option.hint }}</span>
            </span>
          </button>
        </div>

        <DsField v-slot="{ id }" label="Reason for the change" required :error="error">
          <Input
            :id="id"
            v-model="reason"
            placeholder="Discharged from hospital; daily medication support needed"
            :aria-invalid="!!error"
          />
        </DsField>

        <div v-if="history?.length" class="flex flex-col gap-1.5 border-t border-[var(--border-subtle)] pt-3">
          <span class="eyebrow">History</span>
          <div v-for="entry in history.slice(0, 5)" :key="entry._id" class="text-sm">
            <span class="capitalize text-[var(--text-strong)]">{{ entry.from }} → {{ entry.to }}</span>
            <span class="text-muted-foreground">
              · {{ formatDate(entry.changedAt) }}{{ entry.changedBy ? ` · ${entry.changedBy}` : '' }}
            </span>
            <p class="text-xs text-muted-foreground">{{ entry.reason }}</p>
          </div>
        </div>
      </div>

      <DialogFooter
        class="gap-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-[22px] py-4"
      >
        <Button variant="ghost" :disabled="pending" @click="emit('close')">Cancel</Button>
        <Button variant="primary" :loading="pending" @click="save">
          <DsIcon name="check" :size="17" />
          {{ pending ? 'Saving…' : 'Change level' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
