<script setup lang="ts">
/**
 * SupportMeter — how much care a resident needs, as a four-segment meter.
 *
 * A core domain concept rather than a generic progress bar: the levels are
 * fixed, named, and the wording is the one staff and case managers use.
 */
const props = withDefaults(
  defineProps<{
    level?: 'independent' | 'moderate' | 'high' | 'critical'
    showLabel?: boolean
    size?: 'sm' | 'md'
  }>(),
  { level: 'moderate', showLabel: true, size: 'md' },
)

const LEVELS = [
  { key: 'independent', label: 'Independent', color: 'var(--green-600)' },
  { key: 'moderate', label: 'Moderate', color: 'var(--amber-500)' },
  { key: 'high', label: 'High', color: 'var(--amber-600)' },
  { key: 'critical', label: 'Critical', color: 'var(--red-600)' },
] as const

const index = computed(() => Math.max(0, LEVELS.findIndex((l) => l.key === props.level)))
const active = computed(() => LEVELS[index.value] ?? LEVELS[1])
</script>

<template>
  <div class="inline-flex items-center gap-3">
    <div
      class="flex gap-[3px]"
      role="meter"
      :aria-label="`Support level: ${active.label}`"
    >
      <span
        v-for="(l, i) in LEVELS"
        :key="l.key"
        class="rounded-full transition-[background-color] duration-[var(--dur-base)]"
        :class="size === 'sm' ? 'h-1.5 w-5' : 'h-2 w-7'"
        :style="{ background: i <= index ? active.color : 'var(--slate-200)' }"
      />
    </div>
    <span
      v-if="showLabel"
      class="text-xs font-bold whitespace-nowrap"
      :style="{ color: active.color }"
    >
      {{ active.label }}
    </span>
  </div>
</template>
