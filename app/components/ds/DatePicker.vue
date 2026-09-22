<script setup lang="ts">
import { parseDate, type DateValue } from '@internationalized/date'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * DatePicker — shadcn's popover-and-calendar pattern, speaking the app's own
 * date format.
 *
 * Calendar days in this app are ISO `YYYY-MM-DD` strings (see the schema), so
 * that is what goes in and comes out. The `DateValue` the calendar wants is
 * an implementation detail of this one component and never leaks into a page.
 */
const props = withDefaults(
  defineProps<{
    modelValue: string | null | undefined
    /** Latest selectable day, `YYYY-MM-DD`. */
    max?: string
    /** Earliest selectable day, `YYYY-MM-DD`. */
    min?: string
    placeholder?: string
    id?: string
    clearable?: boolean
    class?: string
  }>(),
  { placeholder: 'Pick a date', clearable: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()

const open = ref(false)

function toDate(iso: string | null | undefined): DateValue | undefined {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined
  try {
    return parseDate(iso)
  } catch {
    return undefined
  }
}

const value = computed(() => toDate(props.modelValue))
const maxValue = computed(() => toDate(props.max))
const minValue = computed(() => toDate(props.min))

const label = computed(() => {
  if (!props.modelValue) return null
  const d = new Date(`${props.modelValue}T00:00:00Z`)
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
})

function select(next: DateValue | undefined) {
  emit('update:modelValue', next ? next.toString() : null)
  open.value = false
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        :id="id"
        variant="secondary"
        :class="cn('justify-start gap-2 px-3 font-normal tnum', !modelValue && 'text-muted-foreground', props.class)"
      >
        <DsIcon name="calendar" :size="16" class="shrink-0 text-muted-foreground" />
        <span class="truncate">{{ label ?? placeholder }}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-auto p-0" align="start">
      <Calendar
        :model-value="value"
        :max-value="maxValue"
        :min-value="minValue"
        :default-placeholder="value ?? maxValue"
        initial-focus
        weekday-format="short"
        @update:model-value="(v) => select(v as DateValue | undefined)"
      />
      <div
        v-if="clearable && modelValue"
        class="border-t border-[var(--border-subtle)] p-2"
      >
        <Button variant="ghost" size="sm" class="w-full" @click="select(undefined)">Clear</Button>
      </div>
    </PopoverContent>
  </Popover>
</template>
