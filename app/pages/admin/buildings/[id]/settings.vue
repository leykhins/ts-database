<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { formatMinutes, parseMinutes } from '~/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * Site settings — how this building runs.
 *
 * Meal sittings, laundry hours and supply limits are the three things every
 * site does differently, so they belong to a site manager rather than to an
 * administrator: `site-config`, which coordinators hold too.
 */
const { me, can, denied } = useMe()
const route = useRoute()
const buildingId = computed(() => route.params.id as Id<'buildings'>)

/**
 * One set of rules at a time. Stacked, the three cards ran well past a screen,
 * so changing a supply cap meant scrolling through meal sittings to reach it —
 * and each card saves independently, so there is nothing to lose by switching.
 */
const tab = ref<'meals' | 'laundry' | 'supplies' | 'rounds'>('meals')

const { data: settings } = useConvexQuery(api.settings.get, () => ({
  buildingId: buildingId.value,
}))

usePageHeader(() => ({
  eyebrow: 'Administration',
  title: settings.value ? `${settings.value.building.name} · Settings` : 'Site settings',
}))

const { mutate: setMeals, pending: savingMeals } = useConvexMutation(api.settings.setMeals)
const { mutate: setLaundry, pending: savingLaundry } = useConvexMutation(api.settings.setLaundry)
const { mutate: setSupplyLimits, pending: savingLimits } = useConvexMutation(
  api.settings.setSupplyLimits,
)
const { mutate: setRoutines, pending: savingRounds } = useConvexMutation(api.routines.setRoutines)

const MEAL_LABEL: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
}

const SUPPLY_LABEL: Record<string, string> = {
  'bubble-pipe': 'Bubble pipe',
  'stem-pipe': 'Stem pipe',
  foil: 'Foil',
  'needle-kit': 'Needle kit',
  naloxone: 'Naloxone kit',
  other: 'Other',
}

/* Local copies, hydrated once, so typing is not fought by the subscription. */
const meals = ref<
  { meal: string; menu: string; from: string; to: string; served: boolean }[]
>([])
const laundry = reactive({ from: '', to: '', slotHours: '2', weekly: '2' })
const limits = ref<Record<string, string>>({})
const rounds = ref<
  { routine: string; label: string; detail: string; icon: string; every: string; enabled: boolean }[]
>([])
const hydrated = ref(false)

watchEffect(() => {
  if (!settings.value || hydrated.value) return
  hydrated.value = true

  meals.value = settings.value.meals.map((m) => ({
    meal: m.meal,
    menu: m.menu ?? '',
    from: formatMinutes(m.fromMinutes),
    to: formatMinutes(m.toMinutes),
    served: m.served,
  }))
  laundry.from = formatMinutes(settings.value.laundry.fromMinutes)
  laundry.to = formatMinutes(settings.value.laundry.toMinutes)
  laundry.slotHours = String(settings.value.laundry.slotMinutes / 60)
  laundry.weekly = String(settings.value.laundry.maxPerResidentPerWeek)
  limits.value = Object.fromEntries(
    Object.entries(settings.value.supplyLimits).map(([k, n]) => [k, String(n)]),
  )
  rounds.value = settings.value.routines.map((r) => ({
    routine: r.routine,
    label: r.label,
    detail: r.detail,
    icon: r.icon,
    every: String(r.everyMinutes),
    enabled: r.enabled,
  }))
})

/** The slots the current laundry settings would produce, shown as you type. */
const previewSlots = computed(() => {
  const from = parseMinutes(laundry.from)
  const to = parseMinutes(laundry.to)
  const span = Math.round(Number(laundry.slotHours) * 60)
  if (from === null || to === null || !span || span < 15 || to <= from) return []

  const out: string[] = []
  for (let start = from; start + span <= to; start += span) {
    out.push(`${formatMinutes(start)} – ${formatMinutes(start + span)}`)
  }
  return out
})

async function saveMeals() {
  const parsed = meals.value.map((m) => {
    const from = parseMinutes(m.from)
    const to = parseMinutes(m.to)
    if (from === null || to === null) {
      throw new Error(`${MEAL_LABEL[m.meal]}: use a time like 7:30 am.`)
    }
    return {
      meal: m.meal as 'breakfast',
      menu: m.menu,
      fromMinutes: from,
      toMinutes: to,
      served: m.served,
    }
  })

  try {
    await setMeals({ buildingId: buildingId.value, meals: parsed })
    toast.success('Meal sittings saved')
  } catch (e) {
    toast.error('Could not save the sittings', { description: (e as Error).message })
  }
}

async function saveLaundry() {
  const from = parseMinutes(laundry.from)
  const to = parseMinutes(laundry.to)
  if (from === null || to === null) {
    toast.error('Use times like 8:00 am and 8:00 pm')
    return
  }

  try {
    await setLaundry({
      buildingId: buildingId.value,
      fromMinutes: from,
      toMinutes: to,
      slotMinutes: Math.round(Number(laundry.slotHours) * 60),
      maxPerResidentPerWeek: Math.max(0, Math.round(Number(laundry.weekly) || 0)),
    })
    toast.success('Laundry hours saved')
  } catch (e) {
    toast.error('Could not save the hours', { description: (e as Error).message })
  }
}

async function saveLimits() {
  try {
    await setSupplyLimits({
      buildingId: buildingId.value,
      supplyLimits: Object.fromEntries(
        Object.entries(limits.value).map(([k, n]) => [k, Math.max(0, Math.round(Number(n) || 0))]),
      ),
    })
    toast.success('Supply limits saved')
  } catch (e) {
    toast.error('Could not save the limits', { description: (e as Error).message })
  }
}

async function saveRounds() {
  try {
    await setRoutines({
      buildingId: buildingId.value,
      routines: rounds.value.map((r) => ({
        routine: r.routine as 'rounds',
        everyMinutes: Math.round(Number(r.every) || 0),
        enabled: r.enabled,
      })),
    })
    toast.success('Round frequencies saved')
  } catch (e) {
    toast.error('Could not save the frequencies', { description: (e as Error).message })
  }
}

/** "Every 90 minutes" in the words a manager would use, as they type. */
function everyLabel(minutes: number): string {
  if (!minutes || minutes < 15) return 'Not a valid interval'
  if (minutes < 60) return `Every ${minutes} minutes`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const hours = `${h} ${h === 1 ? 'hour' : 'hours'}`
  return m === 0 ? `Every ${hours}` : `Every ${hours} ${m} min`
}

const readOnly = computed(() => !can('site-config'))
</script>

<template>
  <div class="flex flex-col gap-5">
    <NuxtLink
      :to="`/admin/buildings/${buildingId}`"
      class="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-[var(--text-strong)]"
    >
      <DsIcon name="arrow-left" :size="16" /> Back to rooms
    </NuxtLink>

    <DsSectionHeader
      :eyebrow="settings?.building.name"
      title="Site settings"
      description="How this building runs. Every site serves at different times and caps supplies differently — these are the numbers the service screens work from."
    />

    <p v-if="readOnly" class="flex items-center gap-2 text-sm text-muted-foreground">
      <DsIcon name="lock" :size="15" />
      {{ denied('site-config') }} Site managers and administrators can change these.
    </p>

    <TsLoadingState v-if="!settings" label="Loading settings…" :rows="4" />

    <template v-else>
      <Tabs v-model="tab" class="w-full">
        <TabsList>
          <TabsTrigger value="meals">
            <DsIcon name="notes" :size="15" />
            Meals
          </TabsTrigger>
          <TabsTrigger value="laundry">
            <DsIcon name="refresh" :size="15" />
            Laundry
          </TabsTrigger>
          <TabsTrigger value="supplies">
            <DsIcon name="shield-check" :size="15" />
            Supplies
          </TabsTrigger>
          <TabsTrigger value="rounds">
            <DsIcon name="clock" :size="15" />
            Rounds
          </TabsTrigger>
        </TabsList>

        <TabsContent value="meals" class="mt-5">
      <Card>
        <CardContent class="flex flex-col gap-4 p-5">
          <div class="flex items-center gap-3">
            <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--amber-50)] text-[var(--amber-700)]">
              <DsIcon name="notes" :size="18" />
            </span>
            <div class="min-w-0 flex-1">
              <span class="eyebrow">Food</span>
              <div class="font-semibold text-[var(--text-strong)]">Meal sittings</div>
            </div>
            <Button
              variant="primary"
              size="sm"
              :loading="savingMeals"
              :disabled="readOnly"
              @click="saveMeals"
            >
              <DsIcon name="check" :size="15" />
              Save sittings
            </Button>
          </div>

          <p class="-mt-2 text-sm text-muted-foreground">
            A sitting that is not served drops off the food checklist entirely.
          </p>

          <div
            v-for="sitting in meals"
            :key="sitting.meal"
            class="flex flex-wrap items-end gap-3 border-t border-[var(--border-subtle)] pt-3"
          >
            <div class="w-[110px] pb-2 font-semibold text-[var(--text-strong)]">
              {{ MEAL_LABEL[sitting.meal] }}
            </div>

            <DsField v-slot="{ id }" label="From" class="w-[110px]">
              <Input :id="id" v-model="sitting.from" :disabled="readOnly" placeholder="7:30 am" />
            </DsField>
            <DsField v-slot="{ id }" label="To" class="w-[110px]">
              <Input :id="id" v-model="sitting.to" :disabled="readOnly" placeholder="9:00 am" />
            </DsField>
            <DsField v-slot="{ id }" label="What is served" class="min-w-[220px] flex-1">
              <Input
                :id="id"
                v-model="sitting.menu"
                :disabled="readOnly"
                placeholder="Hot breakfast, cereal, fruit"
              />
            </DsField>

            <div class="flex items-center gap-2 pb-2">
              <Switch
                :id="`served-${sitting.meal}`"
                v-model="sitting.served"
                :disabled="readOnly"
                :aria-label="`${MEAL_LABEL[sitting.meal]} served here`"
              />
              <label :for="`served-${sitting.meal}`" class="cursor-pointer text-sm">Served</label>
            </div>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="laundry" class="mt-5">
      <Card>
        <CardContent class="flex flex-col gap-4 p-5">
          <div class="flex items-center gap-3">
            <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--cyan-50)] text-[var(--cyan-700)]">
              <DsIcon name="refresh" :size="18" />
            </span>
            <div class="min-w-0 flex-1">
              <span class="eyebrow">Laundry room</span>
              <div class="font-semibold text-[var(--text-strong)]">Hours and slots</div>
            </div>
            <Button
              variant="primary"
              size="sm"
              :loading="savingLaundry"
              :disabled="readOnly"
              @click="saveLaundry"
            >
              <DsIcon name="check" :size="15" />
              Save hours
            </Button>
          </div>

          <div class="flex flex-wrap items-end gap-3">
            <DsField v-slot="{ id }" label="Opens" class="w-[120px]">
              <Input :id="id" v-model="laundry.from" :disabled="readOnly" placeholder="8:00 am" />
            </DsField>
            <DsField v-slot="{ id }" label="Closes" class="w-[120px]">
              <Input :id="id" v-model="laundry.to" :disabled="readOnly" placeholder="8:00 pm" />
            </DsField>
            <DsField v-slot="{ id }" label="Slot length (hours)" class="w-[150px]">
              <Input
                :id="id"
                v-model="laundry.slotHours"
                inputmode="decimal"
                :disabled="readOnly"
              />
            </DsField>
            <DsField
              v-slot="{ id }"
              label="Slots per resident, per week"
              class="w-[200px]"
              hint="0 for no cap."
            >
              <Input :id="id" v-model="laundry.weekly" inputmode="numeric" :disabled="readOnly" />
            </DsField>
          </div>

          <div class="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-3">
            <span class="eyebrow">That gives {{ previewSlots.length }} slots a day</span>
            <div class="flex flex-wrap gap-1.5">
              <Badge v-for="slot in previewSlots" :key="slot" variant="neutral">{{ slot }}</Badge>
              <span v-if="!previewSlots.length" class="text-sm text-destructive">
                Those hours produce no slots — check the times and the slot length.
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="supplies" class="mt-5">
      <Card>
        <CardContent class="flex flex-col gap-4 p-5">
          <div class="flex items-center gap-3">
            <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--rose-50)] text-[var(--rose-600)]">
              <DsIcon name="shield-check" :size="18" />
            </span>
            <div class="min-w-0 flex-1">
              <span class="eyebrow">Harm reduction</span>
              <div class="font-semibold text-[var(--text-strong)]">Daily supply limits</div>
            </div>
            <Button
              variant="primary"
              size="sm"
              :loading="savingLimits"
              :disabled="readOnly"
              @click="saveLimits"
            >
              <DsIcon name="check" :size="15" />
              Save limits
            </Button>
          </div>

          <p class="-mt-2 text-sm text-muted-foreground">
            How many of each a resident may be given in a day. 0 means no cap. The desk cannot
            issue past these — the limit is enforced on the server, not just on the form.
          </p>

          <div class="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
            <DsField
              v-for="(label, item) in SUPPLY_LABEL"
              :key="item"
              v-slot="{ id }"
              :label="label"
            >
              <Input
                :id="id"
                v-model="limits[item]"
                inputmode="numeric"
                :disabled="readOnly"
                placeholder="0"
              />
            </DsField>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="rounds" class="mt-5">
      <Card>
        <CardContent class="flex flex-col gap-4 p-5">
          <div class="flex items-center gap-3">
            <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--blue-50)] text-[var(--blue-600)]">
              <DsIcon name="clock" :size="18" />
            </span>
            <div class="min-w-0 flex-1">
              <span class="eyebrow">On the clock</span>
              <div class="font-semibold text-[var(--text-strong)]">Running rounds</div>
            </div>
            <Button
              variant="primary"
              size="sm"
              :loading="savingRounds"
              :disabled="readOnly"
              @click="saveRounds"
            >
              <DsIcon name="check" :size="15" />
              Save frequencies
            </Button>
          </div>

          <p class="-mt-2 text-sm text-muted-foreground">
            How often each round comes due here. A tower with an elevator and a back alley
            walks the perimeter more often than a twelve-unit house. A round that is switched
            off leaves the Care Console entirely — it is not shown as skipped.
          </p>

          <div
            v-for="round in rounds"
            :key="round.routine"
            class="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md border border-border p-4"
            :class="!round.enabled && 'opacity-60'"
          >
            <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-sm bg-[var(--surface-sunken)] text-muted-foreground">
              <DsIcon :name="round.icon" :size="18" />
            </span>

            <div class="min-w-[180px] flex-1">
              <div class="font-semibold text-[var(--text-strong)]">{{ round.label }}</div>
              <div class="text-xs text-muted-foreground">{{ round.detail }}</div>
            </div>

            <DsField v-slot="{ id }" label="Every (minutes)" class="w-[140px]">
              <Input
                :id="id"
                v-model="round.every"
                inputmode="numeric"
                :disabled="readOnly || !round.enabled"
              />
            </DsField>

            <div class="flex w-[150px] flex-col gap-1">
              <span class="text-xs text-muted-foreground">
                {{ round.enabled ? everyLabel(Number(round.every)) : 'Not run at this site' }}
              </span>
              <label class="flex items-center gap-2 text-sm">
                <Switch v-model="round.enabled" :disabled="readOnly" />
                <span class="text-muted-foreground">{{ round.enabled ? 'On' : 'Off' }}</span>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>
    </template>
  </div>
</template>
