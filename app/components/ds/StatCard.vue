<script setup lang="ts">
import { Card } from '@/components/ui/card'

/**
 * StatCard — a KPI tile. Label leads, the number dominates, and the category
 * hue appears only as the small icon glyph: never as a filled block.
 */
const props = withDefaults(
  defineProps<{
    label: string
    value: string | number
    icon?: string
    sublabel?: string
    accent?: 'brand' | 'teal' | 'blue' | 'cyan' | 'indigo' | 'violet' | 'rose' | 'amber'
    trend?: string
    trendDir?: 'up' | 'down'
  }>(),
  { accent: 'brand' },
)

const ACCENTS: Record<string, string> = {
  brand: 'var(--emerald-600)',
  teal: 'var(--teal-600)',
  blue: 'var(--blue-600)',
  cyan: 'var(--cyan-600)',
  indigo: 'var(--indigo-600)',
  violet: 'var(--violet-600)',
  rose: 'var(--rose-600)',
  amber: 'var(--amber-600)',
}

const color = computed(() => ACCENTS[props.accent] ?? ACCENTS.brand!)
const trendColor = computed(() =>
  props.trendDir === 'up'
    ? 'var(--success)'
    : props.trendDir === 'down'
      ? 'var(--danger)'
      : 'var(--text-muted)',
)
</script>

<template>
  <Card class="gap-3 p-5">
    <div class="flex items-center gap-2" :style="{ color }">
      <DsIcon v-if="icon" :name="icon" :size="15" :stroke-width="2" />
      <span class="text-sm text-muted-foreground">{{ label }}</span>
    </div>

    <div>
      <div class="flex flex-wrap items-baseline gap-2">
        <span class="tnum text-2xl font-extrabold tracking-tight text-[var(--text-strong)]">
          {{ value }}
        </span>
        <span
          v-if="trend"
          class="inline-flex items-center gap-0.5 text-xs font-semibold"
          :style="{ color: trendColor }"
        >
          <DsIcon
            v-if="trendDir"
            :name="trendDir === 'up' ? 'trending-up' : 'trending-down'"
            :size="13"
          />
          {{ trend }}
        </span>
      </div>
      <div v-if="sublabel" class="mt-1 text-xs text-[var(--text-subtle)]">{{ sublabel }}</div>
    </div>
  </Card>
</template>
