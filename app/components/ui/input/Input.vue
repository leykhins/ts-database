<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { useVModel } from "@vueuse/core"
import { cn } from "@/lib/utils"

/** Control heights and the 2px-gap emerald focus ring come from the design system. */
const props = withDefaults(
  defineProps<{
    defaultValue?: string | number
    modelValue?: string | number
    inputSize?: "sm" | "md" | "lg"
    class?: HTMLAttributes["class"]
  }>(),
  { inputSize: "md" },
)

const emits = defineEmits<{
  (e: "update:modelValue", payload: string | number): void
}>()

const modelValue = useVModel(props, "modelValue", emits, {
  passive: true,
  defaultValue: props.defaultValue,
})

const HEIGHT = {
  sm: "h-[var(--control-sm)]",
  md: "h-[var(--control-md)]",
  lg: "h-[var(--control-lg)]",
} as const
</script>

<template>
  <input
    v-model="modelValue"
    data-slot="input"
    :class="cn(
      'w-full min-w-0 rounded-md border border-[var(--border-strong)] bg-card px-3 text-base text-[var(--text-strong)]',
      'placeholder:text-[var(--text-subtle)] transition-[color,box-shadow,border-color] outline-none',
      'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
      'focus-visible:border-[var(--border-focus)] focus-visible:shadow-[var(--focus-ring)]',
      'aria-invalid:border-destructive aria-invalid:focus-visible:shadow-[0_0_0_3px_var(--danger-soft)]',
      HEIGHT[inputSize],
      props.class,
    )"
  >
</template>
