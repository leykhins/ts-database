<script setup lang="ts">
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * Fill the sign-in form with a test account. Development only.
 *
 * This file lives outside `app/components` on purpose. Anything in that
 * directory is auto-registered and can be pulled into the graph by the
 * component resolver; this one enters only through the dynamic import in
 * `login.vue`, which sits behind `import.meta.dev`. In a production build that
 * constant folds to `false`, nothing references the import, and Rollup drops
 * the whole chunk — the markup, the usernames and the password with it. That is
 * a claim worth checking rather than trusting: build, then grep `.output` for
 * `test.admin`.
 *
 * `__DEV_PASSWORD__` is a compile-time constant defined in `nuxt.config.ts`,
 * fed by `NUXT_PUBLIC_DEV_PASSWORD` in development and hard-coded to `""` in
 * production. No working credential is committed even in a file that is meant
 * to be dev only. The accounts themselves exist nowhere until somebody runs:
 *
 *     npx convex run users:seedTestAccounts '{"password":"…"}'
 *
 * It fills the form and stops. A picker that signs you straight in is one that
 * signs you in by accident on the way past.
 */
const ACCOUNTS = [
  { username: 'test.admin', name: 'Avery Quinn', role: 'Administrator', icon: 'shield-user' },
  { username: 'test.manager', name: 'Dana Whitlock', role: 'Building Manager', icon: 'building-2' },
  { username: 'test.coordinator', name: 'Priya Raman', role: 'Coordinator', icon: 'clipboard-list' },
  { username: 'test.rsw', name: 'Devon Mraz', role: 'Resident Support Worker', icon: 'user-check' },
  { username: 'test.wellness', name: 'Nia Okonkwo', role: 'Wellness Worker', icon: 'heart-pulse' },
  { username: 'test.support', name: 'Bo Tran', role: 'Home Support Worker', icon: 'home' },
]

const emit = defineEmits<{ fill: [{ username: string; password: string }] }>()

declare const __DEV_PASSWORD__: string
const password = __DEV_PASSWORD__

function pick(account: (typeof ACCOUNTS)[number]) {
  emit('fill', { username: account.username, password })
}
</script>

<template>
  <div class="mt-5 border-t border-dashed border-border pt-4">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button type="button" variant="secondary" size="sm" class="w-full">
          <DsIcon name="shield-user" :size="15" />
          Fill a test account
          <DsIcon name="chevrons-up-down" :size="14" class="ml-auto opacity-60" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="center" class="w-[290px]">
        <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">
          Development only. Each role sees a different app — the frontline roles
          land on the Care Console.
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem
          v-for="account in ACCOUNTS"
          :key="account.username"
          class="gap-2.5 py-2"
          @select="pick(account)"
        >
          <DsIcon :name="account.icon" :size="16" class="shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium text-[var(--text-strong)]">
              {{ account.role }}
            </span>
            <span class="block truncate text-xs text-muted-foreground">
              {{ account.username }} · {{ account.name }}
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <p class="mt-2 text-center text-[11px] text-muted-foreground">
      Fills the form — you still press Sign in.
    </p>
  </div>
</template>
