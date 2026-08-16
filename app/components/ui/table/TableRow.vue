<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <tr
    data-slot="table-row"
    :class="
      cn(
        'transition-colors duration-[var(--dur-fast)] data-[state=selected]:bg-[var(--surface-hover)]',
        props.class,
      )
    "
  >
    <slot />
  </tr>
</template>
