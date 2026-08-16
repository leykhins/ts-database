<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <header
    data-slot="card-header"
    :class="
      cn(
        'flex flex-wrap items-center gap-3 px-5 py-4 border-b border-[var(--border-subtle)]',
        props.class,
      )
    "
  >
    <slot />
  </header>
</template>
