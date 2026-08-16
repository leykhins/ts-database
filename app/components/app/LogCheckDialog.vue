<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { formatShortDate } from '~/utils/format'
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
 * LogCheckDialog — record a wellness check.
 *
 * The outcomes are the ones that actually happen at a door: seen, refused,
 * out, declined, no answer, asleep. Only "seen" counts as a completed check —
 * the rest are recorded because a refusal is information, not a gap.
 */
const props = defineProps<{
  open: boolean
  resident: {
    tenantId: Id<'tenants'>
    name: string
    room: string
    photoUrl?: string | null
    supportLevel?: string
    critical?: boolean
    reason?: string
  } | null
}>()

const emit = defineEmits<{ close: []; logged: [] }>()

const { mutate: logCheck, pending } = useConvexMutation(api.care.logCheck)
const { data: history } = useConvexQuery(api.care.historyFor, () =>
  props.resident ? { tenantId: props.resident.tenantId } : null,
)

const OUTCOMES = [
  { value: 'seen', label: 'Seen and well', hint: 'Laid eyes on the resident', icon: 'check-circle-2', tone: 'var(--green-600)' },
  { value: 'refused', label: 'Refused entry', hint: 'Answered, would not let staff in', icon: 'alert-triangle', tone: 'var(--amber-600)' },
  { value: 'declined', label: 'Declined the check', hint: 'Asked not to be checked on', icon: 'x', tone: 'var(--amber-600)' },
  { value: 'no-answer', label: 'No answer', hint: 'Knocked, no response', icon: 'alert-octagon', tone: 'var(--rose-600)' },
  { value: 'absent', label: 'Out of the building', hint: 'Known to be out', icon: 'door', tone: 'var(--text-muted)' },
  { value: 'asleep', label: 'Asleep — not disturbed', hint: 'Observed, left to rest', icon: 'moon', tone: 'var(--text-muted)' },
] as const

const OUTCOME_LABEL: Record<string, string> = Object.fromEntries(
  OUTCOMES.map((o) => [o.value, o.label]),
)

const outcome = ref<string>('seen')
const note = ref('')
const error = ref('')

watch(
  () => [props.open, props.resident] as const,
  ([open]) => {
    if (!open) return
    outcome.value = 'seen'
    note.value = ''
    error.value = ''
  },
  { immediate: true },
)

async function save() {
  if (!props.resident) return
  error.value = ''

  try {
    await logCheck({
      tenantId: props.resident.tenantId,
      outcome: outcome.value as 'seen',
      note: note.value.trim() || undefined,
      now: Date.now(),
      tzOffsetMinutes: new Date().getTimezoneOffset(),
    })
    toast.success(
      outcome.value === 'seen'
        ? `Room ${props.resident.room} checked`
        : `Room ${props.resident.room} — ${OUTCOME_LABEL[outcome.value]?.toLowerCase()}`,
      { description: props.resident.name },
    )
    emit('logged')
    emit('close')
  } catch (e) {
    error.value = (e as Error).message || 'Could not record the check.'
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && emit('close')">
    <DialogContent v-if="resident" class="gap-0 p-0 sm:max-w-[460px]">
      <DialogHeader
        class="flex-row items-center gap-3 space-y-0 border-b border-[var(--border-subtle)] p-[22px]"
      >
        <TsResidentAvatar
          :name="resident.name"
          :tenant-id="resident.tenantId"
          :photo-url="resident.photoUrl"
          :room="resident.room"
          :support-level="resident.supportLevel"
          :critical="resident.critical"
          size="lg"
          :status="resident.critical ? 'alert' : undefined"
        />
        <div class="min-w-0 flex-1 text-left">
          <DialogTitle class="text-lg font-semibold text-[var(--text-strong)]">
            Wellness check
          </DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground">
            {{ resident.name }} · Room {{ resident.room }}
            <template v-if="resident.reason"> · {{ resident.reason }}</template>
          </DialogDescription>
        </div>
        <DsSupportMeter
          v-if="resident.supportLevel"
          :level="resident.supportLevel as 'moderate'"
          size="sm"
          :show-label="false"
        />
      </DialogHeader>

      <div class="flex flex-col gap-4 p-[22px]">
        <div class="flex flex-col gap-2">
          <button
            v-for="option in OUTCOMES"
            :key="option.value"
            type="button"
            class="flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-left transition-colors"
            :class="
              outcome === option.value
                ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                : 'border-border hover:bg-[var(--surface-hover)]'
            "
            @click="outcome = option.value"
          >
            <DsIcon :name="option.icon" :size="18" :style="{ color: option.tone }" />
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-semibold text-[var(--text-strong)]">
                {{ option.label }}
              </span>
              <span class="block text-xs text-muted-foreground">{{ option.hint }}</span>
            </span>
            <DsIcon
              v-if="outcome === option.value"
              name="check"
              :size="16"
              class="text-[var(--brand-strong)]"
            />
          </button>
        </div>

        <DsField
          v-slot="{ id }"
          label="Note"
          :error="error"
          hint="Anything the next shift should know."
        >
          <Input
            :id="id"
            v-model="note"
            placeholder="Optional"
            :aria-invalid="!!error"
            @keyup.enter="save"
          />
        </DsField>

        <div
          v-if="history?.length"
          class="flex flex-col gap-1 border-t border-[var(--border-subtle)] pt-3"
        >
          <span class="eyebrow">Last checks</span>
          <div
            v-for="entry in history.slice(0, 4)"
            :key="entry._id"
            class="flex items-baseline justify-between gap-3 text-sm"
          >
            <span class="text-muted-foreground">
              {{ formatShortDate(entry.completedAt) }} · {{ entry.shiftKey }}
            </span>
            <span
              class="font-semibold"
              :class="entry.outcome === 'seen' ? 'text-[var(--success)]' : 'text-[var(--warning)]'"
            >
              {{ OUTCOME_LABEL[entry.outcome] ?? entry.outcome }}
            </span>
          </div>
        </div>
      </div>

      <DialogFooter
        class="gap-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-[22px] py-4"
      >
        <Button variant="ghost" :disabled="pending" @click="emit('close')">Cancel</Button>
        <Button variant="primary" :loading="pending" @click="save">
          <DsIcon name="clipboard-check" :size="17" />
          {{ pending ? 'Recording…' : 'Record check' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
