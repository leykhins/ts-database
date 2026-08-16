<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <!--
    `min-w-0` on the inset is load-bearing. Without it this flex child keeps
    its automatic min-content width and, sitting next to the fixed-width
    sidebar, widens the entire page — instead of letting dense tables scroll
    inside their own container. Divergence from stock shadcn, deliberately.
  -->
  <main
    data-slot="sidebar-inset"
    :class="cn(
      'bg-background relative flex w-full min-w-0 flex-1 flex-col',
      'md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2',
      props.class,
    )"
  >
    <slot />
  </main>
</template>
