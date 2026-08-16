<script setup lang="ts">
/** SectionHeader — page/section title block with eyebrow, description, actions. */
withDefaults(
  defineProps<{
    title: string
    eyebrow?: string
    description?: string
    size?: 'md' | 'lg'
  }>(),
  { size: 'md' },
)
</script>

<template>
  <div class="flex flex-wrap items-end justify-between gap-4">
    <div class="flex min-w-0 flex-col gap-1">
      <span v-if="eyebrow" class="eyebrow">{{ eyebrow }}</span>
      <h2
        class="text-[var(--text-strong)] tracking-tight"
        :class="size === 'lg' ? 'text-2xl font-bold' : 'text-xl font-bold'"
      >
        {{ title }}
      </h2>
      <p v-if="description" class="max-w-[60ch] text-base text-muted-foreground">
        {{ description }}
      </p>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
