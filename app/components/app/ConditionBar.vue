<script setup lang="ts">
/**
 * ConditionBar — the at-a-glance strip the legacy system led with.
 *
 * Staff read this before knocking, so it is a fixed scale rather than free
 * text, and "none" is shown as "not recorded" rather than as a pass. A blank
 * that looks like a green light is the failure mode worth designing against.
 */
withDefaults(
  defineProps<{
    flags: {
      houseAbility?: string
      mental?: string
      physical?: string
      pest?: string
      clutter?: string
    }
    compact?: boolean
  }>(),
  { compact: false },
)

const FIELDS = [
  { key: 'houseAbility', label: 'House-ability' },
  { key: 'mental', label: 'Mental' },
  { key: 'physical', label: 'Physical' },
  { key: 'pest', label: 'Pest' },
  { key: 'clutter', label: 'Clutter' },
] as const

/**
 * A hairline of the tone as well as the wash.
 *
 * The wash alone is a few percent of the hue over the card, which separates a
 * chip from the surface in light mode and all but disappears on a dark one —
 * five chips became five faint smudges. The border carries the tone at full
 * strength, so the chip has an edge whatever it is sitting on.
 */
const TONE: Record<string, { bg: string, fg: string, border: string, label: string }> = {
  green: { bg: 'var(--green-50)', fg: 'var(--green-700)', border: 'var(--green-500)', label: 'Green' },
  amber: { bg: 'var(--amber-50)', fg: 'var(--amber-700)', border: 'var(--amber-500)', label: 'Amber' },
  red: { bg: 'var(--red-50)', fg: 'var(--red-700)', border: 'var(--red-500)', label: 'Red' },
  none: { bg: 'var(--surface-sunken)', fg: 'var(--text-muted)', border: 'var(--border)', label: 'Not recorded' },
}

function tone(value: string | undefined) {
  return TONE[value ?? 'none'] ?? TONE.none!
}
</script>

<template>
  <div
    class="flex flex-wrap gap-1.5"
    role="group"
    aria-label="Room and resident condition"
  >
    <span
      v-for="field in FIELDS"
      :key="field.key"
      class="inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5"
      :style="{
        background: tone(flags[field.key]).bg,
        color: tone(flags[field.key]).fg,
        borderColor: `color-mix(in srgb, ${tone(flags[field.key]).border} 45%, transparent)`,
      }"
    >
      <span
        class="size-2 shrink-0 rounded-full"
        :style="{
          background: flags[field.key] && flags[field.key] !== 'none'
            ? 'currentColor'
            : 'var(--border-strong)',
        }"
      />
      <span class="text-2xs font-bold uppercase tracking-[0.06em]">{{ field.label }}</span>
      <span v-if="!compact" class="text-xs font-semibold">
        {{ tone(flags[field.key]).label }}
      </span>
    </span>
  </div>
</template>
