<script setup lang="ts">
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * The resident photo viewer — mounted once, opened from any avatar.
 *
 * Deliberately thin: a face, a name, a room. It answers "is this the person I
 * am about to write up" and nothing else, so it can be opened mid-task without
 * losing the form behind it.
 */
const { subject, close } = useResidentPhoto()
</script>

<template>
  <Dialog :open="!!subject" @update:open="(value) => !value && close()">
    <DialogContent v-if="subject" class="gap-0 p-0 sm:max-w-[380px]">
      <DialogHeader class="space-y-0 border-b border-[var(--border-subtle)] p-5 text-left">
        <DialogTitle class="text-lg font-semibold text-[var(--text-strong)]">
          {{ subject.name }}
        </DialogTitle>
        <DialogDescription class="text-xs text-muted-foreground">
          <template v-if="subject.room">Room {{ subject.room }}</template>
          <template v-else>No room assigned</template>
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col items-center gap-4 p-5">
        <div
          class="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-[var(--surface-sunken)]"
        >
          <img
            v-if="subject.photoUrl"
            :src="subject.photoUrl"
            :alt="subject.name"
            class="size-full object-cover"
          >
          <div v-else class="flex flex-col items-center gap-2 p-6 text-center">
            <DsPersonAvatar :name="subject.name" size="xl" />
            <p class="text-sm text-muted-foreground">
              No photo on file. Add one from the resident's record so the next
              worker on shift knows this face.
            </p>
          </div>
        </div>

        <div class="flex w-full flex-wrap items-center gap-2">
          <Badge v-if="subject.critical" variant="danger" dot>Critical needs</Badge>
          <DsSupportMeter
            v-if="subject.supportLevel"
            :level="(subject.supportLevel as 'moderate')"
            size="sm"
          />
          <Button
            v-if="subject.tenantId"
            variant="secondary"
            size="sm"
            class="ml-auto"
            @click="
              () => {
                const id = subject!.tenantId
                close()
                navigateTo(`/tenants/${id}`)
              }
            "
          >
            Open record
            <DsIcon name="arrow-right" :size="15" />
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
