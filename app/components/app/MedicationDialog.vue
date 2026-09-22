<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { formatMinutes } from '~/utils/format'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * MedicationDialog — transcribe an order from the pharmacy label, or correct
 * one already on file.
 *
 * Times are entered one at a time and shown as chips: a schedule is a handful
 * of moments in the day, and a comma-separated text field is how "8:00, 20:00"
 * becomes "8:00, 2000".
 */
export type MedicationOrder = {
  _id: Id<'medications'>
  name: string
  strength: string | null
  dose: string
  route: 'oral' | 'sublingual' | 'topical' | 'inhaled' | 'injection' | 'eye-ear' | 'other'
  instructions: string | null
  times: number[]
  prn: boolean
  prnIndication: string | null
  prnMaxPerDay: number | null
  prescriber: string | null
  startDate: string
  endDate: string | null
}

const props = defineProps<{
  open: boolean
  /** Programme residents, for the picker when adding from the board. */
  residents: { tenantId: Id<'tenants'>; name: string; room: string }[]
  /** Pre-selects the resident when opened from their record. */
  tenantId?: Id<'tenants'> | null
  /** Present when editing. */
  order?: MedicationOrder | null
}>()

const emit = defineEmits<{ close: [] }>()

const { mutate: add, pending: addPending } = useConvexMutation(api.medications.add)
const { mutate: update, pending: updatePending } = useConvexMutation(api.medications.update)
const { mutate: change, pending: changePending } = useConvexMutation(api.medications.change)
const pending = computed(() => addPending.value || updatePending.value || changePending.value)
const isEdit = computed(() => !!props.order)

/**
 * What kind of edit this is. The two are not the same act and are not written
 * the same way: a new dose or new times is a new order and a stopped one, so
 * last month's sheet still says what was given last month; a typo copied off
 * the label is fixed where it stands.
 */
const mode = ref<'change' | 'correct'>('change')
const changeReason = ref('')

const ROUTES = [
  { value: 'oral', label: 'Oral' },
  { value: 'sublingual', label: 'Sublingual' },
  { value: 'topical', label: 'Topical' },
  { value: 'inhaled', label: 'Inhaled' },
  { value: 'injection', label: 'Injection' },
  { value: 'eye-ear', label: 'Eye / ear' },
  { value: 'other', label: 'Other' },
] as const

const tenant = ref('')
const name = ref('')
const strength = ref('')
const dose = ref('')
const route = ref<MedicationOrder['route']>('oral')
const instructions = ref('')
const times = ref<number[]>([])
const newTime = ref('')
const prn = ref(false)
const prnIndication = ref('')
const prnMaxPerDay = ref('')
const prescriber = ref('')
const startDate = ref('')
const endDate = ref('')
const error = ref('')

function today() {
  const tz = new Date().getTimezoneOffset()
  return new Date(Date.now() - tz * 60_000).toISOString().slice(0, 10)
}

watch(
  () => [props.open, props.order, props.tenantId] as const,
  ([open, order, tenantId]) => {
    if (!open) return
    tenant.value = tenantId ?? ''
    name.value = order?.name ?? ''
    strength.value = order?.strength ?? ''
    dose.value = order?.dose ?? ''
    route.value = order?.route ?? 'oral'
    instructions.value = order?.instructions ?? ''
    times.value = order ? [...order.times] : []
    newTime.value = ''
    prn.value = order?.prn ?? false
    prnIndication.value = order?.prnIndication ?? ''
    prnMaxPerDay.value = order?.prnMaxPerDay != null ? String(order.prnMaxPerDay) : ''
    prescriber.value = order?.prescriber ?? ''
    startDate.value = order?.startDate ?? today()
    endDate.value = order?.endDate ?? ''
    mode.value = 'change'
    changeReason.value = ''
    error.value = ''
  },
  { immediate: true },
)

function addTime() {
  const match = /^(\d{2}):(\d{2})$/.exec(newTime.value)
  if (!match) return
  const minutes = Number(match[1]) * 60 + Number(match[2])
  if (!times.value.includes(minutes)) {
    times.value = [...times.value, minutes].sort((a, b) => a - b)
  }
  newTime.value = ''
}

function removeTime(minutes: number) {
  times.value = times.value.filter((t) => t !== minutes)
}

async function save() {
  error.value = ''
  if (!name.value.trim()) return (error.value = 'Name the medication as it appears on the label.')
  if (!dose.value.trim()) return (error.value = 'Give the dose — "1 tablet", "5 ml", "2 puffs".')
  if (!prn.value && !times.value.length) {
    return (error.value = 'Add at least one time of day, or mark the order as needed.')
  }
  if (prn.value && !prnIndication.value.trim()) {
    return (error.value = 'Say what an as-needed dose is for.')
  }

  const cap = prnMaxPerDay.value.trim() ? Number(prnMaxPerDay.value) : undefined
  const fields = {
    name: name.value.trim(),
    strength: strength.value.trim() || undefined,
    dose: dose.value.trim(),
    route: route.value,
    instructions: instructions.value.trim() || undefined,
    times: prn.value ? [] : times.value,
    prn: prn.value,
    prnIndication: prn.value ? prnIndication.value.trim() : undefined,
    prnMaxPerDay: prn.value && cap !== undefined && Number.isFinite(cap) ? cap : undefined,
    prescriber: prescriber.value.trim() || undefined,
    startDate: startDate.value,
    endDate: endDate.value || undefined,
  }

  try {
    if (props.order && mode.value === 'change') {
      if (!changeReason.value.trim()) {
        error.value = 'Say what changed and who ordered it.'
        return
      }
      await change({
        medicationId: props.order._id,
        reason: changeReason.value.trim(),
        tzOffsetMinutes: new Date().getTimezoneOffset(),
        ...fields,
        startDate: today(),
      })
      toast.success('Prescription changed', {
        description: 'The old order is stopped from now; doses already charted stay with it.',
      })
    } else if (props.order) {
      await update({ medicationId: props.order._id, ...fields })
      toast.success('Transcription corrected')
    } else {
      if (!tenant.value) return (error.value = 'Choose the resident this order is for.')
      await add({ tenantId: tenant.value as Id<'tenants'>, ...fields })
      toast.success('Order added')
    }
    emit('close')
  } catch (e) {
    error.value = (e as Error).message || 'Could not save the order.'
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && emit('close')">
    <DialogContent class="gap-0 p-0 sm:max-w-[560px]">
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
            {{ isEdit ? (mode === 'change' ? 'Change prescription' : 'Correct transcription') : 'Add an order' }}
          </DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground">
            {{
              isEdit
                ? `${order?.name ?? ''}${order?.strength ? ` ${order.strength}` : ''} — ${order?.dose ?? ''}`
                : 'Transcribe it from the pharmacy label.'
            }}
          </DialogDescription>
        </div>
      </DialogHeader>

      <div class="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-[22px]">
        <div v-if="isEdit" class="grid gap-2 sm:grid-cols-2">
          <button
            v-for="m in [
              { value: 'change', label: 'The prescription changed', hint: 'New dose, times or strength. Stops this order now and starts a new one.' },
              { value: 'correct', label: 'Fixing a transcription error', hint: 'It was copied wrong. Edits this order where it stands.' },
            ] as const"
            :key="m.value"
            type="button"
            class="flex flex-col items-start gap-0.5 rounded-md border px-3 py-2.5 text-left transition-colors"
            :class="
              mode === m.value
                ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                : 'border-[var(--border-strong)] bg-card hover:bg-[var(--surface-sunken)]'
            "
            :aria-pressed="mode === m.value"
            @click="mode = m.value"
          >
            <span class="text-sm font-semibold text-[var(--text-strong)]">{{ m.label }}</span>
            <span class="text-xs text-muted-foreground">{{ m.hint }}</span>
          </button>
        </div>

        <DsField
          v-if="isEdit && mode === 'change'"
          v-slot="{ id }"
          label="What changed, and on whose order"
          required
        >
          <Input :id="id" v-model="changeReason" placeholder="Dr Okafor increased to 1000 mg, phone order 10:40" />
        </DsField>

        <DsField v-if="!isEdit && !tenantId" v-slot="{ id }" label="Resident" required>
          <Select v-model="tenant">
            <SelectTrigger :id="id" class="w-full">
              <SelectValue placeholder="Choose a resident on the programme" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="r in residents" :key="r.tenantId" :value="r.tenantId">
                {{ r.name }} · Room {{ r.room }}
              </SelectItem>
            </SelectContent>
          </Select>
        </DsField>

        <div class="grid gap-4 sm:grid-cols-[1fr_140px]">
          <DsField v-slot="{ id }" label="Medication" required>
            <Input :id="id" v-model="name" placeholder="Metformin" />
          </DsField>
          <DsField v-slot="{ id }" label="Strength">
            <Input :id="id" v-model="strength" placeholder="500 mg" />
          </DsField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <DsField v-slot="{ id }" label="Dose" required>
            <Input :id="id" v-model="dose" placeholder="1 tablet" />
          </DsField>
          <DsField v-slot="{ id }" label="Route" required>
            <Select v-model="route">
              <SelectTrigger :id="id" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="r in ROUTES" :key="r.value" :value="r.value">{{ r.label }}</SelectItem>
              </SelectContent>
            </Select>
          </DsField>
        </div>

        <DsField v-slot="{ id }" label="Instructions">
          <Input :id="id" v-model="instructions" placeholder="With food; do not crush" />
        </DsField>

        <div class="flex items-center gap-2">
          <Checkbox
            id="prn"
            :model-value="prn"
            @update:model-value="(checked) => (prn = Boolean(checked))"
          />
          <Label for="prn" class="cursor-pointer text-base">As needed (PRN) — no scheduled times</Label>
        </div>

        <template v-if="prn">
          <div class="grid gap-4 sm:grid-cols-[1fr_150px]">
            <DsField v-slot="{ id }" label="Given for" required>
              <Input :id="id" v-model="prnIndication" placeholder="Pain; anxiety; breathlessness" />
            </DsField>
            <DsField v-slot="{ id }" label="Max doses / day" hint="Leave blank for no cap.">
              <Input :id="id" v-model="prnMaxPerDay" type="number" min="1" step="1" inputmode="numeric" />
            </DsField>
          </div>
        </template>

        <DsField
          v-else
          v-slot="{ id }"
          label="Times of day"
          required
          hint="Add each time the dose is due. A dose is on time within an hour either side."
        >
          <div class="flex flex-wrap items-center gap-2">
            <span
              v-for="t in times"
              :key="t"
              class="inline-flex items-center gap-1 rounded-md border border-[var(--border-strong)] bg-[var(--surface-sunken)] py-1 pl-2.5 pr-1 text-sm font-medium tnum"
            >
              {{ formatMinutes(t) }}
              <button
                type="button"
                class="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-[var(--surface-raised)] hover:text-[var(--text-strong)]"
                :aria-label="`Remove ${formatMinutes(t)}`"
                @click="removeTime(t)"
              >
                <DsIcon name="x" :size="12" />
              </button>
            </span>
            <div class="flex items-center gap-1">
              <Input :id="id" v-model="newTime" type="time" class="w-[130px]" @keydown.enter.prevent="addTime" />
              <Button variant="secondary" size="sm" :disabled="!newTime" @click="addTime">
                <DsIcon name="plus" :size="15" />
                Add
              </Button>
            </div>
          </div>
        </DsField>

        <DsField v-slot="{ id }" label="Prescriber">
          <Input :id="id" v-model="prescriber" placeholder="Dr Okafor" />
        </DsField>

        <div class="grid gap-4 sm:grid-cols-2">
          <DsField
            v-slot="{ id }"
            label="Start date"
            required
            :hint="isEdit && mode === 'change' ? 'A change takes effect today.' : undefined"
          >
            <DsDatePicker
              :id="id"
              :model-value="isEdit && mode === 'change' ? today() : startDate"
              class="w-full"
              :class="isEdit && mode === 'change' ? 'pointer-events-none opacity-60' : ''"
              @update:model-value="(v) => (startDate = v ?? today())"
            />
          </DsField>
          <DsField v-slot="{ id }" label="End date" hint="Blank for ongoing.">
            <DsDatePicker
              :id="id"
              :model-value="endDate"
              :min="startDate"
              placeholder="Ongoing"
              clearable
              class="w-full"
              @update:model-value="(v) => (endDate = v ?? '')"
            />
          </DsField>
        </div>

        <p v-if="error" class="text-sm font-medium text-[var(--danger)]">{{ error }}</p>
      </div>

      <DialogFooter
        class="gap-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-[22px] py-4"
      >
        <Button variant="ghost" :disabled="pending" @click="emit('close')">Cancel</Button>
        <Button variant="primary" :loading="pending" @click="save">
          <DsIcon name="check" :size="17" />
          {{ pending ? 'Saving…' : isEdit ? (mode === 'change' ? 'Change prescription' : 'Save correction') : 'Add order' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
