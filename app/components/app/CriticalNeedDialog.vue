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

/** CriticalNeedDialog — open a case, or edit the one on file. */
const props = defineProps<{
  open: boolean
  residents: { _id: Id<'tenants'>; name: string; room: string }[]
  /** Present when editing; absent when opening a new case. */
  need: {
    _id: Id<'criticalNeeds'>
    tenantId: Id<'tenants'>
    name: string
    summary: string
    detail?: string
    caseManager?: string
  } | null
  /** Pre-selects the resident when opened from their profile. */
  tenantId?: Id<'tenants'> | null
}>()

const emit = defineEmits<{ close: [] }>()

const { mutate: openNeed, pending: openPending } = useConvexMutation(api.needs.open)
const { mutate: updateNeed, pending: updatePending } = useConvexMutation(api.needs.update)

const tenant = ref<string>('')
const summary = ref('')
const detail = ref('')
const caseManager = ref('')
const error = ref('')

const isEdit = computed(() => props.need !== null)
const pending = computed(() => openPending.value || updatePending.value)

watch(
  () => [props.open, props.need, props.tenantId] as const,
  ([open, need, tenantId]) => {
    if (!open) return
    tenant.value = need?.tenantId ?? tenantId ?? ''
    summary.value = need?.summary ?? ''
    detail.value = need?.detail ?? ''
    caseManager.value = need?.caseManager ?? ''
    error.value = ''
  },
  { immediate: true },
)

async function save() {
  error.value = ''
  if (!summary.value.trim()) {
    error.value = 'Summarise the need in one line.'
    return
  }

  try {
    if (props.need) {
      await updateNeed({
        needId: props.need._id,
        summary: summary.value.trim(),
        detail: detail.value.trim(),
        caseManager: caseManager.value.trim(),
      })
      toast.success('Case updated')
    } else {
      if (!tenant.value) {
        error.value = 'Choose the resident this case is about.'
        return
      }
      await openNeed({
        tenantId: tenant.value as Id<'tenants'>,
        summary: summary.value.trim(),
        detail: detail.value.trim() || undefined,
        caseManager: caseManager.value.trim() || undefined,
      })
      toast.success('Case opened')
    }
    emit('close')
  } catch (e) {
    error.value = (e as Error).message || 'Could not save the case.'
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
          class="inline-flex size-[38px] shrink-0 items-center justify-center rounded-md bg-rose-50 text-rose-700"
        >
          <DsIcon name="heart-pulse" :size="20" />
        </span>
        <div class="min-w-0 flex-1 text-left">
          <DialogTitle class="text-lg font-semibold text-[var(--text-strong)]">
            {{ isEdit ? 'Edit case' : 'Open a case' }}
          </DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground">
            {{ need?.name ?? 'Critical needs are the queue the building works from.' }}
          </DialogDescription>
        </div>
      </DialogHeader>

      <div class="flex flex-col gap-4 p-[22px]">
        <DsField v-if="!isEdit" v-slot="{ id }" label="Resident" required>
          <Select v-model="tenant">
            <SelectTrigger :id="id" class="w-full">
              <SelectValue placeholder="Choose a resident" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="r in residents" :key="r._id" :value="r._id">
                {{ r.name }} · Room {{ r.room }}
              </SelectItem>
            </SelectContent>
          </Select>
        </DsField>

        <DsField v-slot="{ id }" label="Summary" required :error="error">
          <Input
            :id="id"
            v-model="summary"
            placeholder="Missed medication run; hospital discharge follow-up"
            :aria-invalid="!!error"
          />
        </DsField>

        <DsField v-slot="{ id }" label="Detail">
          <Input :id="id" v-model="detail" placeholder="What has been done so far" />
        </DsField>

        <DsField v-slot="{ id }" label="Case manager">
          <Input :id="id" v-model="caseManager" placeholder="Name of the worker on this" />
        </DsField>
      </div>

      <DialogFooter
        class="gap-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-[22px] py-4"
      >
        <Button variant="ghost" :disabled="pending" @click="emit('close')">Cancel</Button>
        <Button variant="primary" :loading="pending" @click="save">
          <DsIcon name="check" :size="17" />
          {{ pending ? 'Saving…' : isEdit ? 'Save case' : 'Open case' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
