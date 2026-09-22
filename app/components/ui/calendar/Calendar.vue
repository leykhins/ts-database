<script lang="ts" setup>
import type { CalendarRootEmits, CalendarRootProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import {
  CalendarCell,
  CalendarCellTrigger,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHead,
  CalendarGridRow,
  CalendarHeadCell,
  CalendarHeader,
  CalendarHeading,
  CalendarNext,
  CalendarPrev,
  CalendarRoot,
  useForwardPropsEmits,
} from "reka-ui"
import { ChevronLeftIcon, ChevronRightIcon } from "@/lib/icons"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

/**
 * shadcn-vue's Calendar, in one file.
 *
 * The stock block ships as ten files and pulls in a native-select and Lucide
 * for its month dropdown; this keeps the same markup and classes on the same
 * reka-ui primitives, with the chevrons taken from `@/lib/icons` like every
 * other generated component here.
 */
const props = defineProps<CalendarRootProps & { class?: HTMLAttributes["class"] }>()
const emits = defineEmits<CalendarRootEmits>()

const delegatedProps = reactiveOmit(props, "class")
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <CalendarRoot
    v-slot="{ grid, weekDays }"
    data-slot="calendar"
    :class="cn('p-3', props.class)"
    v-bind="forwarded"
  >
    <CalendarHeader class="relative flex w-full items-center justify-center pt-1">
      <CalendarHeading class="text-sm font-semibold text-[var(--text-strong)]" />
      <div class="absolute inset-x-0 flex items-center justify-between">
        <CalendarPrev
          :class="cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'size-7')"
          aria-label="Previous month"
        >
          <ChevronLeftIcon class="size-4" />
        </CalendarPrev>
        <CalendarNext
          :class="cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'size-7')"
          aria-label="Next month"
        >
          <ChevronRightIcon class="size-4" />
        </CalendarNext>
      </div>
    </CalendarHeader>

    <div class="mt-4 flex flex-col gap-y-4 sm:flex-row sm:gap-x-4 sm:gap-y-0">
      <CalendarGrid
        v-for="month in grid"
        :key="month.value.toString()"
        class="w-full border-collapse space-x-1"
      >
        <CalendarGridHead>
          <CalendarGridRow class="flex">
            <CalendarHeadCell
              v-for="day in weekDays"
              :key="day"
              class="w-8 rounded-md text-[0.8rem] font-normal text-muted-foreground"
            >
              {{ day }}
            </CalendarHeadCell>
          </CalendarGridRow>
        </CalendarGridHead>
        <CalendarGridBody>
          <CalendarGridRow
            v-for="(weekDates, index) in month.rows"
            :key="`weekDate-${index}`"
            class="mt-2 flex w-full"
          >
            <CalendarCell
              v-for="weekDate in weekDates"
              :key="weekDate.toString()"
              :date="weekDate"
              class="relative p-0 text-center text-sm focus-within:relative focus-within:z-20"
            >
              <CalendarCellTrigger
                :day="weekDate"
                :month="month.value"
                :class="
                  cn(
                    buttonVariants({ variant: 'ghost' }),
                    'size-8 p-0 font-normal tnum',
                    '[&[data-today]:not([data-selected])]:bg-[var(--surface-sunken)] [&[data-today]:not([data-selected])]:font-semibold',
                    'data-[selected]:bg-primary data-[selected]:text-primary-foreground data-[selected]:hover:bg-primary',
                    'data-[disabled]:text-muted-foreground data-[disabled]:opacity-40 data-[disabled]:pointer-events-none',
                    'data-[unavailable]:text-[var(--danger)] data-[unavailable]:line-through',
                    'data-[outside-view]:text-muted-foreground data-[outside-view]:opacity-50',
                  )
                "
              />
            </CalendarCell>
          </CalendarGridRow>
        </CalendarGridBody>
      </CalendarGrid>
    </div>
  </CalendarRoot>
</template>
