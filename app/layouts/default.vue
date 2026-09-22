<script setup lang="ts">
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { SHIFTS, shiftAt } from '../../convex/shifts'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'

/**
 * App shell — pale sage rail, sticky topbar, one white working column.
 *
 * Sidebar counts come from the same dashboard subscription the home screen
 * uses, so a rent posted on one screen updates the badge on every other.
 */
const route = useRoute()
const { signOut } = useConvexAuth()
const { selected, select, reconcile, confirm, isConfirmed, recent } = useSelectedBuilding()
const header = usePageHeader()

const { me, isFrontline, can } = useMe()
const { data: buildings } = useConvexQuery(api.buildings.list)
const { data: overview } = useConvexQuery(api.dashboard.overview, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
}))

// Drop a remembered building that is no longer on offer — deleted, or no
// longer assigned to this person. Without this the stored id outlives the
// thing it names and every screen asks for a building the server won't return.
//
// `watch` on the list, not `watchEffect`: reconcile both reads and writes the
// selection, so as an effect it tracked the very ref it mutates and re-entered
// itself — Vue's "Maximum recursive updates exceeded", which pegs the tab.
watch(buildings, (list) => reconcile(list), { immediate: true })

// Nothing chosen yet (first sign-in, cleared storage): follow the server's
// default so the switcher label matches what the screens are showing. Same
// reasoning as above — this writes the selection, so it must not track it.
watch(
  () => overview.value?.building?._id,
  (buildingId) => {
    if (!selected.value && buildingId) select(buildingId)
  },
  { immediate: true },
)

const currentBuilding = computed(() => overview.value?.building ?? null)

/**
 * Someone with no assignments is a real state, not a loading one — a new
 * account before anyone has said where they work. Saying "Loading…" forever
 * leaves them watching a spinner for a thing that will never arrive.
 */
const hasNoBuildings = computed(() => buildings.value?.length === 0)

const switcherLabel = computed(() => {
  if (currentBuilding.value) return currentBuilding.value.name
  if (hasNoBuildings.value) return 'No building assigned'
  return 'Loading…'
})

const NAV = computed(() =>
  areasFor(isFrontline.value).map((area) => ({
    ...area,
    badge: area.badge ? overview.value?.counts[area.badge] || undefined : undefined,
  })),
)

/**
 * Keep the person inside their own app.
 *
 * The same list that builds the sidebar decides this, so a screen cannot be
 * hidden from the nav yet still reachable by typing the path. It watches the
 * role as well as the route because an administrator can change role without
 * navigating — and then the screen they are standing on may no longer be one
 * they use.
 */
watch(
  () => [route.path, isFrontline.value, me.value !== undefined] as const,
  ([path, frontline, ready]) => {
    if (!ready) return // don't bounce anyone before we know who they are
    if (isAreaAllowed(path, frontline)) return
    navigateTo(homeFor(frontline), { replace: true })
  },
  { immediate: true },
)

// Configuration is split the way the capabilities are. A Building Manager runs
// the fabric of their own sites, so Buildings is theirs; the staff directory is
// the administrator's alone.
const ADMIN_NAV = computed(() => [
  ...(can('building-config')
    ? [{ to: '/admin/buildings', icon: 'building-2', label: 'Buildings' }]
    : []),
  ...(me.value?.isAdmin
    ? [{ to: '/admin/staff', icon: 'shield-user', label: 'Staff' }]
    : []),
])

function isActive(to: string, exact = false): boolean {
  if (to === '/' || exact) return route.path === to
  return route.path.startsWith(to)
}

const search = ref('')
const passwordOpen = ref(false)

const { isDark, toggle } = useColorMode()

/**
 * The date and the live shift, side by side in the nav.
 *
 * Both come off the app's shared clock, so a tab left open across midnight or
 * across a handover rolls over rather than showing yesterday's date and the
 * shift that ended two hours ago. The shift schedule is imported rather than
 * queried — it is policy, not data, and `convex/shifts.ts` is the same file
 * the server resolves it with.
 *
 * The building is deliberately not named here. It is already the first thing
 * in the rail and the first crumb in the trail, and printing it a third time
 * pushed the one piece of context that changes during a day — the shift —
 * into the smallest text on the screen.
 */
const nowMs = useNow()
const todayIso = computed(() => new Date(nowMs.value).toISOString().slice(0, 10))
const weekday = computed(() =>
  new Date(nowMs.value).toLocaleDateString(undefined, { weekday: 'long' }),
)
const shortDate = computed(() =>
  new Date(nowMs.value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }),
)

const shift = computed(() => {
  const { key } = shiftAt(nowMs.value, new Date().getTimezoneOffset())
  return SHIFTS.find((s) => s.key === key) ?? SHIFTS[2]!
})

/**
 * How tall the nav actually is, published as `--nav-h`.
 *
 * Anything else that sticks — the resident record's bio column, an in-page
 * anchor's scroll offset — has to clear it, and the height is not a constant:
 * two bands on a wide screen, three rows on a narrow one, and the context line
 * comes and goes with the page. Measured rather than guessed, because a
 * hard-coded number is wrong on exactly the screens nobody tests on.
 */
const navEl = ref<HTMLElement | null>(null)
onMounted(() => {
  if (!navEl.value) return
  const observer = new ResizeObserver(([entry]) => {
    const height = entry?.borderBoxSize?.[0]?.blockSize ?? entry?.contentRect.height ?? 0
    document.documentElement.style.setProperty('--nav-h', `${Math.round(height)}px`)
  })
  observer.observe(navEl.value)
  onScopeDispose(() => observer.disconnect())
})

/**
 * The topbar is flat until the page scrolls under it, then it takes a border.
 * A sticky bar that always looks lifted is decoration; one that responds is
 * telling you there is content above.
 */
const scrolled = ref(false)
onMounted(() => {
  const onScroll = () => {
    scrolled.value = window.scrollY > 4
  }
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
  onScopeDispose(() => window.removeEventListener('scroll', onScroll))
})

// Switching from the sidebar is a deliberate answer to the same question the
// picker asks, so it confirms too — otherwise someone who moved site at 9am
// would be asked again at 9:01.
function pickBuilding(id: Id<'buildings'>) {
  confirm(id)
}

/**
 * Ask which site this shift is at, once per shift, of anyone who covers more
 * than one.
 *
 * Gated on the list actually having two entries: with one building there is
 * nothing to choose and the dialog would be ceremony. It waits for `me` as well
 * as the list so it cannot flash up during sign-in, and `isConfirmed` is
 * re-read against a ticking clock so a tab left open overnight asks again in
 * the morning rather than on the next navigation.
 */
const now = useNow()
const askForSite = computed(
  () =>
    !!me.value
    && (buildings.value?.length ?? 0) > 1
    && !isConfirmed(now.value),
)

function confirmSite(id: Id<'buildings'>) {
  confirm(id)
}

const { mutate: setSimulatedRole } = useConvexMutation(api.users.setSimulatedRole)

async function stopTesting() {
  await setSimulatedRole({ role: null })
}

async function handleSignOut() {
  await signOut()
  await navigateTo('/login')
}

function submitSearch(value: string) {
  if (!value.trim()) return
  navigateTo({ path: '/tenants', query: { q: value.trim() } })
}
</script>

<template>
  <SidebarProvider>
    <Sidebar collapsible="icon">
      <SidebarHeader class="gap-2.5 p-3">
        <NuxtLink :to="homeFor(isFrontline)" class="flex items-center px-1 pt-1 group-data-[collapsible=icon]:hidden">
          <TsBrandMark class="text-sidebar-accent-foreground" :size="28" />
        </NuxtLink>
        <NuxtLink :to="homeFor(isFrontline)" class="hidden justify-center group-data-[collapsible=icon]:flex">
          <TsBrandMark compact :size="28" />
        </NuxtLink>

        <!-- Building switcher -->
        <DropdownMenu v-slot="{ open: switcherOpen }">
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2.5 rounded-md border border-sidebar-border bg-sidebar-accent p-2.5 text-left transition-colors hover:border-[var(--border-hover)] group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-2"
            >
              <span
                class="inline-flex size-[30px] shrink-0 items-center justify-center rounded-sm bg-[var(--brand)] text-[var(--text-on-accent)]"
              >
                <DsIcon name="building-2" :size="17" :stroke-width="2.4" />
              </span>
              <span class="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                <span class="block truncate text-sm font-semibold text-sidebar-accent-foreground">
                  {{ switcherLabel }}
                </span>
                <span v-if="currentBuilding" class="tnum block text-[11px] text-sidebar-foreground">
                  {{ currentBuilding.occupied }}/{{ currentBuilding.units }} occupied
                </span>
                <span v-else-if="hasNoBuildings" class="block text-[11px] text-sidebar-foreground">
                  Ask an administrator for access
                </span>
              </span>
              <DsIcon
                name="chevrons-up-down"
                :size="15"
                class="text-sidebar-foreground transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)] group-data-[collapsible=icon]:hidden"
                :class="switcherOpen && 'rotate-180'"
              />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" class="w-[236px]">
            <DropdownMenuItem
              v-for="b in buildings ?? []"
              :key="b._id"
              class="justify-between gap-3"
              :class="b._id === currentBuilding?._id && 'font-semibold text-[var(--brand-strong)]'"
              @select="pickBuilding(b._id)"
            >
              <span>{{ b.name }}</span>
              <span class="tnum text-muted-foreground">{{ b.occupied }}/{{ b.units }}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup class="py-1">
          <SidebarMenu>
            <SidebarMenuItem v-for="item in NAV" :key="item.to">
              <SidebarMenuButton
                as-child
                :is-active="isActive(item.to, item.exact)"
                :tooltip="item.label"
                class="h-9 gap-3 text-base"
              >
                <NuxtLink :to="item.to">
                  <DsIcon
                    :name="item.icon"
                    :size="19"
                    :stroke-width="isActive(item.to, item.exact) ? 2.4 : 2"
                    :class="isActive(item.to, item.exact) && 'text-[var(--brand)]'"
                  />
                  <span>{{ item.label }}</span>
                </NuxtLink>
              </SidebarMenuButton>
              <SidebarMenuBadge v-if="item.badge != null" class="tnum">
                {{ item.badge }}
              </SidebarMenuBadge>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup v-if="ADMIN_NAV.length" class="py-1">
          <SidebarGroupLabel class="text-sidebar-foreground">Administration</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in ADMIN_NAV" :key="item.to">
              <SidebarMenuButton
                as-child
                :is-active="isActive(item.to)"
                :tooltip="item.label"
                class="h-9 gap-3 text-base"
              >
                <NuxtLink :to="item.to">
                  <DsIcon
                    :name="item.icon"
                    :size="19"
                    :stroke-width="isActive(item.to) ? 2.4 : 2"
                    :class="isActive(item.to) && 'text-[var(--brand)]'"
                  />
                  <span>{{ item.label }}</span>
                </NuxtLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter class="gap-2 border-t border-sidebar-border">
        <TsRoleTester />

        <div class="flex items-center gap-2.5 px-1 py-0.5">
          <DsPersonAvatar :name="me?.name ?? 'Staff'" size="sm" status="online" />
          <span class="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <span class="block truncate text-xs font-semibold text-sidebar-accent-foreground">{{ me?.name ?? '—' }}</span>
            <span class="block text-[11px] text-sidebar-foreground">
              {{ me?.simulating ? me?.realRoleLabel : (me?.roleLabel ?? '') }}
            </span>
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Change password"
            title="Change password"
            class="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden"
            @click="passwordOpen = true"
          >
            <DsIcon name="key" :size="16" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Log out"
            title="Log out"
            class="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden"
            @click="handleSignOut"
          >
            <DsIcon name="log-out" :size="16" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>

    <SidebarInset class="bg-background">
      <!--
        The nav is two white bands, not one.

        The top band is the shift's context on the left, the search dead centre
        where it is the same distance from anywhere, and the page's own actions
        beside the utility controls on the right. The band under it carries the
        trail and the page name — orientation, which is a different job from
        navigation and was crowding it when both shared a row.

        Both bands sit in one sticky block so the second does not slide under
        the first on scroll.
      -->
      <div
        ref="navEl"
        class="sticky top-0 z-[var(--z-sticky)] shrink-0 bg-card transition-shadow duration-[var(--dur-base)] ease-[var(--ease-out)] print:hidden"
        :class="scrolled && 'shadow-[var(--shadow-sm)]'"
      >
        <header class="topbar">
          <div class="topbar__context">
            <SidebarTrigger class="-ml-1 shrink-0" />

            <time class="topbar__date" :datetime="todayIso">
              <strong>{{ weekday }}</strong>
              <span>{{ shortDate }}</span>
            </time>

            <span class="topbar__rule" aria-hidden="true" />

            <div class="topbar__shift">
              <DsIcon :name="shift.icon" :size="15" class="shrink-0 text-[var(--brand)]" />
              <span class="min-w-0">
                <strong>{{ shift.label }}</strong>
                <span>{{ shift.hours }}</span>
              </span>
              <span class="topbar__live" title="On shift now" />
            </div>
          </div>

          <!-- `width` is an inline style on the component, so the track's
               width has to be handed to it rather than applied from here. -->
          <DsSearchField
            v-model="search"
            placeholder="Search tenants, rooms, cheques…"
            width="100%"
            class="topbar__search"
            @submit="submitSearch"
          />

          <div class="topbar__right">
            <!--
              Where a page puts its own controls. A page teleports into this
              rather than rendering a row of buttons above its content, so the
              primary action of every screen is in the same place.
            -->
            <div id="topbar-actions" class="topbar__actions" />
            <div class="topbar__utilities">
              <Button
                variant="ghost"
                size="icon-sm"
                :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
                :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
                @click="toggle"
              >
                <DsIcon :name="isDark ? 'sunrise' : 'moon'" :size="17" />
              </Button>
              <TsNotificationBell />
            </div>
          </div>
        </header>

        <div class="subbar">
          <TsBreadcrumbs :building="currentBuilding?.name" />
          <DsIcon name="chevron-right" :size="13" class="shrink-0 text-[var(--text-subtle)]" />
          <h1 class="subbar__title">{{ header.title }}</h1>
        </div>
      </div>

      <div
        v-if="me?.simulating"
        class="flex flex-wrap items-center gap-3 border-b border-[var(--amber-500)]/30 bg-[var(--amber-50)] px-5 py-2.5 md:px-8 print:hidden"
      >
        <DsIcon name="shield-user" :size="17" class="text-[var(--amber-700)]" />
        <span class="text-sm text-[var(--amber-700)]">
          Testing as <strong>{{ me.roleLabel }}</strong> — permissions are enforced for real,
          so anything this role cannot do will be refused.
        </span>
        <Button
          variant="secondary"
          size="sm"
          class="ml-auto"
          @click="stopTesting"
        >
          <DsIcon name="refresh" :size="15" />
          Back to {{ me.realRoleLabel }}
        </Button>
      </div>

      <!-- Same width and inline padding as the topbar and subbar above, so the
           page's edges line up with the bar's contents. A centred max-width
           column left a gutter the bar did not have, and the two edges drifted
           apart as the window widened. -->
      <main class="w-full flex-1 p-5 md:p-8">
        <slot />
      </main>
    </SidebarInset>

    <TsPasswordDialog :open="passwordOpen" @close="passwordOpen = false" />

    <TsSitePicker
      :open="askForSite"
      :buildings="buildings ?? []"
      :previous="selected"
      :recent="recent"
      @pick="confirmSite"
    />
  </SidebarProvider>
</template>

<style scoped>
/* ---- Band one: navigation ---- */
.topbar {
  display: grid;
  /* Context, search, actions. The middle track is fixed-width and the outer
     two are equal, which is what actually centres the search — `1fr auto 1fr`
     centres it only while both sides happen to weigh the same. */
  grid-template-columns: minmax(0, 1fr) minmax(0, 420px) minmax(0, 1fr);
  align-items: center;
  gap: 18px;
  min-height: 86px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.topbar__context {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

/* Date and shift read as two stacked pairs side by side: the bold line is
   what you want at a glance, the quiet line underneath is the detail you
   only need when you go looking for it. */
.topbar__date,
.topbar__shift > span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.topbar__date strong,
.topbar__shift strong {
  display: block;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.2;
  color: var(--text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.topbar__date > span,
.topbar__shift > span > span {
  display: block;
  font-size: 10px;
  line-height: 1.2;
  color: var(--text-muted);
  white-space: nowrap;
}

.topbar__rule {
  width: 1px;
  height: 26px;
  flex-shrink: 0;
  background: var(--border);
}

.topbar__shift {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.topbar__live {
  width: 5px;
  height: 5px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--success);
}

.topbar__search {
  width: 100%;
  min-width: 0;
}

.topbar__right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  min-width: 0;
}

.topbar__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.topbar__utilities {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* ---- Band two: orientation ---- */
/*
  The trail and the page name sit on one line, at one size. The name was set
  as a display heading and dominated a band whose whole job is to be glanceable
  orientation — it is the same 11px as the crumbs now, and earns its place by
  weight rather than by size.
*/
.subbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  padding: 11px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-card);
}

.subbar__title {
  font-size: 11px;
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: 0;
  color: var(--text-strong);
}

@media (min-width: 768px) {
  .topbar,
  .subbar {
    padding-inline: 32px;
  }
}

/*
  On narrow screens, context and utilities share the first row. Search and
  the page action share the second, leaving the shift details room to breathe.
*/
@media (max-width: 900px) {
  .topbar {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px 16px;
    min-height: 0;
  }

  .topbar__search {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .topbar__right {
    display: contents;
  }

  .topbar__utilities {
    grid-column: 2;
    grid-row: 1;
    justify-self: end;
  }

  .topbar__actions {
    grid-column: 2;
    grid-row: 2;
    justify-self: end;
  }

  .topbar__actions:empty {
    display: none;
  }

  .topbar:has(.topbar__actions:not(:empty)) .topbar__search {
    grid-column: 1;
  }

  .topbar__context {
    grid-column: 1 / -1;
    grid-row: 1;
    gap: 8px;
    padding-inline-end: 88px;
  }

  .topbar__date {
    flex-shrink: 0;
  }

  .subbar__title {
    font-size: 18px;
  }
}
</style>
