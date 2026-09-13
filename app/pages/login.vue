<script setup lang="ts">
import { api } from '../../convex/_generated/api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
const showPassword = ref(false)

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

/**
 * The demo-account picker.
 *
 * Gated on the password constant rather than on `import.meta.dev`, because that
 * is true only for the local dev server — it kept the picker off every
 * deployment, including the ones where the roles need testing. An environment
 * that sets the variable gets the picker; one that does not never ships it.
 *
 * `__DEMO_PASSWORD__` is replaced at build time, so where it is empty this
 * folds to `null`, nothing references the import, and Rollup drops the
 * component's whole chunk — markup, usernames and password together. A `v-if`
 * on a runtime flag would not do that: the markup would ship and only the
 * rendering would be skipped. Hence a dynamic import rather than a plain
 * component.
 */
declare const __DEMO_PASSWORD__: string

const AccountPicker = __DEMO_PASSWORD__
  ? defineAsyncComponent(() => import('~/dev/AccountPicker.vue'))
  : null

function fillTestAccount(account: { username: string; password: string }) {
  mode.value = 'signIn'
  username.value = account.username
  password.value = account.password
  error.value = ''
}

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
  <div>
    <span class="welcome-icon">
      <DsIcon name="sunrise" :size="25" />
    </span>

    <h1 class="welcome-heading">
      {{ mode === 'signIn' ? 'Good to have you here.' : 'Set up this deployment.' }}
    </h1>
    <p class="welcome-intro">
      {{
        mode === 'signIn'
          ? 'Sign in to pick up where your team left off.'
          : 'Create the administrator account for this building.'
      }}
    </p>

    <form class="mt-8 flex flex-col gap-5" @submit.prevent="submit">
      <Alert v-if="error" variant="danger">
        <DsIcon name="alert-octagon" :size="17" :stroke-width="2" />
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <DsField v-if="mode === 'signUp'" v-slot="{ id }" label="Full name">
        <Input :id="id" v-model="name" autocomplete="name" placeholder="Asha Okafor" class="h-11" />
      </DsField>

      <DsField
        v-slot="{ id }"
        label="Username"
        required
        :hint="mode === 'signUp' ? 'Lowercase letters, digits, dots and hyphens.' : undefined"
      >
        <Input
          :id="id"
          v-model="username"
          type="text"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          placeholder="Your username"
          class="h-11"
          required
        />
      </DsField>

      <DsField
        v-slot="{ id }"
        label="Password"
        required
        :hint="mode === 'signUp' ? 'At least 8 characters.' : undefined"
      >
        <div class="relative">
          <Input
            :id="id"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            :autocomplete="mode === 'signIn' ? 'current-password' : 'new-password'"
            placeholder="Your password"
            class="h-11 pr-11"
            required
          />
          <button
            type="button"
            class="absolute top-1.5 right-2 grid size-8 cursor-pointer place-items-center rounded-xs border-none bg-transparent text-muted-foreground hover:bg-[var(--surface-sunken)] hover:text-[var(--text-strong)]"
            :aria-label="showPassword ? 'Hide password' : 'Show password'"
            @click="showPassword = !showPassword"
          >
            <DsIcon :name="showPassword ? 'eye-off' : 'eye'" :size="18" />
          </button>
        </div>
      </DsField>

      <Alert v-if="mode === 'signUp'" variant="info">
        <DsIcon name="shield-user" :size="17" :stroke-width="2" />
        <AlertDescription>
          This is the first account on this deployment, so it becomes the administrator.
          Every account after it is created from Admin → Staff.
        </AlertDescription>
      </Alert>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        class="h-11 w-full justify-between"
        :disabled="pending"
      >
        {{ pending ? 'Working…' : mode === 'signIn' ? 'Sign in' : 'Create account' }}
        <DsIcon name="arrow-right" :size="17" />
      </Button>

      <button
        v-if="needsBootstrap"
        type="button"
        class="cursor-pointer border-none bg-transparent p-0 text-center text-xs font-medium text-[var(--brand)] hover:underline hover:underline-offset-4"
        @click="mode = mode === 'signIn' ? 'signUp' : 'signIn'"
      >
        {{
          mode === 'signIn'
            ? 'First account on a new deployment? Create the administrator'
            : 'Already have an account? Sign in'
        }}
      </button>
    </form>

    <!--
      Who to ask, rather than a self-serve route that does not exist: accounts
      here are made by an administrator, and a "forgot password" link would be
      a promise the product cannot keep.
    -->
    <div class="access-note">
      <DsIcon name="users" :size="19" />
      <p>
        New to the team? Your administrator will<br class="hidden sm:inline" >
        help you get set up.
      </p>
    </div>

    <!-- Development only; the whole chunk is dropped from a production build. -->
    <component :is="AccountPicker" v-if="AccountPicker" @fill="fillTestAccount" />
  </div>
</template>

<style scoped>
.welcome-icon {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  margin-bottom: 24px;
  border-radius: 50%;
  background: var(--surface-sunken);
  color: var(--brand);
}

.welcome-heading {
  font-family: var(--font-display);
  font-size: 32px;
  font-weight: 500;
  line-height: 1.3;
  letter-spacing: -1.2px;
  color: var(--text-strong);
}

.welcome-intro {
  margin-top: 11px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-muted);
}

.access-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 29px;
  padding-top: 27px;
  border-top: 1px solid var(--border);
  color: var(--text-muted);
}

.access-note p {
  font-size: 10px;
  line-height: 1.8;
}
</style>
