<script setup lang="ts">
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

/**
 * ActionRow — one item in the "Do next" queue. Every row names the next action,
 * not just the condition: "Receive Rent", not "Rent is overdue".
 */
defineProps<{
  item: {
    id: string
    kind: 'check' | 'maintenance' | 'rent' | 'deposit'
    priority: 'high' | 'med' | 'low'
    title: string
    detail: string
    cta: string
  }
}>()

const emit = defineEmits<{ act: [] }>()

const KIND: Record<string, { icon: string; fg: string }> = {
  check: { icon: 'shield-check', fg: 'var(--blue-600)' },
  maintenance: { icon: 'wrench', fg: 'var(--slate-500)' },
  rent: { icon: 'dollar-sign', fg: 'var(--amber-600)' },
  deposit: { icon: 'lock', fg: 'var(--cyan-600)' },
}
</script>

<template>
  <div class="-mx-3 flex gap-3 rounded-md p-3 transition-colors duration-[var(--dur-fast)] hover:bg-[var(--surface-hover)]">
    <span
      class="mt-px inline-flex size-[26px] shrink-0 items-center justify-center rounded-sm border"
      :style="{ color: (KIND[item.kind] ?? KIND.check!).fg }"
    >
      <DsIcon :name="(KIND[item.kind] ?? KIND.check!).icon" :size="14" :stroke-width="1.8" />
    </span>

    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold text-[var(--text-strong)]">{{ item.title }}</span>
        <Badge v-if="item.priority === 'high'" variant="danger" dot>high</Badge>
      </div>
      <div class="mt-0.5 text-xs text-pretty text-muted-foreground">{{ item.detail }}</div>
      <div class="mt-2">
        <Button variant="soft" size="sm" @click="emit('act')">
          {{ item.cta }}
          <DsIcon name="arrow-right" :size="15" />
        </Button>
      </div>
    </div>
  </div>
</template>
