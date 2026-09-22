<script setup lang="ts">
import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../../convex/_generated/api'
import { Checkbox } from '@/components/ui/checkbox'

defineProps<{
  shift: NonNullable<FunctionReturnType<typeof api.care.overview>>['me']
  roleLabel?: string
  disabled?: boolean
}>()
defineEmits<{ toggle: [key: string, done: boolean] }>()
</script>

<template>
  <DsPanel
    :title="shift.dutyTitle"
    :subtitle="`${roleLabel ?? 'Care staff'} · your shift checklist.`"
    :count="`${shift.dutyProgress.done}/${shift.dutyProgress.total}`"
  >
    <p v-if="shift.role === 'health-care-aide'" class="mb-2 text-xs text-muted-foreground">
      Review applicable support against each resident’s care plan. This checklist tracks your shift; record individual care and observations in the shift report.
    </p>
    <label
      v-for="duty in shift.duties" :key="duty.key"
      class="flex cursor-pointer items-start gap-3 border-b border-[var(--border-subtle)] py-3 last:border-0"
    >
      <Checkbox
        :model-value="!!shift.dutyState[duty.key]" :disabled="disabled" class="mt-0.5"
        :aria-label="duty.label"
        @update:model-value="(value) => $emit('toggle', duty.key, !!value)"
      />
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-medium" :class="shift.dutyState[duty.key] ? 'text-muted-foreground line-through' : 'text-[var(--text-strong)]'">
          {{ duty.label }}
        </span>
        <span class="block text-xs text-muted-foreground">{{ duty.meta }}</span>
      </span>
    </label>
    <div v-if="shift.role !== 'health-care-aide'" class="mt-3 border-t border-[var(--border-subtle)] pt-3">
      <span class="eyebrow">From your shift activity</span>
      <p class="mt-1.5 text-xs text-muted-foreground">
        Building rounds and the perimeter are counted from the rounds card — logged by walking them, not ticked off here.
      </p>
    </div>
  </DsPanel>
</template>
