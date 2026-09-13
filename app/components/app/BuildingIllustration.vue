<script setup lang="ts">
/**
 * The building, drawn rather than photographed.
 *
 * Every fill is a token with a literal fallback, so the same drawing sits on
 * the sign-in page's pine panel and on a white card without being redrawn:
 * set `--illustration-fill` / `--illustration-leaf` / `--illustration-sun` and
 * `--surface` (the window glass) on any ancestor, and `color` carries the line
 * work. Decorative, so it is hidden from assistive technology.
 */
</script>

<template>
  <svg class="building-illustration" viewBox="0 0 340 150" fill="none" aria-hidden="true">
    <path d="M9 139h322" stroke="currentColor" opacity=".24" />
    <path
      d="M85 137V54h103v83M188 73h60v64M107 54V30h61v24"
      fill="var(--illustration-fill, #dfe8dd)"
      stroke="currentColor"
      stroke-width="1.2"
    />
    <path d="M103 30h68M80 54h112M186 73h67" stroke="currentColor" stroke-width="2" />
    <path
      d="M111 137V111h27v26M144 137V111h27v26"
      fill="var(--surface, #ffffff)"
      stroke="currentColor"
      stroke-width="1.2"
    />
    <g v-for="row in 3" :key="`a${row}`">
      <rect
        v-for="col in 4"
        :key="col"
        :x="82 + col * 21"
        :y="44 + row * 16"
        width="9"
        height="8"
        rx="1"
        fill="var(--surface, #ffffff)"
        stroke="currentColor"
        stroke-width=".8"
      />
    </g>
    <g v-for="row in 3" :key="`b${row}`">
      <rect
        v-for="col in 2"
        :key="col"
        :x="185 + col * 20"
        :y="72 + row * 17"
        width="10"
        height="9"
        rx="1"
        fill="var(--surface, #ffffff)"
        stroke="currentColor"
        stroke-width=".8"
      />
    </g>
    <path
      d="M56 138V99m0 23-13-12m13 4 12-12M283 138V84m0 34 15-12m-15-1-15-12"
      stroke="currentColor"
      stroke-width="1.3"
    />
    <path
      d="M56 70c-21 0-29 42-13 49 9 4 25 4 30-7S73 70 56 70ZM283 52c-25 0-36 48-16 58 9 6 27 6 35-7s1-51-19-51Z"
      fill="var(--illustration-leaf, #b9cbb3)"
      fill-opacity=".65"
      stroke="currentColor"
      stroke-width="1.1"
    />
    <path d="M56 98v26m227-40v37" stroke="currentColor" />
    <path
      d="M15 137c2-12 11-13 14-4 2-17 14-17 17 4M250 137c3-10 11-11 14 0M303 137c2-9 9-11 11-3 4-14 12-9 13 3"
      stroke="currentColor"
      stroke-width="1.2"
    />
    <circle cx="230" cy="30" r="14" fill="var(--illustration-sun, #e7d9a9)" opacity=".8" />
    <path
      d="M20 45h25m-17-7h35M274 28h25m-9-7h21"
      stroke="currentColor"
      opacity=".3"
      stroke-linecap="round"
    />
  </svg>
</template>

<style scoped>
.building-illustration {
  display: block;
  width: 100%;
  height: auto;
}
</style>
