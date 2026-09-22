<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { formatMinutes } from '~/utils/format'
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
 * DoseDialog — chart one dose.
 *
 * `given` is the big button and needs nothing else. Every other outcome is a
 * dose that did not go in, and the record has to say why before it will save.
 * A PRN dose is the other way round: it needs the reason it *was* given.
 */
export type DoseTarget = {
  medicationId: Id<'medications'>
  residentName: string
  medication: string
  dose: string
  instructions: string | null
  prn: boolean
  prnIndication: string | null
  date: string
  /** Absent for a PRN dose. */
  scheduledMinutes: number | null
}

const props = defineProps<{
  open: boolean
  target: DoseTarget | null
}>()

const emit = defineEmits<{ close: [] }>()

const { mutate: administer, pending } = useConvexMutation(api.medications.administer)

type Outcome = 'given' | 'refused' | 'held' | 'absent' | 'not-given'

const OUTCOMES: { value: Outcome; label: string; hint: string }[] = [
  { value: 'given', label: 'Given', hint: 'Taken and witnessed' },
  { value: 'refused', label: 'Refused', hint: 'Offered and declined' },
  { value: 'held', label: 'Held', hint: 'Withheld — asleep, unwell' },
  { value: 'absent', label: 'Absent', hint: 'Not in the building' },
  { value: 'not-given', label: 'Not given', hint: 'Something else' },
]

const outcome = ref<Outcome>('given')
const reason = ref('')
const note = ref('')
const error = ref('')
/** `HH:MM`, local. When the dose actually went in — not when it is being written up. */
const time = ref('')

const tz = new Date().getTimezoneOffset()
const pad = (n: number) => String(n).padStart(2, '0')

function localToday() {
  return new Date(Date.now() - tz * 60_000).toISOString().slice(0, 10)
}

/** The time field as a moment, on the dose's own day. */
const givenAt = computed<number | null>(() => {
  const target = props.target
  const match = /^(\d{2}):(\d{2})$/.exec(time.value)
  if (!target || !match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  const [y, m, d] = target.date.split('-').map(Number)
  let at = Date.UTC(y!, m! - 1, d!, 0, minutes) + tz * 60_000
  // A late-evening dose given after midnight still belongs to its own day:
  // 12:20 against a 23:30 slot means the early hours after it, not that morning.
  if (target.scheduledMinutes !== null && target.scheduledMinutes >= 18 * 60 && minutes < 6 * 60) {
    at += 86_400_000
  }
  return at
})

/** Early or late against the slot, said while the worker can still fix a typo. */
const timingNote = computed(() => {
  const target = props.target
  if (!target || target.scheduledMinutes === null || givenAt.value === null) return null
  const [y, m, d] = target.date.split('-').map(Number)
  const scheduledAt = Date.UTC(y!, m! - 1, d!, 0, target.scheduledMinutes) + tz * 60_000
  const diff = Math.round((givenAt.value - scheduledAt) / 60_000)
  if (Math.abs(diff) <= 60) return null
  const h = Math.floor(Math.abs(diff) / 60)
  const mm = Math.abs(diff) % 60
  const span = h ? `${h}h${mm ? ` ${mm}m` : ''}` : `${mm}m`
  return diff > 0 ? `${span} after the scheduled time — this will be charted as late.` : `${span} before the scheduled time — this will be charted as early.`
})

const inFuture = computed(() => givenAt.value !== null && givenAt.value > Date.now() + 60_000)

const needsReason = computed(() => outcome.value !== 'given' || props.target?.prn === true)
const reasonLabel = computed(() =>
  props.target?.prn && outcome.value === 'given' ? 'Given for' : 'Reason',
)

watch(
  () => [props.open, props.target] as const,
  ([open]) => {
    if (!open) return
    outcome.value = 'given'
    reason.value = ''
    note.value = ''
    error.value = ''
    // Today: now, since most doses are charted at the cupboard. A past day is
    // being written up after the fact, so start from the time it was due.
    const target = props.target
    if (target && target.date !== localToday() && target.scheduledMinutes !== null) {
      time.value = `${pad(Math.floor(target.scheduledMinutes / 60))}:${pad(target.scheduledMinutes % 60)}`
    } else {
      const local = new Date(Date.now() - tz * 60_000)
      time.value = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`
    }
  },
  { immediate: true },
)

async function save() {
  if (!props.target) return
  error.value = ''
  if (givenAt.value === null) {
    error.value = 'Enter the time the dose was given.'
    return
  }
  if (inFuture.value) {
    error.value = 'The time given cannot be in the future.'
    return
  }
  if (needsReason.value && !reason.value.trim()) {
    error.value =
      props.target.prn && outcome.value === 'given'
        ? 'Say why the as-needed dose was given.'
        : 'Say why the dose was not given.'
    return
  }

  try {
    await administer({
      medicationId: props.target.medicationId,
      date: props.target.date,
      scheduledMinutes: props.target.scheduledMinutes ?? undefined,
      outcome: outcome.value,
      reason: reason.value.trim() || undefined,
      note: note.value.trim() || undefined,
      givenAt: givenAt.value,
      now: Date.now(),
      tzOffsetMinutes: tz,
    })
    toast.success(outcome.value === 'given' ? 'Dose charted' : `Charted as ${outcome.value.replace('-', ' ')}`)
    emit('close')
  } catch (e) {
    error.value = (e as Error).message || 'Could not chart the dose.'
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
          class="inline-flex size-[38px] shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700"
        >
          <DsIcon name="pill" :size="20" />
        </span>
        <div class="min-w-0 flex-1 text-left">
          <DialogTitle class="text-lg font-semibold text-[var(--text-strong)]">
            {{ target?.residentName }}
          </DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground">
            <template v-if="target">
              {{ target.medication }} · {{ target.dose }}
              <template v-if="target.scheduledMinutes !== null">
                · {{ formatMinutes(target.scheduledMinutes) }}
              </template>
              <template v-else-if="target.prnIndication"> · as needed, {{ target.prnIndication }}</template>
            </template>
          </DialogDescription>
        </div>
      </DialogHeader>

      <div class="flex flex-col gap-4 p-[22px]">
        <p
          v-if="target?.instructions"
          class="rounded-md border border-[var(--amber-200)] bg-[var(--amber-50)] px-3 py-2 text-sm text-[var(--amber-800)]"
        >
          {{ target.instructions }}
        </p>

        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <button
            v-for="o in OUTCOMES"
            :key="o.value"
            type="button"
            class="flex flex-col items-start gap-0.5 rounded-md border px-3 py-2.5 text-left transition-colors"
            :class="
              outcome === o.value
                ? o.value === 'given'
                  ? 'border-[var(--success)] bg-[var(--success-soft)]'
                  : 'border-[var(--warning)] bg-[var(--warning-soft)]'
                : 'border-[var(--border-strong)] bg-card hover:bg-[var(--surface-sunken)]'
            "
            :aria-pressed="outcome === o.value"
            @click="outcome = o.value"
          >
            <span class="text-sm font-semibold text-[var(--text-strong)]">{{ o.label }}</span>
            <span class="text-xs text-muted-foreground">{{ o.hint }}</span>
          </button>
        </div>

        <DsField
          v-slot="{ id }"
          :label="outcome === 'given' ? 'Time given' : outcome === 'absent' ? 'Time checked' : 'Time offered'"
          required
          :hint="target?.scheduledMinutes != null ? `Due ${formatMinutes(target.scheduledMinutes)}. Enter when it actually happened — it is recorded separately from when you chart it.` : 'Enter when it actually happened.'"
        >
          <div class="flex flex-wrap items-center gap-2">
            <Input :id="id" v-model="time" type="time" class="w-[140px] tnum" :aria-invalid="inFuture" />
            <span v-if="timingNote" class="text-xs font-semibold text-[var(--warning)]">{{ timingNote }}</span>
            <span v-else-if="inFuture" class="text-xs font-semibold text-[var(--danger)]">That is in the future.</span>
          </div>
        </DsField>

        <DsField v-slot="{ id }" :label="reasonLabel" :required="needsReason" :error="error">
          <Input
            :id="id"
            v-model="reason"
            :placeholder="
              target?.prn && outcome === 'given'
                ? 'Complained of headache, 6/10'
                : outcome === 'given'
                  ? 'Optional'
                  : 'Asleep and could not be roused; away at appointment'
            "
            :aria-invalid="!!error"
          />
        </DsField>

        <DsField v-slot="{ id }" label="Note">
          <Input :id="id" v-model="note" placeholder="Anything the next shift should know" />
        </DsField>
      </div>

      <DialogFooter
        class="gap-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-[22px] py-4"
      >
        <Button variant="ghost" :disabled="pending" @click="emit('close')">Cancel</Button>
        <Button variant="primary" :loading="pending" @click="save">
          <DsIcon name="check" :size="17" />
          {{ pending ? 'Charting…' : 'Chart dose' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
