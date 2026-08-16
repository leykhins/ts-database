<script setup lang="ts">
/** EmptyState — placeholder for empty rosters, queues and searches. */
withDefaults(
  defineProps<{
    title?: string
    description?: string
    icon?: string
    accent?: string
  }>(),
  { icon: 'inbox', accent: 'var(--brand)' },
)
</script>

<template>
  <div class="flex flex-col items-center gap-3 px-6 py-10 text-center">
    <span
      class="inline-flex size-14 items-center justify-center rounded-xl"
      :style="{
        background: `color-mix(in srgb, ${accent} 12%, transparent)`,
        color: accent,
      }"
    >
      <DsIcon :name="icon" :size="26" />
    </span>
    <div class="flex max-w-[42ch] flex-col gap-1">
      <h3 v-if="title" class="text-lg font-semibold text-[var(--text-strong)]">{{ title }}</h3>
      <p v-if="description" class="text-base text-muted-foreground">{{ description }}</p>
    </div>
    <div v-if="$slots.action" class="mt-2">
      <slot name="action" />
    </div>
  </div>
</template>
