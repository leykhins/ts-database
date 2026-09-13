<script setup lang="ts">
/**
 * The greeting at the top of a home screen — Home for oversight, the Care
 * Console for a shift.
 *
 * Not decoration: it is the only line on either page that says which building
 * you are looking at and when, and the drawing keeps the physical place present
 * while the rest of the screen is counts. One component so the two homes cannot
 * drift into greeting people differently.
 */
defineProps<{ site: string }>()

const { me } = useMe()

/**
 * A greeting has to know what time it is, and a Convex query does not — it
 * re-runs on data, not on the clock. `useNow` is the app's one shared tick.
 */
const now = useNow()
const hour = computed(() => new Date(now.value).getHours())
const partOfDay = computed(() =>
  hour.value < 5 ? 'night' : hour.value < 12 ? 'morning' : hour.value < 17 ? 'afternoon' : 'evening',
)

/** First name only: this is a greeting, not a record. */
const firstName = computed(() => (me.value?.name ?? '').trim().split(/\s+/)[0] ?? '')
</script>

<template>
  <section class="greeting">
    <div class="min-w-0">
      <!-- h2: the shell's second band already carries this page's h1. -->
      <h2 class="greeting__heading">
        <!-- Nobody says "good night" arriving for a shift; it means goodbye. -->
        Good {{ partOfDay === 'night' ? 'evening' : partOfDay }}<template v-if="firstName">, {{ firstName }}</template>.
      </h2>
      <p class="greeting__sub">
        <template v-if="partOfDay === 'night'">
          The building is settling in. Here's what needs your attention at {{ site }}.
        </template>
        <template v-else>Here's what's happening at {{ site }} this {{ partOfDay }}.</template>
      </p>
      <div v-if="$slots.default" class="greeting__actions">
        <slot />
      </div>
    </div>
    <TsBuildingIllustration class="greeting__art" />
  </section>
</template>

<style scoped>
.greeting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  min-height: 100px;
  padding: 4px 0 8px;
}

.greeting__heading {
  font-family: var(--font-display);
  font-size: 31px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -1.3px;
  color: var(--text-strong);
}

.greeting__sub {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-muted);
}

.greeting__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  margin-top: 16px;
}

.greeting__art {
  flex-shrink: 0;
  width: 300px;
  color: #9db496;
  --illustration-fill: #e1e9dc;
  --illustration-leaf: #b9cbb3;
  --illustration-sun: #e7d9a9;
}

/* Below the two-column breakpoint the drawing is the first thing worth
   dropping: it is atmosphere, and the greeting still reads without it. */
@media (max-width: 860px) {
  .greeting__art {
    display: none;
  }
}
</style>
