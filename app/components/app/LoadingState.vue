<script setup lang="ts">
import { Skeleton } from '@/components/ui/skeleton'

/** Quiet placeholder while a Convex subscription delivers its first result. */
withDefaults(
  defineProps<{ label?: string; rows?: number }>(),
  { label: 'Loading…', rows: 4 },
)
</script>

<template>
  <div class="flex flex-col gap-3" role="status" :aria-label="label">
    <Skeleton v-for="i in rows" :key="i" class="h-12 w-full rounded-lg" />
    <span class="sr-only">{{ label }}</span>
  </div>
</template>
