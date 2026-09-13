<script setup lang="ts">
/**
 * The wordmark, drawn inline rather than linked as an `<img>`.
 *
 * Two reasons it is a component and not the SVG file in `public/`: an external
 * SVG is its own document, so it cannot use the webfont the page has loaded —
 * the lettering fell back to whatever generic sans the machine had — and it
 * cannot read a token, so the rail and the pine sign-in panel each needed
 * their own colour-baked copy.
 *
 * Here the tile takes `--brand-mark-bg` / `--brand-mark-ink` and the word takes
 * `currentColor`, so one component sits on sage, on white and on pine.
 */
withDefaults(defineProps<{ compact?: boolean, size?: number }>(), { size: 30 })
</script>

<template>
  <span class="brand" :style="{ '--mark-size': `${size}px` }">
    <span class="brand__tile" aria-hidden="true">TS</span>
    <span v-if="!compact" class="brand__word">Database</span>
    <span v-if="compact" class="sr-only">TS Database</span>
  </span>
</template>

<style scoped>
.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.32em;
  font-size: var(--mark-size);
  line-height: 1;
  color: inherit;
}

.brand__tile {
  display: grid;
  place-items: center;
  width: 1em;
  height: 1em;
  border-radius: 0.27em;
  background: var(--brand-mark-bg, var(--brand));
  color: var(--brand-mark-ink, #ffffff);
  font-family: var(--font-display);
  font-size: var(--mark-size);
  font-weight: 700;
  letter-spacing: -0.04em;
  /* The two letters are the tile's whole content, so they are sized against
     it rather than against the page. */
  font-size: calc(var(--mark-size) * 0.46);
  width: var(--mark-size);
  height: var(--mark-size);
}

.brand__word {
  font-family: var(--font-display);
  font-size: calc(var(--mark-size) * 0.72);
  font-weight: 600;
  letter-spacing: -0.03em;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
