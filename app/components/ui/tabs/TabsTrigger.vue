<script setup lang="ts">
import type { TabsTriggerProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { TabsTrigger, useForwardProps } from "reka-ui"
import { cn } from "@/lib/utils"

/**
 * One pill. The active tab is a raised white surface on the sunken track —
 * colour and elevation change, never position, so a row of tabs does not jump
 * as you move across it.
 */
const props = defineProps<TabsTriggerProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <TabsTrigger
    data-slot="tabs-trigger"
    v-bind="forwardedProps"
    :class="cn(
      'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full',
      'px-3.5 py-1.5 text-base font-semibold text-muted-foreground',
      'border border-transparent bg-transparent',
      'transition-colors duration-[var(--dur-fast)] outline-none cursor-pointer',
      'hover:text-[var(--text-strong)]',
      'data-[state=active]:bg-card data-[state=active]:text-[var(--text-strong)]',
      'data-[state=active]:border-border',
      'focus-visible:shadow-[var(--focus-ring)]',
      'disabled:pointer-events-none disabled:opacity-50',
      '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
      props.class,
    )"
  >
    <slot />
  </TabsTrigger>
</template>
