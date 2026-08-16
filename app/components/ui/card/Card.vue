<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

/**
 * TS Database cards are flat: white, 10px radius, one hairline border and no
 * shadow. Separation comes from the border — shadow is reserved for things that
 * genuinely float (menus, dialogs, toasts).
 */
const props = defineProps<{
  class?: HTMLAttributes["class"]
  interactive?: boolean
}>()
</script>

<template>
  <section
    data-slot="card"
    :class="
      cn(
        'bg-card text-card-foreground flex flex-col rounded-lg border overflow-hidden transition-colors duration-[var(--dur-fast)]',
        props.interactive && 'cursor-pointer hover:border-[var(--border-hover)]',
        props.class,
      )
    "
  >
    <slot />
  </section>
</template>
