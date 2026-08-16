<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/** ContactDialog — add a next of kin or an emergency contact. */
const props = defineProps<{ open: boolean; tenantId: Id<'tenants'> | null; name: string }>()
const emit = defineEmits<{ close: [] }>()

const { mutate: addContact, pending } = useConvexMutation(api.profile.addContact)

const contact = reactive({
  name: '',
  relationship: '',
  phone: '',
  email: '',
  isNextOfKin: true,
  note: '',
})
const error = ref('')

watch(
  () => props.open,
  (open) => {
    if (!open) return
    Object.assign(contact, {
      name: '',
      relationship: '',
      phone: '',
      email: '',
      isNextOfKin: true,
      note: '',
    })
    error.value = ''
  },
  { immediate: true },
)

async function save() {
  if (!props.tenantId) return
  error.value = ''

  try {
    await addContact({
      tenantId: props.tenantId,
      name: contact.name,
      relationship: contact.relationship,
      phone: contact.phone.trim() || undefined,
      email: contact.email.trim() || undefined,
      isNextOfKin: contact.isNextOfKin,
      note: contact.note.trim() || undefined,
    })
    toast.success(`${contact.name.trim()} added as a contact`)
    emit('close')
  } catch (e) {
    error.value = (e as Error).message || 'Could not add the contact.'
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && emit('close')">
    <DialogContent class="gap-0 p-0 sm:max-w-[440px]">
      <DialogHeader
        class="flex-row items-center gap-3 space-y-0 border-b border-[var(--border-subtle)] p-[22px]"
      >
        <span class="inline-flex size-[38px] shrink-0 items-center justify-center rounded-md bg-[var(--indigo-50)] text-[var(--indigo-600)]">
          <DsIcon name="user-plus" :size="20" />
        </span>
        <div class="min-w-0 flex-1 text-left">
          <DialogTitle class="text-lg font-semibold text-[var(--text-strong)]">
            Add a contact
          </DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground">
            For {{ name }} — this is who gets called.
          </DialogDescription>
        </div>
      </DialogHeader>

      <div class="flex flex-col gap-4 p-[22px]">
        <div class="grid gap-3 sm:grid-cols-2">
          <DsField v-slot="{ id }" label="Name" required>
            <Input :id="id" v-model="contact.name" placeholder="Jane Doe" />
          </DsField>
          <DsField v-slot="{ id }" label="Relationship" required>
            <Input :id="id" v-model="contact.relationship" placeholder="Sister" />
          </DsField>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <DsField v-slot="{ id }" label="Phone">
            <Input :id="id" v-model="contact.phone" type="tel" placeholder="(604) 123-4567" />
          </DsField>
          <DsField v-slot="{ id }" label="Email">
            <Input :id="id" v-model="contact.email" type="email" placeholder="Optional" />
          </DsField>
        </div>

        <div class="flex items-center gap-3 rounded-md bg-[var(--surface-sunken)] p-3">
          <div class="min-w-0 flex-1">
            <Label for="nok" class="cursor-pointer text-sm font-semibold text-[var(--text-strong)]">
              Next of kin
            </Label>
            <p class="text-xs text-muted-foreground">
              The one call to make first. Setting this clears it from anyone else.
            </p>
          </div>
          <Switch id="nok" v-model="contact.isNextOfKin" />
        </div>

        <DsField v-slot="{ id }" label="Note" :error="error">
          <Input
            :id="id"
            v-model="contact.note"
            placeholder="Best reached evenings"
            :aria-invalid="!!error"
            @keyup.enter="save"
          />
        </DsField>
      </div>

      <DialogFooter
        class="gap-2.5 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-[22px] py-4"
      >
        <Button variant="ghost" :disabled="pending" @click="emit('close')">Cancel</Button>
        <Button variant="primary" :loading="pending" @click="save">
          <DsIcon name="check" :size="17" />
          {{ pending ? 'Saving…' : 'Add contact' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
