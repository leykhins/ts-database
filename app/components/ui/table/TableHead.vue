<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <th
    data-slot="table-head"
    :class="
      cn(
        'px-4 py-3 text-left align-middle whitespace-nowrap',
        'text-[10.5px] font-bold uppercase tracking-caps text-muted-foreground',
        'border-b border-border',
        props.class,
      )
    "
  >
    <slot />
  </th>
</template>
