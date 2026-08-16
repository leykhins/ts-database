<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../convex/_generated/api'
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
 * RoleTester — an administrator acting as another role.
 *
 * The chosen role is stored on the server and honoured by every permission
 * check there, so what you see is what that role actually gets: the same
 * refusals, not a preview. Switching back checks the real role, so it is
 * always possible to get out.
 */
const { me } = useMe()
const { mutate: setSimulatedRole, pending } = useConvexMutation(api.users.setSimulatedRole)

const OPTIONS = ROLES

async function pick(role: RoleValue | null) {
  try {
    await setSimulatedRole({ role })
    toast.success(
      role && role !== me.value?.realRole
        ? `Testing as ${ROLES.find((r) => r.value === role)?.label}`
        : 'Back to your own role',
      { description: 'Server permissions follow this, not just the screens.' },
    )
  } catch (e) {
    toast.error('Could not switch role', { description: (e as Error).message })
  }
}
</script>

<template>
  <DropdownMenu v-if="me?.canAdminister">
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        class="flex w-full cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        :class="
          me.simulating
            ? 'border-[var(--amber-500)]/40 bg-[var(--amber-500)]/15 hover:bg-[var(--amber-500)]/25'
            : 'border-white/10 bg-white/[0.04] hover:bg-white/10'
        "
        :disabled="pending"
      >
        <DsIcon
          name="shield-user"
          :size="16"
          :class="me.simulating ? 'text-[var(--amber-500)]' : 'text-sidebar-foreground'"
        />
        <span class="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
          <span class="block text-[10px] uppercase tracking-[0.08em] text-sidebar-foreground">
            {{ me.simulating ? 'Testing as' : 'View as' }}
          </span>
          <span class="block truncate text-xs font-semibold text-white">
            {{ me.roleLabel }}
          </span>
        </span>
        <DsIcon
          name="chevrons-up-down"
          :size="14"
          class="text-sidebar-foreground group-data-[collapsible=icon]:hidden"
        />
      </button>
    </DropdownMenuTrigger>

    <DropdownMenuContent align="start" side="top" class="w-[248px]">
      <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">
        See the app as another role. Permissions are enforced for real while you do.
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        v-for="option in OPTIONS"
        :key="option.value"
        class="justify-between gap-3"
        :class="option.value === me.role && 'font-semibold text-[var(--brand-strong)]'"
        @select="pick(option.value)"
      >
        <span>{{ option.label }}</span>
        <span v-if="option.value === me.realRole" class="text-2xs text-muted-foreground">
          yours
        </span>
      </DropdownMenuItem>
      <template v-if="me.simulating">
        <DropdownMenuSeparator />
        <DropdownMenuItem @select="pick(null)">
          <DsIcon name="refresh" :size="15" />
          Stop testing
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
