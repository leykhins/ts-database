<script setup lang="ts">
/**
 * Sparkline — the shape of a number's recent past, small enough to sit beside
 * the number itself.
 *
 * It answers "is this better or worse than usual", never "what was it on
 * Tuesday": there are no axes, and the scale is the series' own range, so a
 * move of three points reads as a move. That is the right trade on a KPI tile
 * and the wrong one anywhere a reader has to compare magnitudes — use a real
 * chart there.
 *
 * The line is the de-emphasis ink and only the latest point wears the accent,
 * because the latest point is the number printed above it. Hovering reads a
 * point back; the same values are in the accessible description, so the hover
 * is a convenience and never the only way to them.
 */
const props = withDefaults(
  defineProps<{
    points: { label: string; value: number }[]
    /** Pin the scale when the metric has a natural range (a percentage). */
    min?: number
    max?: number
    /** How a value is printed in the readout and the description. */
    format?: (value: number) => string
    /** Names the series for assistive tech: "Wellness Index, last 8 shifts". */
    label: string
  }>(),
  { format: (value: number) => String(value) },
)

const W = 96
const H = 28
// Room for the endpoint dot and a 2px stroke, so neither is clipped at the edge.
const PAD = 3

const geometry = computed(() => {
  const values = props.points.map((p) => p.value)
  const lo = props.min ?? Math.min(...values)
  const hi = props.max ?? Math.max(...values)
  // A flat series has no range to divide by; draw it through the middle rather
  // than pinning it to the floor, where it would read as "collapsed to zero".
  const span = hi - lo || 1
  const step = values.length > 1 ? (W - PAD * 2) / (values.length - 1) : 0

  return values.map((value, i) => ({
    x: PAD + i * step,
    y: hi === lo ? H / 2 : PAD + (1 - (value - lo) / span) * (H - PAD * 2),
  }))
})

const path = computed(() =>
  geometry.value.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
)

const last = computed(() => geometry.value.at(-1))

const description = computed(
  () =>
    `${props.label}: ${props.points.map((p) => `${p.label} ${props.format(p.value)}`).join(', ')}.`,
)

const hovered = ref<number | null>(null)

function onMove(event: PointerEvent) {
  const box = (event.currentTarget as SVGElement).getBoundingClientRect()
  const x = ((event.clientX - box.left) / box.width) * W
  let nearest = 0
  geometry.value.forEach((p, i) => {
    if (Math.abs(p.x - x) < Math.abs(geometry.value[nearest]!.x - x)) nearest = i
  })
  hovered.value = nearest
}
</script>

<template>
  <!-- One point is not a trend; say nothing rather than draw a dot. -->
  <span v-if="points.length > 1" class="sparkline">
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      role="img"
      :aria-label="description"
      class="sparkline__svg"
      @pointermove="onMove"
      @pointerleave="hovered = null"
    >
      <path :d="path" class="sparkline__line" />
      <line
        v-if="hovered !== null"
        :x1="geometry[hovered]!.x"
        :x2="geometry[hovered]!.x"
        :y1="0"
        :y2="H"
        class="sparkline__crosshair"
      />
      <circle
        v-if="hovered !== null"
        :cx="geometry[hovered]!.x"
        :cy="geometry[hovered]!.y"
        r="2.5"
        class="sparkline__hover"
      />
      <circle v-if="last" :cx="last.x" :cy="last.y" r="2.5" class="sparkline__now" />
    </svg>
    <span v-if="hovered !== null" class="sparkline__readout tnum" aria-hidden="true">
      {{ points[hovered]!.label }} · {{ format(points[hovered]!.value) }}
    </span>
  </span>
</template>

<style scoped>
.sparkline {
  position: relative;
  display: inline-flex;
}

.sparkline__svg {
  width: 96px;
  height: 28px;
  overflow: visible;
}

.sparkline__line {
  fill: none;
  stroke: var(--border-strong);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.sparkline__now {
  fill: var(--brand);
  stroke: var(--surface-card);
  stroke-width: 2;
}

.sparkline__crosshair {
  stroke: var(--border);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.sparkline__hover {
  fill: var(--text-muted);
  stroke: var(--surface-card);
  stroke-width: 2;
}

/* Above the line, right-aligned to it, so the pointer never covers the text. */
.sparkline__readout {
  position: absolute;
  right: 0;
  bottom: calc(100% + 4px);
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--text-strong);
  color: var(--surface-card);
  font-size: 10px;
  line-height: 1.5;
  white-space: nowrap;
  pointer-events: none;
}
</style>
