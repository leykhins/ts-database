/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'

/**
 * The rules that are expensive to get wrong: who may write what, whether an
 * administrator testing as another role is really held to it, and whether the
 * cached balances can drift from the ledger they mirror.
 */

const modules = import.meta.glob('./**/*.ts')

/**
 * `rsw` stands in for the three care roles, which hold identical authority and
 * differ only in their shift duties.
 */
type Role = 'admin' | 'building-manager' | 'supervisor' | 'rsw'

/** A building with one room and one resident, plus a user per role. */
async function setup() {
  const t = convexTest(schema, modules)

  const ids = await t.run(async (ctx) => {
    const buildingId = await ctx.db.insert('buildings', {
      name: 'Dodson Rooms',
      slug: 'dodson-rooms',
      units: 1,
    })
    const roomId = await ctx.db.insert('rooms', {
      buildingId,
      number: '101',
      floor: 'Floor 1',
      sortKey: 0,
      monthlyRentCents: 54_000,
    })
    const tenantId = await ctx.db.insert('tenants', {
      buildingId,
      roomId,
      name: 'Dwayne Robinson',
      intakeDate: '2024-03-12',
      status: 'current',
      supportLevel: 'moderate',
      monthlyRentCents: 54_000,
      depositRequiredCents: 54_000,
      balanceCents: 0,
      depositHeldCents: 0,
    })

    const users = {} as Record<Role, Id<'users'>>
    for (const role of ['admin', 'building-manager', 'supervisor', 'rsw'] as Role[]) {
      users[role] = await ctx.db.insert('users', { name: role, email: `${role}@x.org`, role })
    }

    return { buildingId, roomId, tenantId, users }
  })

  /** Act as a user, the way Convex Auth presents them to the server. */
  const as = (userId: Id<'users'>) => t.withIdentity({ subject: `${userId}|session` })

  return { t, as, ...ids }
}

describe('capabilities', () => {
  test('a supervisor may take rent; a support worker may not', async () => {
    const { as, users, tenantId } = await setup()

    await as(users.supervisor).mutation(api.rents.receivePayment, {
      tenantId,
      amountCents: 10_000,
      method: 'cash',
    })

    await expect(
      as(users.rsw).mutation(api.rents.receivePayment, {
        tenantId,
        amountCents: 10_000,
        method: 'cash',
      }),
    ).rejects.toThrow(/cannot do this/)
  })

  test('a supervisor may intake a resident; a support worker may not', async () => {
    const { as, users, buildingId } = await setup()

    const intake = {
      buildingId,
      name: 'Maria Santos',
      intakeDate: '2026-01-05',
      status: 'current' as const,
      supportLevel: 'high' as const,
      monthlyRentCents: 49_500,
      depositRequiredCents: 49_500,
    }

    await as(users.supervisor).mutation(api.tenants.create, intake)

    await expect(
      as(users.rsw).mutation(api.tenants.create, { ...intake, name: 'Nope' }),
    ).rejects.toThrow(/cannot do this/)
  })

  /**
   * The crux of the Building Manager role: it runs the fabric of a building
   * without being handed the portfolio or the staff directory.
   */
  test('a building manager may add a room; a supervisor may not', async () => {
    const { as, users, buildingId } = await setup()

    await as(users['building-manager']).mutation(api.rooms.create, {
      buildingId,
      number: '102',
      floor: 'Floor 1',
      monthlyRentCents: 54_000,
    })

    await expect(
      as(users.supervisor).mutation(api.rooms.create, {
        buildingId,
        number: '103',
        floor: 'Floor 1',
        monthlyRentCents: 54_000,
      }),
    ).rejects.toThrow(/cannot do this/)
  })

  test('a building manager may edit the building; a supervisor may not', async () => {
    const { as, users, buildingId } = await setup()

    await as(users['building-manager']).mutation(api.buildings.update, {
      buildingId,
      name: 'Dodson Rooms',
      address: '25 East Hastings Street',
      units: 48,
    })

    await expect(
      as(users.supervisor).mutation(api.buildings.update, {
        buildingId,
        name: 'Renamed',
        units: 48,
      }),
    ).rejects.toThrow(/cannot do this/)
  })

  test('a building manager may not create a building or set a role', async () => {
    const { as, users } = await setup()
    const manager = as(users['building-manager'])

    await expect(
      manager.mutation(api.buildings.create, { name: 'Nope', units: 1 }),
    ).rejects.toThrow(/cannot do this/)

    await expect(
      manager.mutation(api.users.updateRole, { userId: users.rsw, role: 'admin' }),
    ).rejects.toThrow(/cannot do this/)
  })

  test('only an administrator may change configuration', async () => {
    const { as, users } = await setup()

    await as(users.admin).mutation(api.buildings.create, { name: 'Carrall Annex', units: 36 })

    for (const role of ['building-manager', 'supervisor', 'rsw'] as Role[]) {
      await expect(
        as(users[role]).mutation(api.buildings.create, { name: 'Nope', units: 1 }),
      ).rejects.toThrow(/cannot do this/)
    }
  })

  test('a support level change records who, what and why', async () => {
    const { as, users, tenantId } = await setup()

    await as(users.supervisor).mutation(api.support.setLevel, {
      tenantId,
      supportLevel: 'critical',
      reason: 'Daily medication support needed',
    })

    const history = await as(users.supervisor).query(api.support.historyFor, { tenantId })
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      from: 'moderate',
      to: 'critical',
      reason: 'Daily medication support needed',
      changedBy: 'supervisor',
    })
  })

  test('a level change with no reason is refused', async () => {
    const { as, users, tenantId } = await setup()

    await expect(
      as(users.admin).mutation(api.support.setLevel, {
        tenantId,
        supportLevel: 'high',
        reason: '   ',
      }),
    ).rejects.toThrow(/why/)
  })
})

describe('role simulation', () => {
  test('an administrator testing as a supervisor is really held to it', async () => {
    const { as, users, tenantId, buildingId } = await setup()
    const admin = as(users.admin)

    await admin.mutation(api.users.setSimulatedRole, { role: 'supervisor' })

    const me = await admin.query(api.users.me)
    expect(me).toMatchObject({ role: 'supervisor', realRole: 'admin', simulating: true })

    // A supervisor touches neither the building's fabric nor the portfolio…
    await expect(
      admin.mutation(api.rooms.create, {
        buildingId,
        number: '999',
        floor: 'Floor 9',
        monthlyRentCents: 1,
      }),
    ).rejects.toThrow(/testing as Building Supervisor/)
    await expect(
      admin.mutation(api.buildings.create, { name: 'Nope', units: 1 }),
    ).rejects.toThrow(/testing as Building Supervisor/)

    // …but does take rent.
    await admin.mutation(api.rents.receivePayment, {
      tenantId,
      amountCents: 5_000,
      method: 'cheque',
    })
  })

  test('an administrator testing as a building manager cannot manage staff', async () => {
    const { as, users, buildingId } = await setup()
    const admin = as(users.admin)

    await admin.mutation(api.users.setSimulatedRole, { role: 'building-manager' })

    // The room is theirs to add…
    await admin.mutation(api.rooms.create, {
      buildingId,
      number: '104',
      floor: 'Floor 1',
      monthlyRentCents: 54_000,
    })

    // …the staff directory is not.
    await expect(
      admin.mutation(api.users.updateRole, { userId: users.rsw, role: 'admin' }),
    ).rejects.toThrow(/testing as Building Manager/)
  })

  test('switching back is always possible, and checks the real role', async () => {
    const { as, users } = await setup()
    const admin = as(users.admin)

    await admin.mutation(api.users.setSimulatedRole, { role: 'rsw' })
    await admin.mutation(api.users.setSimulatedRole, { role: null })

    expect(await admin.query(api.users.me)).toMatchObject({
      role: 'admin',
      simulating: false,
    })
  })

  test('a non-administrator cannot simulate anything', async () => {
    const { as, users } = await setup()

    await expect(
      as(users.supervisor).mutation(api.users.setSimulatedRole, { role: 'admin' }),
    ).rejects.toThrow(/Only an administrator/)
  })
})

describe('money', () => {
  test('the cached balance follows the ledger', async () => {
    const { t, as, users, tenantId, buildingId } = await setup()
    const staff = as(users.supervisor)

    await staff.mutation(api.rents.chargeMonthlyRent, { buildingId, periodLabel: 'Jun 2026' })
    await staff.mutation(api.rents.receivePayment, {
      tenantId,
      amountCents: 20_000,
      method: 'cash',
    })

    const tenant = await t.run((ctx) => ctx.db.get(tenantId))
    expect(tenant?.balanceCents).toBe(34_000)

    // …and it agrees with the table it mirrors.
    const ledger = await t.run((ctx) =>
      ctx.db
        .query('rentLedger')
        .withIndex('by_tenant', (q) => q.eq('tenantId', tenantId))
        .collect(),
    )
    const derived = ledger.reduce(
      (sum, e) => sum + (e.kind === 'charge' ? e.amountCents : -e.amountCents),
      0,
    )
    expect(derived).toBe(tenant?.balanceCents)
  })

  test('a period is never charged twice', async () => {
    const { as, users, buildingId } = await setup()
    const staff = as(users.supervisor)

    const first = await staff.mutation(api.rents.chargeMonthlyRent, {
      buildingId,
      periodLabel: 'Jun 2026',
    })
    const second = await staff.mutation(api.rents.chargeMonthlyRent, {
      buildingId,
      periodLabel: 'Jun 2026',
    })

    expect(first.charged).toBe(1)
    expect(second.charged).toBe(0)
    expect(second.skipped).toBe(1)
  })

  test('a deposit cannot be taken below zero', async () => {
    const { as, users, tenantId } = await setup()
    const staff = as(users.supervisor)

    await staff.mutation(api.rents.adjustDeposit, {
      tenantId,
      amountCents: 54_000,
      reason: 'Deposit collected at intake',
    })

    await expect(
      staff.mutation(api.rents.adjustDeposit, {
        tenantId,
        amountCents: -60_000,
        reason: 'Refund more than is held',
      }),
    ).rejects.toThrow(/cannot go negative/)
  })
})

describe('tenancy', () => {
  test('two residents cannot be housed in one room', async () => {
    const { as, users, buildingId, roomId } = await setup()

    await expect(
      as(users.supervisor).mutation(api.tenants.create, {
        buildingId,
        roomId,
        name: 'Maria Santos',
        intakeDate: '2026-01-05',
        status: 'current',
        supportLevel: 'high',
        monthlyRentCents: 49_500,
        depositRequiredCents: 49_500,
      }),
    ).rejects.toThrow(/already housing/)
  })

  test('an exit releases the room and leaves the money alone', async () => {
    const { t, as, users, tenantId } = await setup()
    const staff = as(users.supervisor)

    await staff.mutation(api.rents.receivePayment, {
      tenantId,
      amountCents: 0 + 10_000,
      method: 'cash',
    })
    const result = await staff.mutation(api.tenants.exit, {
      tenantId,
      exitDate: '2026-08-15',
      reason: 'Moved to supported housing',
    })

    expect(result.balanceCents).toBe(-10_000)

    const tenant = await t.run((ctx) => ctx.db.get(tenantId))
    expect(tenant).toMatchObject({ status: 'prior', exitReason: 'Moved to supported housing' })
    expect(tenant?.roomId).toBeUndefined()
    expect(tenant?.balanceCents).toBe(-10_000)
  })
})
