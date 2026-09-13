<script setup lang="ts">
import { Toaster } from '@/components/ui/sonner'

/**
 * Toasts are mounted here rather than inside a layout: the shell is a flex row,
 * and anything rendered as its sibling becomes a column of it. At the root they
 * overlay the page, and both the app and the sign-in layout get them.
 */

/*
   The colour mode is resolved once, at the root, before any layout mounts.
   Doing it per-layout would re-read storage on every navigation between the
   sign-in page and the app, and a mode that is applied by a child can flash
   the light theme for a frame on the way in.
*/
const { initialize } = useColorMode()
onMounted(initialize)
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>

  <TsResidentPhotoDialog />

  <Toaster position="bottom-right" rich-colors />
</template>
