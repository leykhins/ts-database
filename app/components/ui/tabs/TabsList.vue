<script setup lang="ts">
import type { TabsListProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { TabsList } from "reka-ui"
import { cn } from "@/lib/utils"

/**
 * A pill track: a sunken rail with the active tab lifted out of it in white.
 *
 * This is the same segmented control the design system's care-staff template
 * uses for its role and layout switches, so tabs and segmented controls read as
 * one thing rather than two. The track is `inline-flex` so it hugs its labels —
 * pass `w-full` when it should stretch, e.g. inside a dialog. It scrolls
 * horizontally when the labels outgrow the viewport, so no tab is ever
 * unreachable on a phone.
 */
const props = defineProps<TabsListProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <TabsList
    data-slot="tabs-list"
    v-bind="delegatedProps"
    :class="cn(
      'inline-flex w-fit max-w-full items-center gap-1 rounded-full border border-border',
      'bg-[var(--surface-sunken)] p-1',
      // Narrow screens: swipe the track rather than lose the tabs off the edge.
      'overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
      props.class,
    )"
  >
    <slot />
  </TabsList>
</template>
