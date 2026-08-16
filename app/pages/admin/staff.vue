<script setup lang="ts">
import { toast } from 'vue-sonner'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { formatDate } from '~/utils/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/**
 * Admin → Staff. Who can sign in, what they may do, and which building they
 * come back to. Accounts are created here, never self-served.
 */
const { isReady, isAdmin } = useRequireAdmin()
usePageHeader({ eyebrow: 'Administration', title: 'Staff' })

const { data: staff, isLoading } = useConvexQuery(api.users.list)
const { data: buildings } = useConvexQuery(api.buildings.list)

const { mutate: updateRole } = useConvexMutation(api.users.updateRole)
const { mutate: setHomeBuilding } = useConvexMutation(api.users.setHomeBuilding)
const { run: resetPassword } = useConvexAction(api.users.resetPassword)
const { run: removeStaff, pending: removePending } = useConvexAction(api.users.remove)

type StaffRow = NonNullable<typeof staff.value>[number]
type Role = StaffRow['role']


const NO_BUILDING = 'none'
const addOpen = ref(false)

const buildingOptions = computed(() =>
  (buildings.value ?? []).map((b) => ({ _id: b._id, name: b.name })),
)

const adminCount = computed(
  () => staff.value?.filter((s) => s.role === 'admin').length ?? 0,
)

async function changeRole(row: StaffRow, role: string) {
  if (role === row.role) return
  try {
    await updateRole({ userId: row._id, role: role as Role })
    toast.success(`${row.name} is now ${ROLES.find((r) => r.value === role)?.label}`)
  } catch (e) {
    toast.error('Could not change the role', { description: (e as Error).message })
  }
}

async function changeBuilding(row: StaffRow, value: string) {
  try {
    await setHomeBuilding({
      userId: row._id,
      homeBuildingId: value === NO_BUILDING ? null : (value as Id<'buildings'>),
    })
    toast.success(`${row.name}'s home building updated`)
  } catch (e) {
    toast.error('Could not set the home building', { description: (e as Error).message })
  }
}

async function reset(row: StaffRow) {
  const password = window.prompt(
    `New temporary password for ${row.name} (at least 8 characters). They will be signed out everywhere.`,
  )
  if (!password) return
  try {
    await resetPassword({ userId: row._id, temporaryPassword: password })
    toast.success(`Password reset for ${row.name}`, {
      description: 'Hand the new password over in person.',
    })
  } catch (e) {
    toast.error('Could not reset the password', { description: (e as Error).message })
  }
}

async function remove(row: StaffRow) {
  if (
    !window.confirm(
      `Remove ${row.name}'s account? They lose access immediately. Entries they posted stay on the record.`,
    )
  ) {
    return
  }
  try {
    await removeStaff({ userId: row._id })
    toast.success(`${row.name}'s account removed`)
  } catch (e) {
    toast.error('Could not remove the account', { description: (e as Error).message })
  }
}
</script>

<template>
  <div v-if="isReady && isAdmin" class="flex flex-col gap-5">
    <DsSectionHeader
      eyebrow="Administration"
      title="Staff"
      description="Everyone who can sign in. Roles decide who may change buildings, rooms and accounts — everything else is open to all staff."
    >
      <template #actions>
        <Button variant="primary" @click="addOpen = true">
          <DsIcon name="user-plus" :size="17" />
          Add staff member
        </Button>
      </template>
    </DsSectionHeader>

    <TsLoadingState v-if="isLoading" label="Loading staff…" :rows="5" />

    <Table v-else>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead class="w-[220px]">Email</TableHead>
          <TableHead class="w-[190px]">Role</TableHead>
          <TableHead class="w-[190px]">Home building</TableHead>
          <TableHead class="w-[120px]">Added</TableHead>
          <TableHead class="w-[110px]" />
        </TableRow>
      </TableHeader>

      <TableBody>
        <TableRow v-for="row in staff" :key="row._id">
          <TableCell>
            <div class="flex items-center gap-2.5">
              <DsPersonAvatar :name="row.name" size="sm" />
              <span class="font-semibold text-[var(--text-strong)]">{{ row.name }}</span>
              <Badge v-if="row.isSelf" variant="info">You</Badge>
            </div>
          </TableCell>

          <TableCell class="text-muted-foreground">{{ row.email || '—' }}</TableCell>

          <TableCell>
            <Select
              :model-value="row.role"
              @update:model-value="(value) => changeRole(row, String(value))"
            >
              <SelectTrigger class="w-full" :aria-label="`Role for ${row.name}`">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="r in ROLES" :key="r.value" :value="r.value">
                  {{ r.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </TableCell>

          <TableCell>
            <Select
              :model-value="row.homeBuildingId ?? NO_BUILDING"
              @update:model-value="(value) => changeBuilding(row, String(value))"
            >
              <SelectTrigger class="w-full" :aria-label="`Home building for ${row.name}`">
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="NO_BUILDING">No home building</SelectItem>
                <SelectItem v-for="b in buildingOptions" :key="b._id" :value="b._id">
                  {{ b.name }}
                </SelectItem>
              </SelectContent>
            </Select>
          </TableCell>

          <TableCell class="text-muted-foreground">{{ formatDate(row.createdAt) }}</TableCell>

          <TableCell class="text-right">
            <div class="flex justify-end gap-1.5">
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label="Reset password"
                title="Reset password"
                @click="reset(row)"
              >
                <DsIcon name="key" :size="16" />
              </Button>
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label="Remove account"
                title="Remove account"
                :disabled="row.isSelf || removePending"
                @click="remove(row)"
              >
                <DsIcon name="trash" :size="16" />
              </Button>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <p v-if="adminCount === 1" class="text-xs text-muted-foreground">
      One administrator on this deployment. Add a second before anyone changes that role —
      a deployment with no administrator can only be recovered from the command line.
    </p>

    <TsStaffDialog :open="addOpen" :buildings="buildingOptions" @close="addOpen = false" />
  </div>

  <TsLoadingState v-else label="Checking access…" :rows="3" />
</template>
