<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import type { BadgeVariants } from "."
import { Primitive, type PrimitiveProps } from "reka-ui"
import { cn } from "@/lib/utils"
import { badgeVariants } from "."

/** `dot` renders the live-status marker the design system calls for. */
const props = withDefaults(
  defineProps<PrimitiveProps & {
    variant?: BadgeVariants["variant"]
    dot?: boolean
    class?: HTMLAttributes["class"]
  }>(),
  { as: "span", dot: false },
)
</script>

<template>
  <Primitive
    data-slot="badge"
    :as="as"
    :as-child="asChild"
    :class="cn(badgeVariants({ variant }), props.class)"
  >
    <span
      v-if="dot"
      class="size-[5px] shrink-0 rounded-full bg-[var(--tone)]"
    />
    <slot />
  </Primitive>
</template>
