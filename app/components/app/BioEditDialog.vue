<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogScrollContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * BioEditDialog — the resident record behind the information page.
 *
 * Health questions are tri-state on purpose: yes, no, or not recorded. A
 * checkbox that starts unticked would file "nobody asked" as "no", and the
 * difference matters to whoever reads the sheet at 3 am.
 */
const props = defineProps<{
  open: boolean
  tenantId: Id<'tenants'> | null
  profile: {
    preferredName: string | null
    pronouns: string | null
    populationGroup: string | null
    phone: string | null
    languages: string | null
    writeUp: string | null
    sin: { masked: string; visible: boolean } | null
    flags: Record<string, string>
    health: Record<string, unknown>
    intake: Record<string, string | null>
    documents: Record<string, boolean>
  } | null
  canSeeSin: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const { mutate: updateIdentity } = useConvexMutation(api.profile.updateIdentity)
const { mutate: updateHealth } = useConvexMutation(api.profile.updateHealth)
const { mutate: setFlags } = useConvexMutation(api.profile.setFlags)
const { mutate: updateIntake } = useConvexMutation(api.profile.updateIntake)
const { mutate: updateDocuments } = useConvexMutation(api.profile.updateDocuments)

const TRISTATE = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unknown', label: 'Not recorded' },
] as const

const HEALTH_FIELDS = [
  { group: 'Physical health', key: 'careRxProgram', label: 'On CareRX medication programme?' },
  { group: 'Physical health', key: 'mobilityIssues', label: 'Mobility issues?' },
  { group: 'Physical health', key: 'developmentalDisabilities', label: 'Developmental disabilities?' },
  { group: 'Physical health', key: 'physicalDisabilities', label: 'Physical disabilities?' },
  { group: 'Physical health', key: 'hivAids', label: 'HIV / AIDS?' },
  { group: 'Physical health', key: 'dnrOrder', label: 'Valid DNR order?' },
  { group: 'Mental health', key: 'schizophrenia', label: 'Schizophrenia?' },
  { group: 'Mental health', key: 'receivesImShot', label: 'Receives IM shot?' },
  { group: 'Substance use', key: 'substanceUse', label: 'Substance use?' },
  { group: 'Substance use', key: 'overdoseAlert', label: 'Overdose alert?' },
  { group: 'Substance use', key: 'onSubstanceTreatment', label: 'On substance-use treatment?' },
] as const

const HEALTH_GROUPS = ['Physical health', 'Mental health', 'Substance use'] as const

const HEALTH_TEXT = [
  { key: 'conditions', label: 'Medical conditions', placeholder: 'Type 2 diabetes; epilepsy — seizures reported' },
  { key: 'allergies', label: 'Allergies', placeholder: 'Penicillin' },
  { key: 'medications', label: 'Medications', placeholder: 'Metformin 500mg twice daily; olanzapine' },
  { key: 'mobilityAids', label: 'Mobility aids', placeholder: 'Uses a walker; cannot manage stairs' },
  { key: 'careNotes', label: 'Care notes for responders', placeholder: 'Hard of hearing — knock loudly and wait' },
] as const

const FLAG_FIELDS = [
  { key: 'houseAbility', label: 'House-ability' },
  { key: 'mental', label: 'Mental' },
  { key: 'physical', label: 'Physical' },
  { key: 'pest', label: 'Pest' },
  { key: 'clutter', label: 'Clutter' },
] as const

const FLAG_VALUES = [
  { value: 'green', label: 'Green' },
  { value: 'amber', label: 'Amber' },
  { value: 'red', label: 'Red' },
  { value: 'none', label: 'Not recorded' },
] as const

const INTAKE_FIELDS = [
  { key: 'sourceOfIncome', label: 'Source of income', placeholder: 'Income assistance' },
  { key: 'employmentType', label: 'Employment type', placeholder: 'Not employed' },
  { key: 'mhrOffice', label: 'MHR office', placeholder: 'Downtown Eastside' },
  { key: 'gaNumber', label: 'GA number', placeholder: '' },
  { key: 'housingNeeds', label: 'Housing needs', placeholder: 'Ground floor; no stairs' },
  { key: 'subsidyInformation', label: 'Subsidy information', placeholder: 'Rent supplement — $375/mo' },
] as const

const DOCUMENT_FIELDS = [
  { key: 'intentToRent', label: 'Intent to rent given' },
  { key: 'signedTenancyAgreement', label: 'Signed tenancy agreement' },
  { key: 'covRoomRegistration', label: 'COV room registration' },
  { key: 'releaseOfInformation', label: 'Release of information signed' },
] as const

const tab = ref('identity')
const saving = ref(false)
const error = ref('')

const identity = reactive({
  preferredName: '',
  pronouns: '',
  populationGroup: '',
  phone: '',
  languages: '',
  sin: '',
  writeUp: '',
})
const health = ref<Record<string, string>>({})
const healthText = ref<Record<string, string>>({})
const flags = ref<Record<string, string>>({})
const intake = ref<Record<string, string>>({})
const documents = ref<Record<string, boolean>>({})

const toTri = (value: unknown) => (value === true ? 'yes' : value === false ? 'no' : 'unknown')
const fromTri = (value: string) => (value === 'yes' ? true : value === 'no' ? false : undefined)

watch(
  () => [props.open, props.profile] as const,
  ([open, profile]) => {
    if (!open || !profile) return
    tab.value = 'identity'
    error.value = ''

    identity.preferredName = profile.preferredName ?? ''
    identity.pronouns = profile.pronouns ?? ''
    identity.populationGroup = profile.populationGroup ?? ''
    identity.phone = profile.phone ?? ''
    identity.languages = profile.languages ?? ''
    identity.writeUp = profile.writeUp ?? ''
    identity.sin = ''

    health.value = Object.fromEntries(
      HEALTH_FIELDS.map((f) => [f.key, toTri(profile.health[f.key])]),
    )
    healthText.value = Object.fromEntries(
      HEALTH_TEXT.map((f) => [f.key, (profile.health[f.key] as string) ?? '']),
    )
    flags.value = Object.fromEntries(FLAG_FIELDS.map((f) => [f.key, profile.flags[f.key] ?? 'none']))
    intake.value = Object.fromEntries(
      INTAKE_FIELDS.map((f) => [f.key, profile.intake[f.key] ?? '']),
    )
    documents.value = Object.fromEntries(
      DOCUMENT_FIELDS.map((f) => [f.key, profile.documents[f.key] ?? false]),
    )
  },
  { immediate: true },
)

async function save() {
  if (!props.tenantId) return
  error.value = ''
  saving.value = true

  try {
    const tenantId = props.tenantId

    await updateIdentity({
      tenantId,
      preferredName: identity.preferredName,
      pronouns: identity.pronouns,
      populationGroup: identity.populationGroup,
      phone: identity.phone,
      languages: identity.languages,
      writeUp: identity.writeUp,
      // Only send the SIN when one was actually typed — an untouched field
      // must not wipe a number already on file.
      ...(identity.sin.trim() ? { sin: identity.sin } : {}),
    })

    await updateHealth({
      tenantId,
      health: {
        ...Object.fromEntries(HEALTH_FIELDS.map((f) => [f.key, fromTri(health.value[f.key] ?? 'unknown')])),
        ...Object.fromEntries(HEALTH_TEXT.map((f) => [f.key, healthText.value[f.key]?.trim() || undefined])),
      },
    })

    await setFlags({ tenantId, flags: flags.value as { houseAbility?: 'green' } })

    await updateIntake({
      tenantId,
      intake: Object.fromEntries(
        INTAKE_FIELDS.map((f) => [f.key, intake.value[f.key]?.trim() || undefined]),
      ),
    })

    await updateDocuments({ tenantId, documents: documents.value })

    toast.success('Resident record updated')
    emit('close')
  } catch (e) {
    error.value = (e as Error).message || 'Could not save the record.'
  } finally {
    saving.value = false
  }
}

const TEXTAREA_CLASS =
  'w-full min-h-[70px] rounded-md border border-[var(--border-strong)] bg-card px-3 py-2.5 text-base text-[var(--text-strong)] placeholder:text-[var(--text-subtle)] outline-none transition-[color,box-shadow,border-color] focus-visible:border-[var(--border-focus)] focus-visible:shadow-[var(--focus-ring)]'
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && emit('close')">
    <DialogScrollContent class="gap-0 p-0 sm:max-w-[560px]">
      <DialogHeader
        class="flex-row items-center gap-3 space-y-0 border-b border-[var(--border-subtle)] p-[22px]"
      >
        <span class="inline-flex size-[38px] shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-700">
          <DsIcon name="user" :size="20" />
        </span>
        <div class="min-w-0 flex-1 text-left">
          <DialogTitle class="text-lg font-semibold text-[var(--text-strong)]">
            Resident information
          </DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground">
            What appears on the record — and on the sheet handed to responders.
          </DialogDescription>
        </div>
      </DialogHeader>

      <div class="p-[22px]">
        <Tabs v-model="tab">
          <TabsList class="w-full">
            <TabsTrigger value="identity" class="flex-1">Identity</TabsTrigger>
            <TabsTrigger value="health" class="flex-1">Health</TabsTrigger>
            <TabsTrigger value="flags" class="flex-1">Condition</TabsTrigger>
            <TabsTrigger value="intake" class="flex-1">Intake</TabsTrigger>
          </TabsList>

          <!-- ---------------------------------------------------- Identity -->
          <TabsContent value="identity" class="mt-4 flex flex-col gap-4">
            <div class="grid gap-3 sm:grid-cols-2">
              <DsField v-slot="{ id }" label="Preferred name">
                <Input :id="id" v-model="identity.preferredName" placeholder="What they go by" />
              </DsField>
              <DsField v-slot="{ id }" label="Pronouns">
                <Input :id="id" v-model="identity.pronouns" placeholder="He/Him" />
              </DsField>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
              <DsField v-slot="{ id }" label="Phone number">
                <Input :id="id" v-model="identity.phone" type="tel" placeholder="(604) 123-4567" />
              </DsField>
              <DsField v-slot="{ id }" label="Population group">
                <Input :id="id" v-model="identity.populationGroup" placeholder="Self-identified" />
              </DsField>
            </div>

            <DsField v-slot="{ id }" label="Languages" hint="Anything other than English staff should know about.">
              <Input :id="id" v-model="identity.languages" placeholder="Cantonese — limited English" />
            </DsField>

            <DsField
              v-if="canSeeSin"
              v-slot="{ id }"
              label="Social insurance number"
              :hint="
                profile?.sin
                  ? `On file as ${profile.sin.masked}. Leave blank to keep it.`
                  : 'Nine digits. Never printed on the responder sheet.'
              "
            >
              <Input :id="id" v-model="identity.sin" inputmode="numeric" placeholder="000 000 000" />
            </DsField>

            <DsField label="Write-up" hint="Social developments and background.">
              <textarea
                v-model="identity.writeUp"
                :class="TEXTAREA_CLASS"
                placeholder="Background, goals, what is working…"
              />
            </DsField>
          </TabsContent>

          <!-- ------------------------------------------------------ Health -->
          <TabsContent value="health" class="mt-4 flex flex-col gap-5">
            <Alert variant="info">
              <DsIcon name="info" :size="17" :stroke-width="2" />
              <AlertDescription>
                Leave anything nobody has asked about as <strong>Not recorded</strong>. A blank
                that reads as "no" is worse than an obvious gap.
              </AlertDescription>
            </Alert>

            <div v-for="group in HEALTH_GROUPS" :key="group" class="flex flex-col gap-2">
              <span class="eyebrow">{{ group }}</span>
              <div
                v-for="field in HEALTH_FIELDS.filter((f) => f.group === group)"
                :key="field.key"
                class="flex flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] py-2"
              >
                <span class="min-w-0 flex-1 text-sm text-[var(--text-strong)]">
                  {{ field.label }}
                </span>
                <div class="inline-flex gap-1 rounded-full border border-border bg-[var(--surface-sunken)] p-0.5">
                  <button
                    v-for="option in TRISTATE"
                    :key="option.value"
                    type="button"
                    class="cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold transition-colors"
                    :class="
                      health[field.key] === option.value
                        ? option.value === 'yes'
                          ? 'bg-[var(--rose-600)] text-white'
                          : option.value === 'no'
                            ? 'bg-card text-[var(--text-strong)]'
                            : 'bg-card text-muted-foreground'
                        : 'text-muted-foreground'
                    "
                    @click="health[field.key] = option.value"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>
            </div>

            <div class="flex flex-col gap-3">
              <span class="eyebrow">Details</span>
              <DsField v-for="field in HEALTH_TEXT" :key="field.key" :label="field.label">
                <textarea
                  v-model="healthText[field.key]"
                  :class="TEXTAREA_CLASS"
                  :placeholder="field.placeholder"
                />
              </DsField>
            </div>
          </TabsContent>

          <!-- --------------------------------------------------- Condition -->
          <TabsContent value="flags" class="mt-4 flex flex-col gap-3">
            <p class="text-sm text-muted-foreground">
              The strip staff read before knocking. Amber and red are what get somebody a
              second worker at the door.
            </p>
            <div
              v-for="field in FLAG_FIELDS"
              :key="field.key"
              class="flex flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] py-2"
            >
              <span class="min-w-0 flex-1 text-sm font-semibold text-[var(--text-strong)]">
                {{ field.label }}
              </span>
              <div class="inline-flex gap-1 rounded-full border border-border bg-[var(--surface-sunken)] p-0.5">
                <button
                  v-for="option in FLAG_VALUES"
                  :key="option.value"
                  type="button"
                  class="cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold transition-colors"
                  :class="{
                    'bg-[var(--green-600)] text-white': flags[field.key] === option.value && option.value === 'green',
                    'bg-[var(--amber-600)] text-white': flags[field.key] === option.value && option.value === 'amber',
                    'bg-[var(--red-600)] text-white': flags[field.key] === option.value && option.value === 'red',
                    'bg-card text-[var(--text-strong)]': flags[field.key] === option.value && option.value === 'none',
                    'text-muted-foreground': flags[field.key] !== option.value,
                  }"
                  @click="flags[field.key] = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
          </TabsContent>

          <!-- ------------------------------------------------------ Intake -->
          <TabsContent value="intake" class="mt-4 flex flex-col gap-4">
            <div class="grid gap-3 sm:grid-cols-2">
              <DsField
                v-for="field in INTAKE_FIELDS"
                :key="field.key"
                v-slot="{ id }"
                :label="field.label"
              >
                <Input :id="id" v-model="intake[field.key]" :placeholder="field.placeholder" />
              </DsField>
            </div>

            <div class="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-4">
              <span class="eyebrow">Documents on file</span>
              <div
                v-for="field in DOCUMENT_FIELDS"
                :key="field.key"
                class="flex items-center gap-3 py-1.5"
              >
                <span class="min-w-0 flex-1 text-sm text-[var(--text-strong)]">
                  {{ field.label }}
                </span>
                <Switch v-model="documents[field.key]" :aria-label="field.label" />
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <p v-if="error" class="mt-4 flex items-center gap-1.5 text-sm text-destructive">
          <DsIcon name="alert-circle" :size="15" />
          {{ error }}
        </p>
      </div>

      <DialogFooter
        class="gap-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-[22px] py-4"
      >
        <Button variant="ghost" :disabled="saving" @click="emit('close')">Cancel</Button>
        <Button variant="primary" :loading="saving" @click="save">
          <DsIcon name="check" :size="17" />
          {{ saving ? 'Saving…' : 'Save record' }}
        </Button>
      </DialogFooter>
    </DialogScrollContent>
  </Dialog>
</template>
