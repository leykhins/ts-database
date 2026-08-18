<script setup lang="ts">
import { api } from '../../convex/_generated/api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Sign in · TS Database' })

const { signIn } = useConvexAuth()
const route = useRoute()

const mode = ref<'signIn' | 'signUp'>('signIn')
const name = ref('')
const username = ref('')
const password = ref('')
const error = ref('')
const pending = ref(false)

/**
 * Sign-up exists for exactly one account: the first one on a fresh deployment,
 * which becomes the administrator. After that, accounts come from Admin →
 * Staff. The server enforces this too — this only keeps the form honest.
 */
const { data: needsBootstrap } = useConvexQuery(api.users.needsBootstrap, {}, {
  requireAuth: false,
})

watchEffect(() => {
  if (needsBootstrap.value === false && mode.value === 'signUp') mode.value = 'signIn'
})

async function submit() {
  error.value = ''
  if (!username.value.trim() || !password.value) {
    error.value = 'Enter your username and password.'
    return
  }
  if (mode.value === 'signUp' && password.value.length < 8) {
    error.value = 'Choose a password of at least 8 characters.'
    return
  }

  pending.value = true
  try {
    await signIn({
      // Trimmed and lower-cased at both ends: the account id is the normalized
      // username, so "Asha " and "asha" must reach the server as one account.
      username: username.value.trim().toLowerCase(),
      password: password.value,
      flow: mode.value,
      ...(mode.value === 'signUp' ? { name: name.value.trim() } : {}),
    })
    await navigateTo((route.query.next as string) || '/')
  } catch (e) {
    // Convex Auth deliberately returns the same failure for "no such account"
    // and "wrong password" — don't leak which usernames exist.
    const message = (e as Error).message ?? ''
    error.value
      = message.includes('InvalidAccountId') || message.includes('InvalidSecret')
        ? 'Username or password is incorrect.'
        : message.includes('TooManyFailedAttempts')
          ? 'Too many failed attempts. Wait a while before trying again.'
          : mode.value === 'signUp' && message.includes('already')
            ? 'An account with that username already exists.'
            : 'Could not sign in. Check the details and try again.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex justify-center">
      <img src="/logo-wordmark.svg" alt="TS Database" class="h-[34px] w-auto" >
    </div>

    <Card>
      <CardContent class="p-6">
        <form class="flex flex-col gap-4" @submit.prevent="submit">
          <div>
            <h1 class="text-xl font-bold tracking-tight text-[var(--text-strong)]">
              {{ mode === 'signIn' ? 'Sign in' : 'Create administrator account' }}
            </h1>
            <p class="mt-1 text-base text-muted-foreground">
              {{
                mode === 'signIn'
                  ? 'Staff access to tenant records, rents and building checks.'
                  : 'Set up the administrator account for this deployment.'
              }}
            </p>
          </div>

          <Alert v-if="error" variant="danger">
            <DsIcon name="alert-octagon" :size="17" :stroke-width="2" />
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>

          <DsField v-if="mode === 'signUp'" v-slot="{ id }" label="Full name">
            <Input :id="id" v-model="name" autocomplete="name" placeholder="Asha Okafor" />
          </DsField>

          <DsField
            v-slot="{ id }"
            label="Username"
            required
            :hint="mode === 'signUp' ? 'Lowercase letters, digits, dots and hyphens.' : undefined"
          >
            <div class="relative">
              <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                <DsIcon name="shield-user" :size="16" />
              </span>
              <Input
                :id="id"
                v-model="username"
                type="text"
                autocomplete="username"
                autocapitalize="none"
                spellcheck="false"
                placeholder="asha.okafor"
                class="pl-9"
                required
              />
            </div>
          </DsField>

          <DsField
            v-slot="{ id }"
            label="Password"
            required
            :hint="mode === 'signUp' ? 'At least 8 characters.' : undefined"
          >
            <div class="relative">
              <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
                <DsIcon name="lock" :size="16" />
              </span>
              <Input
                :id="id"
                v-model="password"
                type="password"
                :autocomplete="mode === 'signIn' ? 'current-password' : 'new-password'"
                class="pl-9"
                required
              />
            </div>
          </DsField>

          <Alert v-if="mode === 'signUp'" variant="info">
            <DsIcon name="shield-user" :size="17" :stroke-width="2" />
            <AlertDescription>
              This is the first account on this deployment, so it becomes the administrator.
              Every account after it is created from Admin → Staff.
            </AlertDescription>
          </Alert>

          <Button type="submit" variant="primary" size="lg" class="w-full" :disabled="pending">
            {{ pending ? 'Working…' : mode === 'signIn' ? 'Sign in' : 'Create account' }}
          </Button>

          <button
            v-if="needsBootstrap"
            type="button"
            class="cursor-pointer border-none bg-transparent p-0 text-center text-xs text-muted-foreground hover:text-[var(--text-strong)]"
            @click="mode = mode === 'signIn' ? 'signUp' : 'signIn'"
          >
            {{
              mode === 'signIn'
                ? 'First account on a new deployment? Create the administrator'
                : 'Already have an account? Sign in'
            }}
          </button>
          <p v-else class="text-center text-xs text-muted-foreground">
            Accounts are created by an administrator.
          </p>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
