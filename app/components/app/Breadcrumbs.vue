<script setup lang="ts">
/**
 * Where you are, derived rather than declared.
 *
 * Built from the same `AREAS` list that draws the sidebar and guards the
 * routes, so a trail can never name a section that is not really there or
 * label one differently from the nav. Pages say nothing about their
 * breadcrumbs; they only set a title, and the trail picks it up.
 *
 * Three crumbs at most — building, section, page. Deeper than that and a
 * trail stops being orientation and becomes another thing to read.
 */
const props = defineProps<{ building?: string | null }>()

const route = useRoute()
const { isFrontline } = useMe()

/** The longest matching area, so `/care/reports` is not judged as `/care`. */
const area = computed(() =>
  AREAS.filter((a) =>
    a.exact ? route.path === a.to : route.path === a.to || route.path.startsWith(`${a.to}/`),
  ).sort((a, b) => b.to.length - a.to.length)[0] ?? null,
)

/** True when the route *is* the section, so the section name is the page. */
const atAreaRoot = computed(() => !!area.value && route.path === area.value.to)

/**
 * Ancestors only.
 *
 * The heading directly beneath this trail is the current page, so ending the
 * trail with the page as well printed "Dodson Rooms › Care Console" above a
 * heading reading "Care Console". The last crumb is dropped rather than the
 * heading: a trail is for getting back out, and the page you are already on is
 * the one link in it nobody needs.
 */
const crumbs = computed(() => {
  const trail: { label: string, to: string }[] = [
    { label: props.building || 'TS Database', to: homeFor(isFrontline.value) },
  ]

  if (area.value && !atAreaRoot.value) {
    trail.push({ label: area.value.label, to: area.value.to })
  }

  return trail
})
</script>

<template>
  <nav class="breadcrumbs" aria-label="Breadcrumb">
    <template v-for="(crumb, i) in crumbs" :key="crumb.label + i">
      <DsIcon v-if="i" name="chevron-right" :size="13" class="shrink-0 text-[var(--text-subtle)]" />
      <NuxtLink :to="crumb.to" class="breadcrumbs__link">{{ crumb.label }}</NuxtLink>
    </template>
    <!-- The current page is the `<h1>` the shell renders on the same line,
         so the trail deliberately ends on the last ancestor. -->
  </nav>
</template>

<style scoped>
.breadcrumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  min-width: 0;
}

.breadcrumbs__link {
  color: var(--text-muted);
  text-decoration: none;
}

.breadcrumbs__link:hover {
  color: var(--text-strong);
  text-decoration: none;
}

</style>
