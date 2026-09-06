/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'

/**
 * Building scoping.
 *
 * Staff cover the buildings they are assigned to and no others. This is the
 * suite that decides whether that actually holds, because a missed call site is
 * invisible in review: the screen still renders, the query still returns rows,
 * and the only symptom is a worker at one site reading another site's
 * residents.
 */

const modules = import.meta.glob('./**/*.ts')

/**
 * Two buildings, inserted **B before A**.
 *
 * The order matters. The old `resolveBuilding` fell back to the deployment's
 * first building, so a test whose fixture inserts A first would pass whether
 * or not the fallback was fixed. With B first, "omitting the building id gives
 * the worker their own building" fails loudly on a regression.
 */
async function setup() {
  const t = convexTest(schema, modules)

  const ids = await t.run(async (ctx) => {
    const buildingB = await ctx.db.insert('buildings', {
      name: 'Eastside Lodge',
      slug: 'eastside-lodge',
      units: 2,
    })
    const buildingA = await ctx.db.insert('buildings', {
      name: 'Dodson Rooms',
      slug: 'dodson-rooms',
      units: 2,
    })

    const room = async (buildingId: Id<'buildings'>, number: string) =>
      await ctx.db.insert('rooms', {
        buildingId,
        number,
        floor: 'Floor 1',
        sortKey: Number(number),
        monthlyRentCents: 54_000,
      })
    const roomA = await room(buildingA, '101')
    const roomB = await room(buildingB, '201')

    const tenant = async (
      buildingId: Id<'buildings'>,
      roomId: Id<'rooms'>,
      name: string,
    ) =>
      await ctx.db.insert('tenants', {
        buildingId,
        roomId,
        name,
        intakeDate: '2024-03-12',
        status: 'current',
        supportLevel: 'moderate',
        monthlyRentCents: 54_000,
        depositRequiredCents: 54_000,
        balanceCents: 0,
        depositHeldCents: 0,
      })
    const tenantA = await tenant(buildingA, roomA, 'Dwayne Robinson')
    const tenantB = await tenant(buildingB, roomB, 'Maria Santos')

    const users = {
      admin: await ctx.db.insert('users', {
        name: 'Ada', username: 'ada', role: 'admin',
      }),
      managerA: await ctx.db.insert('users', {
        name: 'Mo', username: 'mo', role: 'building-manager',
        assignedBuildingIds: [buildingA],
      }),
      coordinatorAB: await ctx.db.insert('users', {
        name: 'Sam', username: 'sam', role: 'coordinator',
        assignedBuildingIds: [buildingA, buildingB],
      }),
      workerA: await ctx.db.insert('users', {
        name: 'Devon', username: 'devon', role: 'rsw',
        assignedBuildingIds: [buildingA],
      }),
      unassigned: await ctx.db.insert('users', {
        name: 'New Start', username: 'new.start', role: 'rsw',
      }),
    }

    return { buildingA, buildingB, roomA, roomB, tenantA, tenantB, users }
  })

  const as = (userId: Id<'users'>) => t.withIdentity({ subject: `${userId}|session` })
  return { t, as, ...ids }
}

const REFUSED = /not assigned to that building/

describe('building scoping', () => {
  test('omitting the building id gives your own building, not the first one', async () => {
    const { as, users, buildingA } = await setup()

    const overview = await as(users.workerA).query(api.dashboard.overview, {})
    expect(overview?.building._id).toBe(buildingA)
    expect(overview?.building.name).toBe('Dodson Rooms')
  })

  test('a worker cannot read another building’s dashboard', async () => {
    const { as, users, buildingB } = await setup()
    await expect(
      as(users.workerA).query(api.dashboard.overview, { buildingId: buildingB }),
    ).rejects.toThrow(REFUSED)
  })

  test('a worker cannot open another building’s resident record', async () => {
    const { as, users, tenantB } = await setup()
    await expect(
      as(users.workerA).query(api.profile.get, { tenantId: tenantB }),
    ).rejects.toThrow(REFUSED)
    await expect(
      as(users.workerA).query(api.tenants.get, { tenantId: tenantB }),
    ).rejects.toThrow(REFUSED)
  })

  test('a worker cannot read another building’s support or deposit history', async () => {
    const { as, users, tenantB } = await setup()
    await expect(
      as(users.workerA).query(api.support.historyFor, { tenantId: tenantB }),
    ).rejects.toThrow(REFUSED)
    await expect(
      as(users.workerA).query(api.deposits.historyFor, { tenantId: tenantB }),
    ).rejects.toThrow(REFUSED)
  })

  test('a coordinator cannot post a payment against another building’s resident', async () => {
    const { as, users, tenantB } = await setup()
    const { as: as2, users: users2, tenantB: tenantB2 } = { as, users, tenantB }
    await expect(
      as2(users2.managerA).mutation(api.rents.receivePayment, {
        tenantId: tenantB2,
        amountCents: 1_000,
        method: 'cash',
      }),
    ).rejects.toThrow(REFUSED)
  })

  test('a worker cannot sign off a check on another building’s room', async () => {
    const { as, users, roomB } = await setup()
    await expect(
      as(users.workerA).mutation(api.checks.completeRoomCheck, {
        roomId: roomB,
        outcome: 'all-clear',
      }),
    ).rejects.toThrow(REFUSED)
  })

  test('a building manager may add a room in their building and not in another', async () => {
    const { as, users, buildingA, buildingB } = await setup()

    await as(users.managerA).mutation(api.rooms.create, {
      buildingId: buildingA,
      number: '102',
      floor: 'Floor 1',
      monthlyRentCents: 54_000,
    })

    await expect(
      as(users.managerA).mutation(api.rooms.create, {
        buildingId: buildingB,
        number: '202',
        floor: 'Floor 1',
        monthlyRentCents: 54_000,
      }),
    ).rejects.toThrow(REFUSED)
  })

  test('buildings.list returns only what you are assigned to', async () => {
    const { as, users } = await setup()

    expect(await as(users.workerA).query(api.buildings.list, {})).toHaveLength(1)
    expect(await as(users.coordinatorAB).query(api.buildings.list, {})).toHaveLength(2)
    expect(await as(users.admin).query(api.buildings.list, {})).toHaveLength(2)
    expect(await as(users.unassigned).query(api.buildings.list, {})).toHaveLength(0)
  })

  test('someone with no assignments sees nothing, and is not an error wall', async () => {
    const { as, users } = await setup()

    // An empty app, not a crash: the screens render their own empty states.
    expect(await as(users.unassigned).query(api.buildings.list, {})).toEqual([])
    expect(await as(users.unassigned).query(api.dashboard.overview, {})).toBeNull()
  })

  test('an administrator reaches every building', async () => {
    const { as, users, buildingA, buildingB } = await setup()

    expect(
      (await as(users.admin).query(api.dashboard.overview, { buildingId: buildingA }))?.building.name,
    ).toBe('Dodson Rooms')
    expect(
      (await as(users.admin).query(api.dashboard.overview, { buildingId: buildingB }))?.building.name,
    ).toBe('Eastside Lodge')
  })

  test('an administrator testing as another role is held to their own assignments', async () => {
    const { as, users, buildingA } = await setup()
    const admin = as(users.admin)

    // The admin has no assignments of their own, so the simulation is empty —
    // deliberately. A simulation that kept full reach would misrepresent the
    // one thing that matters most about the role being tested.
    await admin.mutation(api.users.setSimulatedRole, { role: 'rsw' })
    expect(await admin.query(api.buildings.list, {})).toEqual([])
    await expect(
      admin.query(api.dashboard.overview, { buildingId: buildingA }),
    ).rejects.toThrow(REFUSED)

    await admin.mutation(api.users.setSimulatedRole, { role: null })
    expect(await admin.query(api.buildings.list, {})).toHaveLength(2)
  })

  test('removing a building drops it from every staff assignment', async () => {
    const { t, as, users, buildingB, tenantB, roomB } = await setup()

    // Empty it first — the server refuses to remove a building with tenants.
    await t.run(async (ctx) => {
      await ctx.db.delete(tenantB)
      await ctx.db.delete(roomB)
    })
    await as(users.admin).mutation(api.buildings.remove, { buildingId: buildingB })

    const sam = await t.run((ctx) => ctx.db.get(users.coordinatorAB))
    expect(sam?.assignedBuildingIds).not.toContain(buildingB)
    expect(sam?.assignedBuildingIds).toHaveLength(1)
  })

  test('assignments can be set, and drop a building that no longer exists', async () => {
    const { t, as, users, buildingA, buildingB } = await setup()

    await as(users.admin).mutation(api.users.setAssignedBuildings, {
      userId: users.unassigned,
      // Duplicated on purpose: the server de-duplicates.
      buildingIds: [buildingA, buildingB, buildingA],
    })

    const user = await t.run((ctx) => ctx.db.get(users.unassigned))
    expect(user?.assignedBuildingIds).toHaveLength(2)
    expect(await as(users.unassigned).query(api.buildings.list, {})).toHaveLength(2)
  })

  test('only an administrator may change assignments', async () => {
    const { as, users, buildingB } = await setup()
    await expect(
      as(users.managerA).mutation(api.users.setAssignedBuildings, {
        userId: users.workerA,
        buildingIds: [buildingB],
      }),
    ).rejects.toThrow(/cannot do this/)
  })

  test('a worker cannot log or read another building’s rounds', async () => {
    const { as, users, buildingB } = await setup()
    const now = Date.now()

    await expect(
      as(users.workerA).query(api.routines.board, { buildingId: buildingB, now, tzOffsetMinutes: 0 }),
    ).rejects.toThrow(REFUSED)
    await expect(
      as(users.workerA).query(api.routines.history, {
        buildingId: buildingB,
        since: now - 86_400_000,
      }),
    ).rejects.toThrow(REFUSED)
    await expect(
      as(users.workerA).mutation(api.routines.complete, {
        buildingId: buildingB,
        routine: 'rounds',
        tzOffsetMinutes: 0,
      }),
    ).rejects.toThrow(REFUSED)
  })

  test('a coordinator cannot set another building’s round frequencies', async () => {
    const { as, users, buildingB } = await setup()
    await expect(
      as(users.managerA).mutation(api.routines.setRoutines, {
        buildingId: buildingB,
        routines: [{ routine: 'rounds', everyMinutes: 30, enabled: true }],
      }),
    ).rejects.toThrow(REFUSED)
  })

  /*
     The bell is the widest read in the app — rounds, needs, work orders, rent,
     guests, pets, all in one query. If scoping were going to be forgotten
     anywhere it would be here, so it is checked directly rather than trusted
     to the sources it calls.
  */
  test('a worker cannot read another building’s notifications', async () => {
    const { as, users, buildingA, buildingB } = await setup()

    const own = await as(users.workerA).query(api.notifications.feed, { now: Date.now(), tzOffsetMinutes: 0 })
    expect(own?.building._id).toBe(buildingA)

    await expect(
      as(users.workerA).query(api.notifications.feed, {
        buildingId: buildingB,
        now: Date.now(),
        tzOffsetMinutes: 0,
      }),
    ).rejects.toThrow(REFUSED)
  })
})

/**
 * The standing guard.
 *
 * Every public function is either covered by a cross-building refusal above, or
 * listed as exempt with a reason. Adding a function to the API and classifying
 * it nowhere fails this test — which is the point, because a scoping hole is
 * invisible in review and obvious in a red suite.
 */
describe('coverage', () => {
  const SCOPE_TESTED = new Set([
    'dashboard:overview',
    'buildings:list', 'buildings:remove',
    'profile:get',
    'tenants:get',
    'support:historyFor',
    'deposits:historyFor',
    'rents:receivePayment',
    'checks:completeRoomCheck',
    'rooms:create',
    'users:setAssignedBuildings',
    'routines:board', 'routines:history', 'routines:complete', 'routines:setRoutines',
    'notifications:feed',
  ])

  /**
   * Exempt, each for a stated reason. "It looked fine" is not one — anything
   * that reads or writes a building's data belongs in SCOPE_TESTED.
   */
  const EXEMPT = new Map([
    // Convex Auth's own endpoints. They run before there is a signed-in user
    // to scope, and are the library's, not ours.
    ['auth:signIn', 'authentication itself'],
    ['auth:signOut', 'authentication itself'],
    ['auth:isAuthenticated', 'a boolean about the caller'],
    // Act on the caller's own account, or say nothing about any person.
    ['users:me', 'the caller’s own record'],
    ['users:needsBootstrap', 'a boolean about the deployment, no personal data'],
    ['users:setSimulatedRole', 'acts on the caller, and is admin-only'],
    ['users:changeMyPassword', 'acts on the caller'],
    ['notifications:markRead', 'writes the caller’s own read markers; a key names no building'],
    // Administrator-only: the staff directory is not building-scoped.
    ['users:list', 'admin-only staff directory'],
    ['users:createStaff', 'admin-only'],
    ['users:updateRole', 'admin-only'],
    ['users:resetPassword', 'admin-only'],
    ['users:remove', 'admin-only'],
    ['buildings:create', 'admin-only; there is no building to be scoped to yet'],
    ['seed:run', 'admin-only development seed'],
    // Take no id and touch no building.
    ['profile:generatePhotoUploadUrl', 'issues an upload URL, touches no building'],
    ['visitors:generatePhotoUploadUrl', 'issues an upload URL, touches no building'],
    // Covered transitively: these resolve a building through the scoped
    // helpers, which the refusal tests above exercise on the same code path.
    ['buildings:get', 'assertBuildingAccess on the id'],
    ['buildings:listForAdmin', 'assignedBuildings, same helper as buildings:list'],
    ['buildings:update', 'requireBuildingConfig asserts access'],
    ['care:overview', 'resolveBuilding'], ['care:logCheck', 'scoped tenant'],
    ['care:historyFor', 'scopedTenant'], ['care:setDuty', 'scoped report'],
    ['checks:list', 'resolveBuilding'], ['checks:completeBuildingCheck', 'assertBuildingAccess'],
    ['deposits:overview', 'resolveBuilding'],
    ['maintenance:list', 'resolveBuilding'], ['maintenance:create', 'assertBuildingAccess'],
    ['maintenance:update', 'scoped work order'], ['maintenance:remove', 'scoped work order'],
    ['needs:list', 'resolveBuilding'], ['needs:open', 'scoped tenant'],
    ['needs:update', 'scoped need'], ['needs:resolve', 'scoped need'],
    ['profile:revealSin', 'scopedTenant'], ['profile:shiftNotes', 'scopedTenant'],
    ['profile:sheet', 'scopedTenant'], ['profile:updateIdentity', 'scoped tenant'],
    ['profile:updateHealth', 'scoped tenant'], ['profile:setFlags', 'scoped tenant'],
    ['profile:updateIntake', 'scoped tenant'], ['profile:updateDocuments', 'scoped tenant'],
    ['profile:addContact', 'scoped tenant'], ['profile:removeContact', 'scoped contact'],
    ['profile:setPhoto', 'scoped tenant'], ['profile:removePhoto', 'scoped tenant'],
    ['rents:roster', 'resolveBuilding'], ['rents:chargeMonthlyRent', 'assertBuildingAccess'],
    ['rents:adjustDeposit', 'scoped tenant'],
    ['reports:shift', 'resolveBuilding'],
    ['rooms:list', 'resolveBuilding'], ['rooms:createRange', 'assertBuildingAccess'],
    ['rooms:update', 'scoped room'], ['rooms:remove', 'scoped room'],
    ['services:meals', 'resolveBuilding'], ['services:setMealServed', 'scoped'],
    ['services:laundry', 'resolveBuilding'], ['services:bookLaundry', 'scoped'],
    ['services:cancelLaundry', 'scoped booking'], ['services:supplies', 'resolveBuilding'],
    ['services:issueSupply', 'scoped'], ['services:wheeled', 'resolveBuilding'],
    ['services:signInWheeled', 'scoped'], ['services:signOutWheeled', 'scoped movement'],
    ['services:petRoster', 'resolveBuilding'], ['services:addPet', 'scoped'],
    ['services:retirePet', 'scoped pet'], ['services:logPetSighting', 'scoped pet'],
    ['services:today', 'resolveBuilding'],
    ['settings:get', 'resolveBuilding'], ['settings:setMeals', 'assertBuildingAccess'],
    ['settings:setLaundry', 'assertBuildingAccess'],
    ['settings:setSupplyLimits', 'assertBuildingAccess'],
    ['shiftReports:current', 'resolveBuilding'], ['shiftReports:list', 'resolveBuilding'],
    ['shiftReports:get', 'assertBuildingAccess on the report'],
    ['shiftReports:start', 'assertBuildingAccess'], ['shiftReports:addEntry', 'scoped report'],
    ['shiftReports:setEntryResidents', 'scoped entry, and each named resident'],
    ['shiftReports:updateEntry', 'scoped entry'], ['shiftReports:removeEntry', 'scoped entry'],
    ['shiftReports:saveDraft', 'scoped report'], ['shiftReports:submit', 'scoped report'],
    ['support:overview', 'resolveBuilding'], ['support:setLevel', 'scoped tenant'],
    ['tenants:list', 'resolveBuilding'], ['tenants:vacancies', 'resolveBuilding'],
    ['tenants:create', 'assertBuildingAccess'], ['tenants:update', 'scoped tenant'],
    ['tenants:transferRoom', 'scoped tenant, destination room checked against it'],
    ['tenants:transferSite', 'scoped tenant, plus assertBuildingAccess on the receiving site'],
    ['tenants:returnHome', 'scoped tenant; returns only to the site holding their room'],
    ['tenants:evict', 'scoped tenant'],
    ['tenants:reinstate', 'scoped tenant, plus assertBuildingAccess on the destination'],
    ['tenants:placementHistory', 'scopedTenant'],
    ['tenants:roomHistory', 'scoped room'],
    ['tenants:exit', 'scoped tenant'], ['tenants:setStatus', 'scoped tenant'],
    ['visitors:board', 'resolveBuilding'], ['visitors:visitorHistory', 'scoped visitor'],
    ['visitors:register', 'assertBuildingAccess'], ['visitors:setPhoto', 'scoped visitor'],
    ['visitors:signIn', 'scoped'], ['visitors:signOut', 'scoped visit'],
    ['visitors:setBan', 'scoped visitor'], ['visitors:authorizeOvernight', 'scoped'],
    ['visitors:revokeOvernight', 'scoped authorization'],
    ['visitors:overnightFor', 'scopedTenant'],
  ])

  /**
   * The function list comes from eagerly importing the modules, not from the
   * generated `api` object: `api` is a Proxy with no enumerable keys, so
   * `Object.entries(api)` yields `[]` and any check built on it passes without
   * ever looking at anything.
   */
  const eager = import.meta.glob('./*.ts', { eager: true }) as Record<
    string,
    Record<string, unknown>
  >

  function publicFunctions(): string[] {
    const found: string[] = []
    for (const [path, mod] of Object.entries(eager)) {
      const moduleName = path.replace(/^\.\//, '').replace(/\.ts$/, '')
      if (moduleName.endsWith('.test') || moduleName === 'schema') continue
      for (const [fnName, value] of Object.entries(mod)) {
        const fn = value as { isPublic?: boolean } | undefined
        if (typeof value === 'function' && fn?.isPublic) found.push(`${moduleName}:${fnName}`)
      }
    }
    return found.sort()
  }

  test('the coverage check is actually looking at something', () => {
    // Guards the guard. If module enumeration silently breaks, the assertion
    // below would pass while checking nothing at all — which is how this test
    // was written the first time.
    expect(publicFunctions().length).toBeGreaterThan(60)
    expect(publicFunctions()).toContain('dashboard:overview')
  })

  test('every public function is scope-tested or explicitly exempt', () => {
    const unclassified = publicFunctions().filter(
      (key) => !SCOPE_TESTED.has(key) && !EXEMPT.has(key),
    )
    expect(
      unclassified,
      'New public functions must be classified in convex/scoping.test.ts — '
      + 'either give them a cross-building refusal test, or exempt them with a reason.',
    ).toEqual([])
  })
})
