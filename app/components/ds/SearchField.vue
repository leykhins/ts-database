<script setup lang="ts">
/**
 * SearchField — the sunken, icon-led search used in the topbar and screen
 * toolbars. shadcn has no search primitive; this is the design system's own
 * treatment (sunken until focused, then a card surface with the emerald ring).
 */
withDefaults(
  defineProps<{
    modelValue?: string
    placeholder?: string
    width?: number | string
  }>(),
  { placeholder: 'Search…', width: 280 },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: [value: string]
}>()

const focused = ref(false)
</script>

<template>
  <form
    class="flex h-[var(--control-md)] max-w-full items-center gap-2 rounded-md border py-0 pr-2 pl-3 transition-colors duration-[var(--dur-fast)]"
    :class="
      focused
        ? 'border-[var(--border-focus)] bg-card shadow-[var(--focus-ring)]'
        : 'border-transparent bg-[var(--surface-sunken)]'
    "
    :style="{ width: typeof width === 'number' ? `${width}px` : width }"
    @submit.prevent="emit('submit', modelValue ?? '')"
  >
    <DsIcon name="search" :size="16" class="text-muted-foreground" />
    <input
      :value="modelValue"
      :placeholder="placeholder"
      type="search"
      class="min-w-0 flex-1 border-none bg-transparent text-base text-[var(--text-strong)] outline-none placeholder:text-[var(--text-subtle)] [&::-webkit-search-cancel-button]:cursor-pointer"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @focus="focused = true"
      @blur="focused = false"
    >
  </form>
</template>
