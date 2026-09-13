<script setup lang="ts">
/**
 * StatGrid — the KPI row as one panel, divided, rather than as loose cards.
 *
 * Four separated cards read as four unrelated things; one bordered block with
 * hairlines between the cells reads as a single summary of one building, which
 * is what it is. It is also quieter: one outline and one radius on the row
 * instead of four of each.
 *
 * The hairlines are the container's own background showing through a 1px grid
 * gap, not borders on the cells. That matters because the row wraps — with
 * per-cell borders every breakpoint needs its own `nth-child` arithmetic to
 * avoid a divider dangling off the end of a short last row, and the gap draws
 * itself correctly at any column count.
 *
 * Children are expected to be `DsStatCard`s; their own border and radius are
 * stripped here so the card does not have to know whether it is standing alone
 * or in a row.
 */
withDefaults(defineProps<{ min?: number }>(), { min: 190 })
</script>

<template>
  <div class="stat-grid" :style="{ '--stat-min': `${min}px` }">
    <slot />
  </div>
</template>

<style scoped>
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--stat-min), 1fr));
  gap: 1px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--border);
}

.stat-grid > :deep(*) {
  border: 0;
  border-radius: 0;
  background: var(--surface-card);
  box-shadow: none;
}
</style>
