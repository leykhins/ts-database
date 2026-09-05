<script setup lang="ts">
import { shortAge } from '~/utils/format'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The bell in the topbar.
 *
 * Opening it does *not* mark everything read. That is the usual behaviour and
 * it is wrong here: this feed is a list of things that still need doing, and a
 * worker who glances at it between two other jobs has not dealt with any of
 * them. Reading is a deliberate act — tap a row and go to it, or say so.
 */
const { rows, unread, isLoading, markRead } = useNotifications()

const open = ref(false)
const now = useNow()

// A dropdown is a glance, not a screen. Enough to see the shape of it and
// whether it is worth stopping for; the page is one click away.
const visible = computed(() => rows.value.slice(0, 6))

async function go(row: { key: string; href: string }) {
  open.value = false
  await markRead([row.key])
  await navigateTo(row.href)
}

async function markAll() {
  await markRead(rows.value.map((r) => r.key))
}
</script>

<template>
  <DropdownMenu v-model:open="open">
    <DropdownMenuTrigger as-child>
      <Button variant="secondary" size="icon" aria-label="Notifications" class="relative">
        <DsIcon name="bell" :size="18" />
        <span
          v-if="unread > 0"
          class="tnum absolute -top-1 -right-1 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[var(--red-600)] px-1 text-[10px] font-bold text-white ring-2 ring-card"
          :aria-label="`${unread} unread`"
        >
          {{ unread > 9 ? '9+' : unread }}
        </span>
      </Button>
    </DropdownMenuTrigger>

    <DropdownMenuContent align="end" :side-offset="8" class="w-[min(380px,calc(100vw-2rem))] p-0">
      <div class="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
        <span class="text-sm font-semibold text-[var(--text-strong)]">Notifications</span>
        <span v-if="unread > 0" class="tnum text-xs text-muted-foreground">{{ unread }} unread</span>
        <span class="flex-1" />
        <button
          v-if="unread > 0"
          type="button"
          class="cursor-pointer rounded-sm px-1.5 py-0.5 text-xs font-medium text-[var(--text-link)] transition-colors hover:bg-[var(--surface-hover)]"
          @click="markAll"
        >
          Mark all read
        </button>
      </div>

      <div class="max-h-[min(60vh,420px)] overflow-y-auto">
        <div v-if="isLoading" class="space-y-2 p-3.5">
          <div v-for="i in 3" :key="i" class="flex gap-3">
            <Skeleton class="size-7 shrink-0 rounded-sm" />
            <div class="min-w-0 flex-1 space-y-1.5">
              <Skeleton class="h-3 w-3/4" />
              <Skeleton class="h-2.5 w-1/2" />
            </div>
          </div>
        </div>

        <div v-else-if="rows.length === 0" class="px-3.5 py-8 text-center">
          <DsIcon name="check-circle-2" :size="22" class="mx-auto text-[var(--emerald-600)]" />
          <p class="mt-2 text-sm font-medium text-[var(--text-strong)]">Nothing outstanding</p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            Rounds are on time and nothing is waiting on you.
          </p>
        </div>

        <button
          v-for="row in visible"
          v-else
          :key="row.key"
          type="button"
          class="flex w-full cursor-pointer gap-3 border-b border-border/60 px-3.5 py-3 text-left transition-colors duration-[var(--dur-fast)] last:border-b-0 hover:bg-[var(--surface-hover)]"
          :class="!row.read && 'bg-[var(--surface-raised)]'"
          @click="go(row)"
        >
          <span
            class="mt-px inline-flex size-7 shrink-0 items-center justify-center rounded-sm"
            :style="{
              color: NOTIFICATION_SEVERITY[row.severity].color,
              background: NOTIFICATION_SEVERITY[row.severity].tint,
            }"
          >
            <DsIcon :name="NOTIFICATION_KIND[row.kind].icon" :size="15" :stroke-width="1.9" />
          </span>

          <span class="min-w-0 flex-1">
            <span class="flex items-baseline gap-2">
              <span class="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text-strong)]">
                {{ row.title }}
              </span>
              <span class="tnum shrink-0 text-[11px] text-muted-foreground">
                {{ shortAge(row.at, now) }}
              </span>
            </span>
            <span class="mt-0.5 line-clamp-2 block text-xs text-pretty text-muted-foreground">
              {{ row.detail }}
            </span>
          </span>

          <span
            v-if="!row.read"
            class="mt-2 size-1.5 shrink-0 self-start rounded-full"
            :style="{ background: NOTIFICATION_SEVERITY[row.severity].color }"
            aria-label="Unread"
          />
        </button>
      </div>

      <NuxtLink
        to="/notifications"
        class="flex items-center justify-center gap-1.5 border-t border-border py-2.5 text-xs font-semibold text-[var(--text-link)] transition-colors hover:bg-[var(--surface-hover)]"
        @click="open = false"
      >
        All notifications
        <DsIcon name="arrow-right" :size="14" />
      </NuxtLink>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
