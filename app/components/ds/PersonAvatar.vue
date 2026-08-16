<script setup lang="ts">
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

/**
 * PersonAvatar — identity for residents and staff.
 *
 * shadcn's Avatar handles the image/fallback mechanics; what the design system
 * adds is the *identity colour*: a hue derived from the person's name so the
 * same person is the same colour on every screen and across sessions. No stock
 * photography anywhere in this product — initials are the house style.
 */
const props = withDefaults(
  defineProps<{
    name: string
    src?: string
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
    status?: 'online' | 'away' | 'offline' | 'alert'
  }>(),
  { size: 'md' },
)

const SIZE = {
  xs: 'size-6 text-[10px]',
  sm: 'size-[30px] text-xs',
  md: 'size-[38px] text-base',
  lg: 'size-12 text-[17px]',
  xl: 'size-16 text-[22px]',
} as const

const DOT = {
  xs: 'size-2',
  sm: 'size-2',
  md: 'size-2.5',
  lg: 'size-3',
  xl: 'size-4',
} as const

const PALETTE = [
  'var(--emerald-600)',
  'var(--blue-600)',
  'var(--violet-600)',
  'var(--teal-600)',
  'var(--amber-600)',
  'var(--rose-600)',
  'var(--indigo-600)',
]

const STATUS_COLOR: Record<string, string> = {
  online: 'var(--success)',
  away: 'var(--warning)',
  offline: 'var(--slate-400)',
  alert: 'var(--danger)',
}

function hashHue(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360
  return h
}

const initials = computed(() =>
  props.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join(''),
)

const accent = computed(() => PALETTE[hashHue(props.name) % PALETTE.length]!)
</script>

<template>
  <span class="relative inline-flex shrink-0">
    <Avatar :class="SIZE[size]">
      <AvatarImage v-if="src" :src="src" :alt="name" />
      <AvatarFallback
        class="font-bold tracking-[-0.01em]"
        :style="{
          background: `color-mix(in srgb, ${accent} 12%, var(--surface-card))`,
          color: accent,
          boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} 20%, transparent)`,
        }"
      >
        {{ initials }}
      </AvatarFallback>
    </Avatar>
    <span
      v-if="status"
      class="absolute -right-px -bottom-px rounded-full border-2 border-[var(--surface-card)]"
      :class="DOT[size]"
      :style="{ background: STATUS_COLOR[status] }"
    />
  </span>
</template>
