<script setup lang="ts">
import { Toaster } from '@/components/ui/sonner'

/**
 * Toasts are mounted here rather than inside a layout: the shell is a flex row,
 * and anything rendered as its sibling becomes a column of it. At the root they
 * overlay the page, and both the app and the sign-in layout get them.
 */
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>

  <TsResidentPhotoDialog />

  <Toaster position="bottom-right" rich-colors />
</template>
