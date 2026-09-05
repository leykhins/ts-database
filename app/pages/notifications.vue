<script setup lang="ts">
import { shortAge } from '~/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * Everything the bell is holding, in full.
 *
 * Grouped by urgency rather than by kind. A worker coming back from break asks
 * "what do I have to deal with now" — not "show me the maintenance items". The
 * kind is on every row for whoever does want to scan for one.
 */
const { data, rows, unread, isLoading, markRead } = useNotifications()
const now = useNow()

usePageHeader(() => ({
  eyebrow: data.value?.building.name ?? '',
  title: 'Notifications',
}))

const filter = ref<'all' | 'unread'>('all')

const visible = computed(() =>
  filter.value === 'unread' ? rows.value.filter((r) => !r.read) : rows.value,
)

const groups = computed(() =>
  (['high', 'med', 'low'] as const)
    .map((severity) => ({
      severity,
      label: NOTIFICATION_SEVERITY[severity].label,
      rows: visible.value.filter((r) => r.severity === severity),
    }))
    .filter((g) => g.rows.length > 0),
)

async function go(row: { key: string; href: string }) {
  await markRead([row.key])
  await navigateTo(row.href)
}
</script>

<template>
  <div class="space-y-6">
    <DsSectionHeader
      title="Notifications"
      size="lg"
      description="Rounds coming due, needs nobody has closed, guests still signed in. Everything here clears itself once the thing behind it is dealt with."
    >
      <template #actions>
        <Tabs v-model="filter">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unread">
              Unread
              <span v-if="unread > 0" class="tnum ml-1.5 opacity-70">{{ unread }}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          variant="secondary"
          size="sm"
          :disabled="unread === 0"
          @click="markRead(rows.map((r) => r.key))"
        >
          <DsIcon name="check" :size="15" />
          Mark all read
        </Button>
      </template>
    </DsSectionHeader>

    <Card v-if="isLoading">
      <CardContent class="space-y-4 py-5">
        <div v-for="i in 4" :key="i" class="flex gap-3.5">
          <Skeleton class="size-9 shrink-0 rounded-sm" />
          <div class="min-w-0 flex-1 space-y-2">
            <Skeleton class="h-3.5 w-1/2" />
            <Skeleton class="h-3 w-3/4" />
          </div>
        </div>
      </CardContent>
    </Card>

    <Card v-else-if="groups.length === 0">
      <CardContent class="py-2">
        <DsEmptyState
          icon="check-circle-2"
          accent="var(--emerald-600)"
          :title="filter === 'unread' ? 'Nothing unread' : 'Nothing outstanding'"
          :description="
            filter === 'unread'
              ? 'You have looked at everything on the list.'
              : 'Rounds are on time, nothing is waiting and no guest is unaccounted for.'
          "
        />
      </CardContent>
    </Card>

    <section v-for="group in groups" v-else :key="group.severity" class="space-y-2.5">
      <div class="flex items-center gap-2">
        <span
          class="size-2 rounded-full"
          :style="{ background: NOTIFICATION_SEVERITY[group.severity].color }"
        />
        <h3 class="text-sm font-bold text-[var(--text-strong)]">{{ group.label }}</h3>
        <span class="tnum text-sm text-muted-foreground">{{ group.rows.length }}</span>
      </div>

      <Card class="overflow-hidden">
        <CardContent class="p-0">
          <button
            v-for="row in group.rows"
            :key="row.key"
            type="button"
            class="flex w-full cursor-pointer gap-3.5 border-b border-border/60 px-4 py-3.5 text-left transition-colors duration-[var(--dur-fast)] last:border-b-0 hover:bg-[var(--surface-hover)] md:px-5"
            @click="go(row)"
          >
            <span
              class="mt-px inline-flex size-9 shrink-0 items-center justify-center rounded-sm"
              :style="{
                color: NOTIFICATION_SEVERITY[row.severity].color,
                background: NOTIFICATION_SEVERITY[row.severity].tint,
              }"
            >
              <DsIcon :name="NOTIFICATION_KIND[row.kind].icon" :size="18" :stroke-width="1.9" />
            </span>

            <span class="min-w-0 flex-1">
              <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span class="text-[15px] font-semibold text-[var(--text-strong)]">
                  {{ row.title }}
                </span>
                <Badge variant="neutral">{{ NOTIFICATION_KIND[row.kind].label }}</Badge>
                <span v-if="!row.read" class="text-[11px] font-bold tracking-wide text-[var(--text-link)] uppercase">
                  New
                </span>
              </span>
              <span class="mt-1 block text-sm text-pretty text-muted-foreground">
                {{ row.detail }}
              </span>
            </span>

            <span class="tnum shrink-0 self-start text-xs text-muted-foreground">
              {{ shortAge(row.at, now) }}
            </span>
          </button>
        </CardContent>
      </Card>
    </section>
  </div>
</template>
