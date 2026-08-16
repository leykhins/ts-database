<script setup lang="ts">
import type { Id } from '../../../convex/_generated/dataModel'
import { Badge } from '@/components/ui/badge'

/**
 * Pick the residents an entry involves — none, one, or several.
 *
 * Inline rather than a dropdown, and showing faces, because the person filling
 * this in is often relief staff who know the incident but not the names. Being
 * able to scan photos is the difference between filing it correctly and asking
 * a colleague for a room number.
 */
const props = withDefaults(
  defineProps<{
    modelValue: Id<'tenants'>[]
    residents: {
      _id: Id<'tenants'>
      name: string
      room: string
      photoUrl?: string | null
    }[]
    emptyLabel?: string
    hint?: string
  }>(),
  { emptyLabel: 'No resident involved' },
)

const emit = defineEmits<{ 'update:modelValue': [Id<'tenants'>[]] }>()

const search = ref('')

const selected = computed(() =>
  props.modelValue
    .map((id) => props.residents.find((r) => r._id === id))
    .filter((r): r is NonNullable<typeof r> => !!r),
)

const matches = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.residents
  return props.residents.filter(
    (r) => r.name.toLowerCase().includes(q) || r.room.toLowerCase().includes(q),
  )
})

function toggle(id: Id<'tenants'>) {
  emit(
    'update:modelValue',
    props.modelValue.includes(id)
      ? props.modelValue.filter((x) => x !== id)
      : [...props.modelValue, id],
  )
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- What is chosen, as faces you can take back off -->
    <div class="flex min-h-[34px] flex-wrap items-center gap-1.5">
      <span v-if="!selected.length" class="text-sm text-muted-foreground">
        {{ emptyLabel }}
      </span>
      <button
        v-for="resident in selected"
        :key="resident._id"
        type="button"
        class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pl-0.5 pr-2 text-sm font-semibold text-[var(--text-strong)] transition-colors hover:bg-[var(--surface-hover)]"
        :title="`Remove ${resident.name}`"
        @click="toggle(resident._id)"
      >
        <TsResidentAvatar
          :name="resident.name"
          :tenant-id="resident._id"
          :photo-url="resident.photoUrl"
          :room="resident.room"
          size="xs"
          :expandable="false"
        />
        <span class="mono text-xs text-muted-foreground">{{ resident.room }}</span>
        {{ resident.name }}
        <DsIcon name="x" :size="13" class="text-[var(--text-subtle)]" />
      </button>
    </div>

    <!-- The roster, searchable, faces first -->
    <div class="overflow-hidden rounded-md border border-[var(--border-strong)]">
      <div class="relative border-b border-[var(--border-subtle)]">
        <span
          class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground"
        >
          <DsIcon name="search" :size="15" />
        </span>
        <input
          v-model="search"
          type="search"
          placeholder="Filter by name or room…"
          class="h-9 w-full bg-card pl-9 pr-3 text-base text-[var(--text-strong)] outline-none placeholder:text-[var(--text-subtle)]"
        >
      </div>

      <div class="max-h-56 overflow-y-auto">
        <button
          v-for="resident in matches"
          :key="resident._id"
          type="button"
          class="flex w-full cursor-pointer items-center gap-2.5 border-b border-[var(--border-subtle)] px-3 py-2 text-left transition-colors last:border-0"
          :class="
            modelValue.includes(resident._id)
              ? 'bg-[var(--brand-soft)]'
              : 'hover:bg-[var(--surface-hover)]'
          "
          @click="toggle(resident._id)"
        >
          <span
            class="inline-flex size-[18px] shrink-0 items-center justify-center rounded-xs border transition-colors"
            :class="
              modelValue.includes(resident._id)
                ? 'border-[var(--brand)] bg-[var(--brand)]'
                : 'border-[var(--border-strong)] bg-card'
            "
          >
            <DsIcon
              v-if="modelValue.includes(resident._id)"
              name="check"
              :size="12"
              :stroke-width="3"
              class="text-white"
            />
          </span>

          <TsResidentAvatar
            :name="resident.name"
            :tenant-id="resident._id"
            :photo-url="resident.photoUrl"
            :room="resident.room"
            size="sm"
            :expandable="false"
          />

          <span class="mono w-10 shrink-0 text-sm font-semibold text-[var(--text-strong)]">
            {{ resident.room }}
          </span>
          <span class="min-w-0 flex-1 truncate text-sm text-[var(--text-strong)]">
            {{ resident.name }}
          </span>
          <Badge v-if="!resident.photoUrl" variant="neutral" class="shrink-0">No photo</Badge>
        </button>

        <p v-if="!matches.length" class="px-3 py-6 text-center text-sm text-muted-foreground">
          No resident matches “{{ search }}”.
        </p>
      </div>
    </div>

    <p v-if="hint" class="text-xs text-muted-foreground">{{ hint }}</p>
  </div>
</template>
