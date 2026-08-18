<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * StaffDialog — create a staff account.
 *
 * The administrator sets a temporary password and hands it over in person;
 * there is no email delivery configured on this deployment, so the password is
 * shown once, here, and never again.
 */
const props = defineProps<{
  open: boolean
  buildings: { _id: Id<'buildings'>; name: string }[]
}>()

const emit = defineEmits<{ close: [] }>()

const { run: createStaff, pending } = useConvexAction(api.users.createStaff)

type Role = RoleValue


const name = ref('')
const username = ref('')
const email = ref('')
const role = ref<Role>('rsw')
const assigned = ref<Id<'buildings'>[]>([])
const password = ref('')
const error = ref('')
const created = ref<{ name: string; username: string; password: string } | null>(null)

/**
 * Suggest `first.last` from the employee's name, so a whole team ends up with
 * usernames in one shape rather than each supervisor inventing a convention.
 * Only fills a field the administrator has not typed into.
 */
const usernameTouched = ref(false)
watch(name, (value) => {
  if (usernameTouched.value) return
  const parts = value.trim().toLowerCase().split(/\s+/).filter(Boolean)
  username.value = parts
    .join('.')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents; the key is ASCII
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 32)
})

/** A readable temporary password: staff type this once, from a sticky note. */
function suggestPassword(): string {
  const words = ['harbour', 'lantern', 'meadow', 'copper', 'anchor', 'willow', 'ember', 'quartz']
  const bytes = new Uint32Array(2)
  crypto.getRandomValues(bytes)
  const word = words[bytes[0]! % words.length]
  return `${word}-${String(bytes[1]! % 10000).padStart(4, '0')}`
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    name.value = ''
    username.value = ''
    usernameTouched.value = false
    email.value = ''
    role.value = 'rsw'
    assigned.value = []
    password.value = suggestPassword()
    error.value = ''
    created.value = null
  },
  { immediate: true },
)

function toggleBuilding(id: Id<'buildings'>, checked: boolean) {
  assigned.value = checked
    ? [...assigned.value, id]
    : assigned.value.filter((b) => b !== id)
}

async function save() {
  error.value = ''
  try {
    await createStaff({
      name: name.value.trim(),
      username: username.value.trim().toLowerCase(),
      ...(email.value.trim() ? { email: email.value.trim().toLowerCase() } : {}),
      temporaryPassword: password.value,
      role: role.value,
      ...(assigned.value.length ? { assignedBuildingIds: [...assigned.value] } : {}),
    })
    created.value = {
      name: name.value.trim(),
      username: username.value.trim().toLowerCase(),
      password: password.value,
    }
    toast.success(`${name.value.trim()} can now sign in`)
  } catch (e) {
    error.value = (e as Error).message || 'Could not create the account.'
  }
}

async function copyCredentials() {
  if (!created.value) return
  await navigator.clipboard.writeText(
    `TS Database sign-in\nUsername: ${created.value.username}\nTemporary password: ${created.value.password}`,
  )
  toast.success('Sign-in details copied')
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && emit('close')">
    <DialogContent class="gap-0 p-0 sm:max-w-[460px]">
      <DialogHeader
        class="flex-row items-center gap-3 space-y-0 border-b border-[var(--border-subtle)] p-[22px]"
      >
        <span
          class="inline-flex size-[38px] shrink-0 items-center justify-center rounded-md bg-[var(--indigo-50)] text-[var(--indigo-600)]"
        >
          <DsIcon name="user-plus" :size="20" />
        </span>
        <div class="min-w-0 flex-1 text-left">
          <DialogTitle class="text-lg font-semibold text-[var(--text-strong)]">
            {{ created ? 'Account created' : 'Add staff member' }}
          </DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground">
            {{
              created
                ? 'Hand these details over — the password is not shown again.'
                : 'Named employees only. Everyone who signs in is on this list.'
            }}
          </DialogDescription>
        </div>
      </DialogHeader>

      <!-- Handover -->
      <div v-if="created" class="flex flex-col gap-4 p-[22px]">
        <div class="flex flex-col gap-2 rounded-lg bg-[var(--surface-sunken)] p-4">
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-xs text-muted-foreground">Username</span>
            <span class="mono text-sm font-semibold text-[var(--text-strong)]">
              {{ created.username }}
            </span>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-xs text-muted-foreground">Temporary password</span>
            <span class="mono text-sm font-semibold text-[var(--text-strong)]">
              {{ created.password }}
            </span>
          </div>
        </div>
        <Alert variant="warning">
          <DsIcon name="alert-triangle" :size="17" :stroke-width="2" />
          <AlertDescription>
            {{ created.name }} should change this password after signing in.
          </AlertDescription>
        </Alert>
      </div>

      <!-- Form -->
      <div v-else class="flex flex-col gap-4 p-[22px]">
        <DsField v-slot="{ id }" label="Full name" required>
          <Input :id="id" v-model="name" placeholder="Asha Okafor" />
        </DsField>

        <DsField
          v-slot="{ id }"
          label="Username"
          required
          hint="What they sign in with. Lowercase letters, digits, dots and hyphens; 3–32 characters."
        >
          <div class="relative">
            <span
              class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground"
            >
              <DsIcon name="shield-user" :size="16" />
            </span>
            <Input
              :id="id"
              v-model="username"
              type="text"
              autocapitalize="none"
              spellcheck="false"
              placeholder="asha.okafor"
              class="pl-9"
              @input="usernameTouched = true"
            />
          </div>
        </DsField>

        <DsField v-slot="{ id }" label="Contact email" hint="Optional. Not used to sign in.">
          <div class="relative">
            <span
              class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground"
            >
              <DsIcon name="mail" :size="16" />
            </span>
            <Input
              :id="id"
              v-model="email"
              type="email"
              placeholder="name@housing.org"
              class="pl-9"
            />
          </div>
        </DsField>

        <div class="grid grid-cols-2 gap-3">
          <DsField v-slot="{ id }" label="Role">
            <Select v-model="role">
              <SelectTrigger :id="id" class="w-full">
                <SelectValue placeholder="Choose a role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="r in ROLES" :key="r.value" :value="r.value">
                  {{ r.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </DsField>

          <!--
            Multiple buildings, so a checklist rather than a select. Leaving it
            empty is legitimate and means "no access yet" — the state every new
            account starts in until someone decides where this person works.
          -->
          <DsField
            label="Buildings"
            hint="Where this person works. They see nothing outside these."
          >
            <div
              v-if="buildings.length"
              class="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-[var(--border-strong)] p-2"
            >
              <label
                v-for="b in buildings"
                :key="b._id"
                class="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 hover:bg-[var(--surface-hover)]"
              >
                <Checkbox
                  :model-value="assigned.includes(b._id)"
                  @update:model-value="(checked) => toggleBuilding(b._id, Boolean(checked))"
                />
                <span class="text-base text-[var(--text-strong)]">{{ b.name }}</span>
              </label>
            </div>
            <p v-else class="text-sm text-muted-foreground">
              No buildings yet — add one first.
            </p>
          </DsField>
        </div>

        <DsField
          v-slot="{ id }"
          label="Temporary password"
          required
          :error="error"
          hint="At least 8 characters. Hand it over in person."
        >
          <div class="flex gap-2">
            <Input :id="id" v-model="password" class="mono" :aria-invalid="!!error" />
            <Button
              variant="secondary"
              size="icon"
              aria-label="Suggest another password"
              title="Suggest another"
              @click="password = suggestPassword()"
            >
              <DsIcon name="refresh" :size="16" />
            </Button>
          </div>
        </DsField>
      </div>

      <DialogFooter
        class="gap-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-[22px] py-4"
      >
        <template v-if="created">
          <Button variant="secondary" @click="copyCredentials">
            <DsIcon name="clipboard-list" :size="17" />
            Copy details
          </Button>
          <Button variant="primary" @click="emit('close')">Done</Button>
        </template>
        <template v-else>
          <Button variant="ghost" :disabled="pending" @click="emit('close')">Cancel</Button>
          <Button variant="primary" :loading="pending" @click="save">
            <DsIcon name="user-plus" :size="17" />
            {{ pending ? 'Creating…' : 'Create account' }}
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
