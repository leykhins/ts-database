<script setup lang="ts">
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * A resident's face, wherever their name appears.
 *
 * Shows the photo when there is one and initials when there is not, and opens
 * the app-wide viewer on click. Falls back to a plain avatar when `expandable`
 * is off, for the places where a click already means something else.
 */
const props = withDefaults(
  defineProps<{
    name: string
    tenantId?: Id<'tenants'> | null
    photoUrl?: string | null
    room?: string | null
    supportLevel?: string | null
    critical?: boolean
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
    status?: 'online' | 'alert'
    expandable?: boolean
  }>(),
  { size: 'sm', expandable: true },
)

const { open } = useResidentPhoto()

const SIZE: Record<string, string> = {
  xs: 'size-6',
  sm: 'size-[30px]',
  md: 'size-[38px]',
  lg: 'size-12',
  xl: 'size-16',
}

function expand(event: MouseEvent) {
  if (!props.expandable) return
  // Rows are often links or clickable; looking at a face should not navigate.
  event.preventDefault()
  event.stopPropagation()
  open({
    tenantId: props.tenantId ?? null,
    name: props.name,
    room: props.room ?? null,
    photoUrl: props.photoUrl ?? null,
    supportLevel: props.supportLevel ?? null,
    critical: props.critical,
  })
}
</script>

<template>
  <component
    :is="expandable ? 'button' : 'span'"
    :type="expandable ? 'button' : undefined"
    :aria-label="expandable ? `See ${name}’s photo` : undefined"
    :title="expandable ? `See ${name}’s photo` : undefined"
    class="relative inline-flex shrink-0 rounded-full"
    :class="expandable && 'cursor-pointer outline-none focus-visible:shadow-[var(--focus-ring)]'"
    @click="expand"
  >
    <img
      v-if="photoUrl"
      :src="photoUrl"
      :alt="name"
      class="rounded-full border border-[var(--border)] object-cover"
      :class="SIZE[size]"
    >
    <DsPersonAvatar v-else :name="name" :size="size" :status="status" />

    <span
      v-if="photoUrl && status === 'alert'"
      class="absolute -bottom-px -right-px size-2.5 rounded-full border-2 border-card bg-[var(--danger)]"
    />
  </component>
</template>
