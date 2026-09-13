<script setup lang="ts">
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

/**
 * StatCard — a KPI tile. Label leads, the number dominates, and the category
 * hue appears only as the small icon glyph: never as a filled block.
 *
 * Everything past `sublabel` is optional and additive, so a plain tile stays a
 * plain tile. The richer form carries up to three extra readings of the same
 * number, each answering a different question:
 *
 *  - `denominator` / `progress` — how far through is this? ("31 / 44")
 *  - `delta` — better or worse than the period before, and by how much.
 *  - `series` — is that change a blip or the direction of travel?
 *
 * A tile should use the ones that are true of its number and no more. A count
 * with no ceiling has no progress bar; a snapshot with no history has no line.
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

    /** Printed small after the value: `%`, `/ 44`. */
    unit?: string
    denominator?: string | number
    badge?: string
    badgeTone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger'

    /** Signed change against `deltaPeriod`. `null` means there is nothing to compare with. */
    delta?: number | null
    deltaPeriod?: string
    deltaUnit?: string
    /** Which way is good. Fewer overdue checks going *down* is the good news. */
    goodWhen?: 'up' | 'down'

    /** 0–100. The meter along the tile's foot. */
    progress?: number
    progressTone?: 'brand' | 'success' | 'warning' | 'danger'

    series?: { label: string; value: number }[]
    seriesLabel?: string
    seriesMin?: number
    seriesMax?: number
    seriesFormat?: (value: number) => string

    /** Makes the whole tile the way into the thing it counts. */
    to?: string
  }>(),
  { accent: 'brand', goodWhen: 'up', deltaUnit: '', progressTone: 'brand' },
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

const TONES: Record<string, string> = {
  brand: 'var(--brand)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
}

const color = computed(() => ACCENTS[props.accent] ?? ACCENTS.brand!)
const trendColor = computed(() =>
  props.trendDir === 'up'
    ? 'var(--success)'
    : props.trendDir === 'down'
      ? 'var(--danger)'
      : 'var(--text-muted)',
)

/**
 * A delta's colour is its direction *times* whether that direction is good —
 * never direction alone. Painting every rise green would congratulate a shift
 * on a climbing count of missed checks.
 */
const deltaState = computed(() => {
  const d = props.delta
  if (d === undefined || d === null) return null
  if (d === 0) return { icon: 'minus', color: 'var(--text-muted)', text: 'No change' }
  const good = (d > 0) === (props.goodWhen === 'up')
  return {
    icon: d > 0 ? 'arrow-up-right' : 'arrow-down-right',
    color: good ? 'var(--success)' : 'var(--danger)',
    text: `${Math.abs(d)}${props.deltaUnit}`,
  }
})

const meter = computed(() =>
  props.progress === undefined ? null : Math.max(0, Math.min(100, props.progress)),
)

const NuxtLink = resolveComponent('NuxtLink')
</script>

<template>
  <component
    :is="to ? NuxtLink : 'section'"
    :to="to"
    data-slot="card"
    :class="
      cn(
        'stat-card bg-card text-card-foreground relative flex flex-col gap-3 overflow-hidden rounded-lg border p-5',
        to && 'stat-card--link',
        meter !== null && 'pb-6',
      )
    "
  >
    <div class="flex items-center gap-2" :style="{ color }">
      <DsIcon v-if="icon" :name="icon" :size="15" :stroke-width="2" />
      <span class="text-sm text-muted-foreground">{{ label }}</span>
    </div>

    <div class="flex items-end gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span class="tnum text-2xl font-extrabold tracking-tight text-[var(--text-strong)]">
            {{ value }}<span v-if="unit" class="stat-card__unit">{{ unit }}</span><span
              v-if="denominator !== undefined"
              class="stat-card__denominator"
            >/ {{ denominator }}</span>
          </span>
          <Badge v-if="badge" :variant="badgeTone ?? 'neutral'" class="self-center">{{ badge }}</Badge>
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

        <div
          v-if="sublabel || deltaState"
          class="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-[var(--text-subtle)]"
        >
          <span
            v-if="deltaState"
            class="tnum inline-flex items-center gap-px font-semibold"
            :style="{ color: deltaState.color }"
          >
            <DsIcon :name="deltaState.icon" :size="13" :stroke-width="2.25" />{{ deltaState.text }}
          </span>
          <span v-if="deltaState && deltaPeriod">{{ deltaPeriod }}</span>
          <span v-if="sublabel && deltaState" aria-hidden="true" class="stat-card__sep" />
          <span v-if="sublabel">{{ sublabel }}</span>
        </div>
      </div>

      <DsSparkline
        v-if="series?.length"
        class="mb-0.5 shrink-0"
        :points="series"
        :label="seriesLabel ?? label"
        :min="seriesMin"
        :max="seriesMax"
        :format="seriesFormat"
      />
    </div>

    <!--
      The meter. Its track is a pale step of its own fill rather than a neutral
      grey, so the whole bar reads as one state — a mostly-empty amber bar still
      says "amber" at a glance.
    -->
    <div
      v-if="meter !== null"
      class="stat-card__meter"
      role="progressbar"
      :aria-label="`${label} progress`"
      :aria-valuenow="Math.round(meter)"
      aria-valuemin="0"
      aria-valuemax="100"
      :style="{ '--meter-tone': TONES[progressTone] }"
    >
      <i :style="{ width: `${meter}%` }" />
    </div>
  </component>
</template>

<style scoped>
.stat-card__unit {
  margin-left: 1px;
  font-size: 0.65em;
  font-weight: 700;
}

.stat-card__denominator {
  margin-left: 5px;
  font-size: 0.62em;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--text-subtle);
}

.stat-card__sep {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.6;
}

.stat-card--link {
  color: inherit;
  text-decoration: none;
  transition: background-color var(--dur-fast, 120ms) ease;
}

.stat-card--link:hover {
  background: color-mix(in srgb, var(--surface-sunken) 45%, var(--surface-card));
  text-decoration: none;
}

.stat-card--link:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: -2px;
}

.stat-card__meter {
  position: absolute;
  left: 20px;
  right: 20px;
  bottom: 12px;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--meter-tone) 16%, var(--surface-sunken));
}

.stat-card__meter > i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--meter-tone);
  transition: width 400ms cubic-bezier(0.2, 0, 0, 1);
}

@media (prefers-reduced-motion: reduce) {
  .stat-card__meter > i {
    transition: none;
  }
}
</style>
