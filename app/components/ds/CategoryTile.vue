<script setup lang="ts">
import { Card } from '@/components/ui/card'

/**
 * CategoryTile — icon-led launcher for a functional area. Each area owns a hue;
 * the hue shows up as the glyph over a 7% wash, not as a colour block.
 */
const props = withDefaults(
  defineProps<{
    icon: string
    title: string
    to?: string
    color?: 'teal' | 'blue' | 'green' | 'cyan' | 'indigo' | 'violet' | 'rose' | 'amber' | 'slate'
    count?: string | number
  }>(),
  { color: 'green' },
)

const THEMES: Record<string, string> = {
  teal: 'var(--teal-600)',
  blue: 'var(--blue-600)',
  green: 'var(--emerald-600)',
  cyan: 'var(--cyan-600)',
  indigo: 'var(--indigo-600)',
  violet: 'var(--violet-600)',
  rose: 'var(--rose-600)',
  amber: 'var(--amber-600)',
  slate: 'var(--slate-600)',
}

const hue = computed(() => THEMES[props.color] ?? THEMES.green!)
</script>

<template>
  <Card
    class="p-4 hover:border-[var(--border-hover)] hover:bg-[var(--surface-hover)]"
    :interactive="!!to"
  >
    <component
      :is="to ? resolveComponent('NuxtLink') : 'div'"
      :to="to"
      class="flex items-center gap-3 no-underline hover:no-underline"
    >
      <span
        class="inline-flex size-8 shrink-0 items-center justify-center rounded-sm border"
        :style="{
          background: `color-mix(in srgb, ${hue} var(--wash-strength), var(--surface-card))`,
          color: hue,
        }"
      >
        <DsIcon :name="icon" :size="17" :stroke-width="1.8" />
      </span>
      <div class="min-w-0">
        <h3 class="text-base font-semibold tracking-snug text-[var(--text-strong)]">
          {{ title }}
        </h3>
        <div v-if="count != null" class="tnum mt-0.5 text-xs text-muted-foreground">
          {{ count }}
        </div>
      </div>
    </component>
  </Card>
</template>
