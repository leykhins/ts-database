<script setup lang="ts">
/**
 * Panel — the Evergreen card.
 *
 * Different from `Card` on purpose. `Card` leads with an icon tile and an
 * uppercase eyebrow, which suits a screen you scan; a panel leads with a
 * sentence and a count, which suits a screen you work through. The heading is
 * a plain question or instruction ("Who to look out for"), the number that
 * answers it sits inline as a bubble, and a quiet line underneath says what
 * the panel is for.
 *
 * Three regions, all optional but the body:
 *   heading — title, count bubble, subtitle, and an `action` slot on the right
 *   body    — `flush` when the content draws its own edges (a table, a grid)
 *   footer  — one full-width link, ruled off, that leads out of the panel
 *
 * Body font for the title rather than the display face: at 14px Bricolage's
 * personality reads as a wobble, and a panel heading is a label, not a voice.
 */
withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    /** Shown inline after the title. `0` still renders — "0 left" is an answer. */
    count?: number | string | null
    /** Drop the body's own padding when the content is edge-to-edge. */
    flush?: boolean
  }>(),
  { flush: false },
)
</script>

<template>
  <section class="panel">
    <div v-if="title || $slots.heading || $slots.action" class="panel__heading">
      <slot name="heading">
        <div class="min-w-0">
          <h2 class="panel__title">
            {{ title }}
            <span v-if="count !== undefined && count !== null" class="panel__count">{{ count }}</span>
          </h2>
          <p v-if="subtitle" class="panel__subtitle">{{ subtitle }}</p>
        </div>
      </slot>
      <div v-if="$slots.action" class="panel__action">
        <slot name="action" />
      </div>
    </div>

    <div :class="flush ? 'panel__body--flush' : 'panel__body'">
      <slot />
    </div>

    <div v-if="$slots.footer" class="panel__footer">
      <slot name="footer" />
    </div>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  background: var(--surface-card);
}

.panel__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 20px 21px 16px;
}

.panel__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: -0.25px;
  color: var(--text-strong);
}

.panel__count {
  min-width: 19px;
  padding: 0 5px;
  border-radius: 5px;
  background: var(--surface-sunken);
  color: var(--text-muted);
  font-size: 9px;
  font-weight: 500;
  line-height: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.panel__subtitle {
  margin-top: 5px;
  font-size: 10px;
  line-height: 1.6;
  color: var(--text-muted);
}

.panel__action {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
}

.panel__body {
  flex: 1;
  padding: 0 21px 18px;
  min-width: 0;
}

/* A panel with no heading has nothing above the body to space it from. */
.panel__heading + .panel__body,
.panel__heading + .panel__body--flush {
  padding-top: 0;
}

.panel:not(:has(.panel__heading)) .panel__body {
  padding-top: 20px;
}

.panel__body--flush {
  flex: 1;
  min-width: 0;
}

.panel__footer {
  border-top: 1px solid var(--border);
}

/* The footer is one link across the full width — styled here rather than at
   each call site so every panel's way out looks the same. */
.panel__footer :deep(> *) {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: 100%;
  min-height: 41px;
  padding: 12px 15px;
  font-size: 10px;
  font-weight: 500;
  color: var(--brand);
  text-decoration: none;
  transition: background-color var(--dur-base, 150ms) var(--ease-out, ease);
}

.panel__footer :deep(> *:hover) {
  background: var(--surface-sunken);
  text-decoration: none;
}
</style>
