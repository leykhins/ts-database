<script setup lang="ts">
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * RoomGrid — the building itself, one cell per room, coloured by what that room
 * needs. The signature view: staff read it floor-by-floor the way they walk it.
 *
 * Not a shadcn component and not a generic grid — the status vocabulary and its
 * precedence are domain rules, so the colours live here rather than in markup.
 */
type Cell = {
  roomId: Id<'rooms'>
  number: string
  status: string
  note: string
  tenantId: Id<'tenants'> | null
}

defineProps<{
  floors: { label: string; cells: Cell[] }[]
}>()

const STATUS: Record<
  string,
  { bg: string; fg: string; dot: string; border: string; legend?: string }
> = {
  ok: {
    bg: 'var(--surface-card)',
    fg: 'var(--text-body)',
    dot: 'var(--slate-300)',
    legend: 'var(--slate-300)',
    border: 'var(--border)',
  },
  rent: {
    bg: 'color-mix(in srgb, var(--amber-600) var(--wash-strength), var(--surface-card))',
    fg: 'var(--amber-700)',
    dot: 'var(--amber-600)',
    border: 'color-mix(in srgb, var(--amber-600) 20%, transparent)',
  },
  check: {
    bg: 'color-mix(in srgb, var(--blue-600) var(--wash-strength), var(--surface-card))',
    fg: 'var(--blue-700)',
    dot: 'var(--blue-600)',
    border: 'color-mix(in srgb, var(--blue-600) 20%, transparent)',
  },
  deposit: {
    bg: 'color-mix(in srgb, var(--cyan-600) var(--wash-strength), var(--surface-card))',
    fg: 'var(--cyan-700)',
    dot: 'var(--cyan-600)',
    border: 'color-mix(in srgb, var(--cyan-600) 20%, transparent)',
  },
  critical: {
    bg: 'var(--rose-600)',
    fg: '#fff',
    dot: '#fff',
    legend: 'var(--rose-600)',
    border: 'var(--rose-600)',
  },
  vacant: {
    bg: 'transparent',
    fg: 'var(--text-subtle)',
    dot: 'var(--slate-300)',
    border: 'var(--border)',
  },
}

const LEGEND = [
  { status: 'ok', label: 'All clear' },
  { status: 'rent', label: 'Rent due' },
  { status: 'check', label: 'Check due' },
  { status: 'deposit', label: 'Deposit short' },
  { status: 'critical', label: 'Critical needs' },
  { status: 'vacant', label: 'Vacant' },
]

function cellStyle(status: string) {
  const s = STATUS[status] ?? STATUS.ok!
  return {
    background: s.bg,
    color: s.fg,
    border: `1px ${status === 'vacant' ? 'dashed' : 'solid'} ${s.border}`,
  }
}

function legendStyle(status: string) {
  const s = STATUS[status] ?? STATUS.ok!
  return status === 'vacant'
    ? { background: 'transparent', border: '1px dashed var(--border-strong)' }
    : { background: s.legend ?? s.dot }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div v-for="floor in floors" :key="floor.label">
      <div class="eyebrow mb-2 block text-[var(--text-subtle)]">{{ floor.label }}</div>
      <div class="grid grid-cols-6 gap-2 xl:grid-cols-10">
        <component
          :is="cell.tenantId ? resolveComponent('NuxtLink') : 'div'"
          v-for="cell in floor.cells"
          :key="cell.number"
          :to="cell.tenantId ? `/tenants/${cell.tenantId}` : undefined"
          :title="`Room ${cell.number} · ${cell.note}`"
          class="relative inline-flex h-11 items-center justify-center rounded-sm font-mono text-sm font-semibold tracking-snug no-underline transition-colors duration-[var(--dur-fast)] hover:no-underline"
          :class="cell.tenantId && 'cursor-pointer hover:outline hover:outline-[var(--border-hover)]'"
          :style="cellStyle(cell.status)"
        >
          {{ cell.number }}
          <span
            v-if="cell.status !== 'ok' && cell.status !== 'vacant'"
            class="absolute top-1.5 right-1.5 size-1.5 rounded-full"
            :style="{ background: (STATUS[cell.status] ?? STATUS.ok!).dot }"
          />
        </component>
      </div>
    </div>

    <div class="mt-1 flex flex-wrap gap-4 border-t border-[var(--border-subtle)] pt-3">
      <span
        v-for="item in LEGEND"
        :key="item.status"
        class="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <span class="size-2 rounded-[2px]" :style="legendStyle(item.status)" />
        {{ item.label }}
      </span>
    </div>
  </div>
</template>
