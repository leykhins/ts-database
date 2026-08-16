<script setup lang="ts">
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

/**
 * Placeholder for a functional area that is routed and navigable but not yet
 * built. It states plainly what will live here rather than pretending to work —
 * staff should never be left unsure whether a screen is empty or broken.
 */
defineProps<{
  title: string
  eyebrow?: string
  description: string
  icon: string
  accent: string
  planned: string[]
}>()
</script>

<template>
  <div class="flex flex-col gap-5">
    <DsSectionHeader :eyebrow="eyebrow" :title="title" :description="description" />

    <Card>
      <CardContent class="p-0">
        <DsEmptyState
          :icon="icon"
          :accent="accent"
          title="Not built yet"
          description="This area is routed and reachable, but its screens are still to come."
        />

        <div class="mx-auto max-w-[460px] px-6 pb-10">
          <Separator class="mb-5" />
          <div class="eyebrow">Planned for this area</div>
          <ul class="mt-3 flex flex-col gap-2">
            <li
              v-for="item in planned"
              :key="item"
              class="flex items-center gap-2 text-base text-[var(--text-body)]"
            >
              <DsIcon name="chevron-right" :size="14" class="text-[var(--text-subtle)]" />
              {{ item }}
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
