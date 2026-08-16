<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

/**
 * Wrapped in its own bordered, rounded surface — in TS Database a table *is* a
 * card, and dense tables scroll inside it rather than widening the page.
 */
const props = defineProps<{
  class?: HTMLAttributes["class"]
  containerClass?: HTMLAttributes["class"]
  dense?: boolean
}>()
</script>

<template>
  <div
    data-slot="table-container"
    :class="
      cn(
        'relative w-full overflow-x-auto rounded-lg border bg-card',
        props.containerClass,
      )
    "
  >
    <table
      data-slot="table"
      :class="
        cn(
          'w-full caption-bottom border-collapse text-base',
          props.dense && '[&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2',
          '[&_tbody_tr:last-child_td]:border-b-0',
          props.class,
        )
      "
    >
      <slot />
    </table>
  </div>
</template>
