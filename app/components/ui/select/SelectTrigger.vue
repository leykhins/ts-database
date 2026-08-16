<script setup lang="ts">
import type { SelectTriggerProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { ChevronDown } from "@/lib/icons"
import { reactiveOmit } from "@vueuse/core"
import { SelectIcon, SelectTrigger, useForwardProps } from "reka-ui"
import { cn } from "@/lib/utils"

const props = withDefaults(
  defineProps<SelectTriggerProps & { class?: HTMLAttributes["class"], size?: "sm" | "default" | "lg" }>(),
  { size: "default" },
)

const delegatedProps = reactiveOmit(props, "class", "size")
const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <SelectTrigger
    data-slot="select-trigger"
    :data-size="size"
    v-bind="forwardedProps"
    :class="cn(
      `flex w-full items-center justify-between gap-2 whitespace-nowrap rounded-md border border-[var(--border-strong)] bg-card px-3 text-base text-[var(--text-strong)] cursor-pointer outline-none transition-[color,box-shadow,border-color] data-[placeholder]:text-[var(--text-subtle)] [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-[var(--border-focus)] focus-visible:shadow-[var(--focus-ring)] aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-[var(--control-md)] data-[size=sm]:h-[var(--control-sm)] data-[size=lg]:h-[var(--control-lg)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`,
      props.class,
    )"
  >
    <slot />
    <SelectIcon as-child>
      <ChevronDown class="size-4 opacity-50" />
    </SelectIcon>
  </SelectTrigger>
</template>
