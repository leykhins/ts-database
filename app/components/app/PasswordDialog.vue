<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../convex/_generated/api'
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

/** PasswordDialog — change your own password. */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { run: changePassword, pending } = useConvexAction(api.users.changeMyPassword)

const current = ref('')
const next = ref('')
const confirm = ref('')
const error = ref('')

watch(
  () => props.open,
  (open) => {
    if (!open) return
    current.value = ''
    next.value = ''
    confirm.value = ''
    error.value = ''
  },
  { immediate: true },
)

async function save() {
  error.value = ''
  if (next.value.length < 8) {
    error.value = 'Choose a password of at least 8 characters.'
    return
  }
  if (next.value !== confirm.value) {
    error.value = 'The two new passwords do not match.'
    return
  }

  try {
    await changePassword({ currentPassword: current.value, newPassword: next.value })
    toast.success('Password changed')
    emit('close')
  } catch (e) {
    error.value = (e as Error).message || 'Could not change the password.'
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(value) => !value && emit('close')">
    <DialogContent class="gap-0 p-0 sm:max-w-[420px]">
      <DialogHeader
        class="flex-row items-center gap-3 space-y-0 border-b border-[var(--border-subtle)] p-[22px]"
      >
        <span
          class="inline-flex size-[38px] shrink-0 items-center justify-center rounded-md bg-[var(--surface-sunken)] text-[var(--text-strong)]"
        >
          <DsIcon name="key" :size="20" />
        </span>
        <div class="min-w-0 flex-1 text-left">
          <DialogTitle class="text-lg font-semibold text-[var(--text-strong)]">
            Change password
          </DialogTitle>
          <DialogDescription class="text-xs text-muted-foreground">
            Your other devices stay signed in.
          </DialogDescription>
        </div>
      </DialogHeader>

      <div class="flex flex-col gap-4 p-[22px]">
        <DsField v-slot="{ id }" label="Current password" required>
          <Input :id="id" v-model="current" type="password" autocomplete="current-password" />
        </DsField>
        <DsField v-slot="{ id }" label="New password" required hint="At least 8 characters.">
          <Input :id="id" v-model="next" type="password" autocomplete="new-password" />
        </DsField>
        <DsField v-slot="{ id }" label="Confirm new password" required :error="error">
          <Input
            :id="id"
            v-model="confirm"
            type="password"
            autocomplete="new-password"
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
          {{ pending ? 'Saving…' : 'Change password' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
