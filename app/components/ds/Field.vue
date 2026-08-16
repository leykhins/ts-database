<script setup lang="ts">
import { Label } from '@/components/ui/label'

/**
 * Field — label / control / hint / error wrapper.
 *
 * shadcn leaves form composition to the caller (or to its Form component, which
 * pulls in vee-validate). TS Database forms are small and imperative, so this
 * is the lighter house wrapper: it owns the label association and is the one
 * place validation copy appears.
 */
const props = defineProps<{
  label?: string
  hint?: string
  error?: string
  required?: boolean
  fieldId?: string
}>()

const fallbackId = useId()
const controlId = computed(() => props.fieldId ?? fallbackId)
</script>

<template>
  <div class="flex flex-col gap-2">
    <Label
      v-if="label"
      :for="controlId"
      class="text-sm font-semibold text-[var(--text-strong)]"
    >
      {{ label }}<span v-if="required" class="ml-0.5 text-destructive">*</span>
    </Label>

    <slot :id="controlId" />

    <span v-if="error" class="inline-flex items-center gap-1 text-xs text-destructive">
      <DsIcon name="alert-circle" :size="13" /> {{ error }}
    </span>
    <span v-else-if="hint" class="text-xs text-muted-foreground">{{ hint }}</span>
  </div>
</template>
