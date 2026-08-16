<script setup lang="ts">
import { resolveIcon } from '~/utils/icons'

/**
 * Icon — a Hugeicons glyph as inline SVG, addressed by the design system's
 * semantic name ("shield-check", "heart-pulse").
 *
 * Stroke width comes from the prop rather than the glyph data, so one icon can
 * sit at 1.5 in body text and 2.4 when emphasised. An unknown name renders a
 * neutral placeholder rather than throwing — a missing glyph should never take
 * a shift-critical screen down.
 */
const props = withDefaults(
  defineProps<{
    name: string
    size?: number
    strokeWidth?: number
  }>(),
  { size: 18, strokeWidth: 1.5 },
)

/** React-style attribute names in the icon data → SVG attribute names. */
function toAttrName(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

const children = computed(() => {
  const nodes = resolveIcon(props.name)
  if (!nodes) return null
  return nodes.map(([tag, attrs]) => {
    const out: Record<string, string | number> = {}
    for (const [k, value] of Object.entries(attrs)) {
      // `key` is React bookkeeping; stroke and width belong to the <svg> so the
      // strokeWidth prop actually takes effect.
      if (k === 'key' || k === 'stroke' || k === 'strokeWidth') continue
      out[toAttrName(k)] = value
    }
    return { tag, attrs: out }
  })
})
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="block shrink-0"
    aria-hidden="true"
  >
    <template v-if="children">
      <component :is="node.tag" v-for="(node, i) in children" :key="i" v-bind="node.attrs" />
    </template>
    <rect v-else x="4" y="4" width="16" height="16" rx="3" opacity="0.25" />
  </svg>
</template>
