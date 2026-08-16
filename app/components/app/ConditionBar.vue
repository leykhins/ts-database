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

const TONE: Record<string, { bg: string; fg: string; label: string }> = {
  green: { bg: 'var(--green-50)', fg: 'var(--green-700)', label: 'Green' },
  amber: { bg: 'var(--amber-50)', fg: 'var(--amber-700)', label: 'Amber' },
  red: { bg: 'var(--red-50)', fg: 'var(--red-700)', label: 'Red' },
  none: { bg: 'var(--surface-sunken)', fg: 'var(--text-subtle)', label: 'Not recorded' },
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
      class="inline-flex items-center gap-2 rounded-md px-2.5 py-1.5"
      :style="{ background: tone(flags[field.key]).bg, color: tone(flags[field.key]).fg }"
    >
      <span
        class="size-2 shrink-0 rounded-full"
        :style="{
          background: flags[field.key] && flags[field.key] !== 'none'
            ? 'currentColor'
            : 'var(--slate-300)',
        }"
      />
      <span class="text-2xs font-bold uppercase tracking-[0.06em]">{{ field.label }}</span>
      <span v-if="!compact" class="text-xs font-semibold">
        {{ tone(flags[field.key]).label }}
      </span>
    </span>
  </div>
</template>
