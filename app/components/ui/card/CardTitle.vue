<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from "@/lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <h3
    data-slot="card-title"
    :class="cn('text-lg font-semibold leading-snug text-[var(--text-strong)]', props.class)"
  >
    <slot />
  </h3>
</template>
