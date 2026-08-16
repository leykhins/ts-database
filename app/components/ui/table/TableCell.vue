<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <td
    data-slot="table-cell"
    :class="
      cn(
        'px-4 py-3 align-middle text-[var(--text-body)]',
        'border-b border-[var(--border-subtle)]',
        props.class,
      )
    "
  >
    <slot />
  </td>
</template>
