<script setup lang="ts">
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
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
 * App shell — dark sidebar, sticky topbar, one content column.
 *
 * Sidebar counts come from the same dashboard subscription the home screen
 * uses, so a rent posted on one screen updates the badge on every other.
 */
const route = useRoute()
const { signOut } = useConvexAuth()
const { selected, select, reconcile } = useSelectedBuilding()
const header = usePageHeader()

const { me, isFrontline, can } = useMe()
const { data: buildings } = useConvexQuery(api.buildings.list)
const { data: overview } = useConvexQuery(api.dashboard.overview, () => ({
  ...(selected.value ? { buildingId: selected.value } : {}),
}))

// Drop a remembered building that is no longer on offer — deleted, or no
// longer assigned to this person. Without this the stored id outlives the
// thing it names and every screen asks for a building the server won't return.
watchEffect(() => reconcile(buildings.value))

// Nothing chosen yet (first sign-in, cleared storage): follow the server's
// default so the switcher label matches what the screens are showing.
watchEffect(() => {
  if (!selected.value && overview.value?.building) {
    select(overview.value.building._id)
  }
})

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

const NAV = computed(() => [
  ...(isFrontline.value
    ? []
    : [{ to: '/', icon: 'layout-dashboard', label: 'Home' }]),
  { to: '/care', icon: 'clipboard-check', label: 'Care Console', exact: true },
  { to: '/care/reports', icon: 'file-text', label: 'Shift Reports' },
  { to: '/services', icon: 'notes', label: 'Services' },
  { to: '/visitors', icon: 'user-plus', label: 'Visitors' },
  { to: '/tenants', icon: 'users', label: 'Tenants', badge: overview.value?.counts.tenants },
  { to: '/rents', icon: 'dollar-sign', label: 'Rents', badge: overview.value?.counts.rentWarnings || undefined },
  { to: '/checks', icon: 'shield-check', label: 'Room Checks' },
  { to: '/deposits', icon: 'lock', label: 'Security Deposits' },
  { to: '/support', icon: 'traffic-cone', label: 'Support Levels' },
  { to: '/critical', icon: 'heart-pulse', label: 'Critical Needs', badge: overview.value?.counts.criticalNeeds || undefined },
  { to: '/maintenance', icon: 'wrench', label: 'Maintenance' },
  { to: '/reports', icon: 'clipboard-list', label: 'Reports' },
])

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

function pickBuilding(id: Id<'buildings'>) {
  select(id)
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
        <NuxtLink to="/" class="flex items-center px-1 pt-1 group-data-[collapsible=icon]:hidden">
          <img src="/logo-wordmark-dark.svg" alt="TS Database" height="28" class="h-7 w-auto" >
        </NuxtLink>
        <NuxtLink to="/" class="hidden justify-center group-data-[collapsible=icon]:flex">
          <img src="/logo-mark.svg" alt="TS Database" class="size-7" >
        </NuxtLink>

        <!-- Building switcher -->
        <DropdownMenu v-slot="{ open: switcherOpen }">
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2.5 rounded-md border border-white/10 bg-white/[0.06] p-2.5 text-left transition-colors hover:bg-white/10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-2"
            >
              <span
                class="inline-flex size-[30px] shrink-0 items-center justify-center rounded-sm bg-[var(--emerald-500)] text-[#06281d]"
              >
                <DsIcon name="building-2" :size="17" :stroke-width="2.4" />
              </span>
              <span class="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                <span class="block truncate text-sm font-semibold text-white">
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
                    :class="isActive(item.to, item.exact) && 'text-[var(--emerald-400)]'"
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
                    :class="isActive(item.to) && 'text-[var(--emerald-400)]'"
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
            <span class="block truncate text-xs font-semibold text-white">{{ me?.name ?? '—' }}</span>
            <span class="block text-[11px] text-sidebar-foreground">
              {{ me?.simulating ? me?.realRoleLabel : (me?.roleLabel ?? '') }}
            </span>
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Change password"
            title="Change password"
            class="text-sidebar-foreground hover:bg-white/10 hover:text-white group-data-[collapsible=icon]:hidden"
            @click="passwordOpen = true"
          >
            <DsIcon name="key" :size="16" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Log out"
            title="Log out"
            class="text-sidebar-foreground hover:bg-white/10 hover:text-white group-data-[collapsible=icon]:hidden"
            @click="handleSignOut"
          >
            <DsIcon name="log-out" :size="16" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>

    <SidebarInset class="bg-background">
      <header
        class="sticky top-0 z-[var(--z-sticky)] flex h-[var(--topbar-h)] shrink-0 items-center gap-4 bg-card px-5 transition-[border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-out)] md:px-8 print:hidden"
        :class="scrolled ? 'border-b border-border shadow-[var(--shadow-sm)]' : 'border-b border-transparent'"
      >
        <SidebarTrigger class="-ml-1" />
        <div class="min-w-0">
          <div v-if="header.eyebrow" class="eyebrow">{{ header.eyebrow }}</div>
          <div class="truncate text-[17px] font-semibold text-[var(--text-strong)]">
            {{ header.title }}
          </div>
        </div>
        <div class="flex-1" />
        <DsSearchField
          v-model="search"
          placeholder="Search tenants, rooms, cheques…"
          :width="260"
          class="hidden sm:flex"
          @submit="submitSearch"
        />
        <Button variant="secondary" size="icon" aria-label="Work queue" @click="navigateTo('/')">
          <DsIcon name="bell" :size="18" />
        </Button>
      </header>

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

      <main class="mx-auto w-full max-w-[var(--content-max)] flex-1 p-5 md:p-8">
        <slot />
      </main>
    </SidebarInset>

    <TsPasswordDialog :open="passwordOpen" @close="passwordOpen = false" />
  </SidebarProvider>
</template>
