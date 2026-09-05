<script setup lang="ts">
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

/**
 * "Which site are you working today?"
 *
 * Asked once a shift of anyone who covers more than one building. A relief
 * worker's remembered site is silently wrong the moment they pick up a shift
 * somewhere else, and nothing about being in the wrong one looks wrong — the
 * roster loads, the checks save, and the building they are standing in shows
 * those checks as never done.
 *
 * Built for the casual worker on the list for **every** site, not for someone
 * choosing between two. An organisation running sixteen buildings turns a short
 * list into a scroll-and-hunt, so the three things that matter at that size are
 * all here: the sites they have actually worked recently come first, typing
 * filters, and the rest is a two-column grid rather than a tall well. Nobody
 * works sixteen sites in rotation — they work three or four — so the recent
 * list is usually the whole interaction and the search is for the one-off.
 *
 * There is no Cancel. Every route in the app is already scoped to a site, so
 * dismissing this would leave someone working against whichever answer was left
 * over — the exact state the question exists to clear. It is not a trap: every
 * option is an answer, including the one they had before.
 */
type Building = {
  _id: Id<'buildings'>
  name: string
  address?: string | null
  units: number
  occupied: number
}

const props = defineProps<{
  open: boolean
  buildings: Building[]
  /** The site carried over from last time, shown as such rather than preselected. */
  previous: Id<'buildings'> | null
  /** Sites actually worked, most recent first. */
  recent: Id<'buildings'>[]
}>()

const emit = defineEmits<{ pick: [Id<'buildings'>] }>()

const search = ref('')
const chosen = ref<Id<'buildings'> | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)

// Opening fresh each time is the point: a pre-ticked answer is one people
// confirm without reading, which would make this ceremony rather than a check.
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    chosen.value = null
    search.value = ''
    // Focus the search only when it is worth typing into. On a five-site list
    // it would put a keyboard over the answer on a phone for no reason.
    if (props.buildings.length > 8) {
      await nextTick()
      searchInput.value?.focus()
    }
  },
  { immediate: true },
)

const byName = computed(() =>
  [...props.buildings].sort((a, b) => a.name.localeCompare(b.name)),
)

function matches(building: Building, term: string): boolean {
  const q = term.trim().toLowerCase()
  if (!q) return true
  return (
    building.name.toLowerCase().includes(q)
    || (building.address ?? '').toLowerCase().includes(q)
  )
}

const filtered = computed(() => byName.value.filter((b) => matches(b, search.value)))

/**
 * Recent sites, in the order they were worked — and only while nothing is
 * typed. Once someone is searching they have a specific site in mind, and
 * splitting the results into two lists at that point hides matches above a
 * heading they are not reading.
 */
const recentBuildings = computed(() => {
  if (search.value.trim()) return []
  return props.recent
    .map((id) => props.buildings.find((b) => b._id === id))
    .filter((b): b is Building => b !== undefined)
})

const recentIds = computed(() => new Set(recentBuildings.value.map((b) => b._id)))

/**
 * One list or two, rendered by the same loop.
 *
 * A heading of `null` means "no heading" — the un-searched, no-history case is
 * a plain grid of every site, and labelling that "All sites" when there is
 * nothing above it is a heading that explains nothing.
 */
const sections = computed(() => {
  const rest = filtered.value.filter((b) => !recentIds.value.has(b._id))
  if (!recentBuildings.value.length) return [{ label: null, items: rest }]
  return [
    { label: 'Where you have been working', items: recentBuildings.value },
    ...(rest.length ? [{ label: 'All sites', items: rest }] : []),
  ]
})

/** Enter picks the only match — the fast path for someone who knows the name. */
function onEnter() {
  if (chosen.value) return emit('pick', chosen.value)
  if (filtered.value.length === 1) emit('pick', filtered.value[0]!._id)
}

function subtitle(building: Building): string {
  return building.address || `${building.occupied}/${building.units} occupied`
}
</script>

<template>
  <Dialog :open="open">
    <!--
      `DialogContent` is a grid, so the scroll area needs an explicit track
      rather than `flex-1`: header auto, list `minmax(0,1fr)` so it may shrink
      below its content, footer auto. Without the `minmax(0,…)` the list refuses
      to shrink, the dialog grows past the viewport, and the primary button ends
      up below the fold — which is what it did at sixteen sites.
    -->
    <DialogContent
      class="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[620px]"
      :show-close-button="false"
      @interact-outside.prevent
      @escape-key-down.prevent
      @pointer-down-outside.prevent
    >
      <div class="flex flex-col gap-1 p-6 pb-4">
        <span class="inline-flex size-10 items-center justify-center rounded-md bg-[var(--brand-soft)] text-[var(--brand)]">
          <DsIcon name="building-2" :size="20" />
        </span>
        <DialogTitle class="mt-2 text-xl">Which site are you working?</DialogTitle>
        <DialogDescription>
          Everything below — residents, checks, the shift report — follows this
          answer.
        </DialogDescription>

        <div
          v-if="buildings.length > 8"
          class="mt-3 flex h-[var(--control-md)] items-center gap-2 rounded-md border border-transparent bg-[var(--surface-sunken)] py-0 pr-2 pl-3 transition-colors duration-[var(--dur-fast)] focus-within:border-[var(--border-focus)] focus-within:bg-card focus-within:shadow-[var(--focus-ring)]"
        >
          <DsIcon name="search" :size="16" class="text-muted-foreground" />
          <!--
            `shadow-none!` because the vendored base stylesheet rings *any*
            `:focus-visible` element, unlayered — so the input would draw its own
            ring inside the wrapper's and you get two. The wrapper owns the focus
            treatment here; the input must not add a second.
          -->
          <input
            ref="searchInput"
            v-model="search"
            type="search"
            :placeholder="`Search ${buildings.length} sites…`"
            class="min-w-0 flex-1 border-none bg-transparent text-base text-[var(--text-strong)] outline-none focus-visible:shadow-none! placeholder:text-[var(--text-subtle)]"
            @keydown.enter.prevent="onEnter"
          >
        </div>
      </div>

      <div class="min-h-0 overflow-y-auto px-6">
        <template v-for="section in sections" :key="section.label ?? 'all'">
          <p v-if="section.label" class="eyebrow pb-2">{{ section.label }}</p>
          <div class="grid gap-2 pb-4 sm:grid-cols-2">
            <button
              v-for="building in section.items"
              :key="building._id"
              type="button"
              class="flex cursor-pointer items-center gap-3 rounded-md border p-3 text-left transition-[background-color,border-color,box-shadow] duration-[var(--dur-fast)] hover:bg-[var(--surface-hover)]"
              :class="
                chosen === building._id
                  ? 'border-[var(--brand)] bg-[var(--brand-soft)] shadow-[0_0_0_1px_var(--brand)]'
                  : 'border-border'
              "
              @click="chosen = building._id"
              @dblclick="emit('pick', building._id)"
            >
              <span
                class="inline-flex size-9 shrink-0 items-center justify-center rounded-sm"
                :class="
                  chosen === building._id
                    ? 'bg-[var(--brand)] text-white'
                    : 'bg-[var(--surface-sunken)] text-muted-foreground'
                "
              >
                <DsIcon name="building-2" :size="18" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex flex-wrap items-center gap-x-2">
                  <span class="truncate text-sm font-semibold text-[var(--text-strong)]">
                    {{ building.name }}
                  </span>
                  <span
                    v-if="building._id === previous"
                    class="rounded-full bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  >
                    Last shift
                  </span>
                </span>
                <span class="tnum mt-0.5 block truncate text-xs text-muted-foreground">
                  {{ subtitle(building) }}
                </span>
              </span>
              <DsIcon
                v-if="chosen === building._id"
                name="check"
                :size="17"
                class="shrink-0 text-[var(--brand)]"
              />
            </button>
          </div>
        </template>

        <p
          v-if="filtered.length === 0"
          class="px-1 py-8 text-center text-sm text-muted-foreground"
        >
          No site matches “{{ search.trim() }}”. If you are working somewhere not
          on this list, an administrator has to assign you to it.
        </p>
      </div>

      <div class="border-t border-border p-4">
        <Button
          variant="primary"
          size="lg"
          class="w-full"
          :disabled="!chosen"
          @click="chosen && emit('pick', chosen)"
        >
          Start here
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
