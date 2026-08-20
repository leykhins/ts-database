/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'

/**
 * Moving residents between sites.
 *
 * The rules that cost real money or lose real history: a held room stays held,
 * the home site keeps billing a resident who is temporarily elsewhere, an
 * eviction can be revoked without pretending it never happened, and nothing
 * ever overwrites where somebody was.
 */

const modules = import.meta.glob('./**/*.ts')

async function setup() {
  const t = convexTest(schema, modules)

  const ids = await t.run(async (ctx) => {
    const home = await ctx.db.insert('buildings', {
      name: 'Dodson Rooms', slug: 'dodson-rooms', units: 4,
    })
    const other = await ctx.db.insert('buildings', {
      name: 'Carrall Annex', slug: 'carrall-annex', units: 4,
    })
    const room = async (buildingId: Id<'buildings'>, number: string) =>
      await ctx.db.insert('rooms', {
        buildingId, number, floor: 'Floor 1', sortKey: Number(number), monthlyRentCents: 54_000,
      })
    const homeRoom = await room(home, '101')
    const otherRoom = await room(other, '201')

    const tenantId = await ctx.db.insert('tenants', {
      buildingId: home,
      roomId: homeRoom,
      name: 'Dwayne Robinson',
      intakeDate: '2024-03-12',
      status: 'current',
      supportLevel: 'moderate',
      monthlyRentCents: 54_000,
      depositRequiredCents: 54_000,
      balanceCents: 0,
      depositHeldCents: 0,
    })

    // Covers both sites, so a transfer between them is legitimate.
    const staff = await ctx.db.insert('users', {
      name: 'Sam', username: 'sam', role: 'coordinator',
      assignedBuildingIds: [home, other],
    })
    // Covers only the home site.
    const homeOnly = await ctx.db.insert('users', {
      name: 'Devon', username: 'devon', role: 'rsw', assignedBuildingIds: [home],
    })

    return { home, other, homeRoom, otherRoom, tenantId, staff, homeOnly }
  })

  const as = (userId: Id<'users'>) => t.withIdentity({ subject: `${userId}|session` })
  return { t, as, ...ids }
}

describe('temporary transfer', () => {
  test('the resident moves but the room and the billing stay behind', async () => {
    const { t, as, staff, tenantId, other, otherRoom, home, homeRoom } = await setup()

    await as(staff).mutation(api.tenants.transferSite, {
      tenantId, toBuildingId: other, roomId: otherRoom,
      temporary: true, reason: 'Behaviour evaluation',
    })

    const tenant = await t.run((ctx) => ctx.db.get(tenantId))
    expect(tenant?.buildingId).toBe(other)     // living here now
    expect(tenant?.homeBuildingId).toBe(home)  // billed from here
    expect(tenant?.heldRoomId).toBe(homeRoom)  // room kept for them
  })

  test('the home site charges the rent, and the receiving site does not', async () => {
    const { as, staff, tenantId, other, otherRoom, home } = await setup()

    await as(staff).mutation(api.tenants.transferSite, {
      tenantId, toBuildingId: other, roomId: otherRoom,
      temporary: true, reason: 'Behaviour evaluation',
    })

    // Nobody should be asked to pay two sites of one organisation.
    const atReceiving = await as(staff).mutation(api.rents.chargeMonthlyRent, {
      buildingId: other, periodLabel: 'Jun 2026',
    })
    expect(atReceiving.charged).toBe(0)

    const atHome = await as(staff).mutation(api.rents.chargeMonthlyRent, {
      buildingId: home, periodLabel: 'Jun 2026',
    })
    expect(atHome.charged).toBe(1)
  })

  test('the held room is not offered to anyone else', async () => {
    const { as, staff, tenantId, other, otherRoom, home, homeRoom } = await setup()

    await as(staff).mutation(api.tenants.transferSite, {
      tenantId, toBuildingId: other, roomId: otherRoom,
      temporary: true, reason: 'Behaviour evaluation',
    })

    const vacancies = await as(staff).query(api.tenants.vacancies, { buildingId: home })
    expect(vacancies.map((r) => r._id)).not.toContain(homeRoom)
  })

  test('coming back restores the room and clears the hold', async () => {
    const { t, as, staff, tenantId, other, otherRoom, home, homeRoom } = await setup()

    await as(staff).mutation(api.tenants.transferSite, {
      tenantId, toBuildingId: other, roomId: otherRoom,
      temporary: true, reason: 'Behaviour evaluation',
    })
    await as(staff).mutation(api.tenants.returnHome, { tenantId, reason: 'Evaluation complete' })

    const tenant = await t.run((ctx) => ctx.db.get(tenantId))
    expect(tenant?.buildingId).toBe(home)
    expect(tenant?.roomId).toBe(homeRoom)
    expect(tenant?.homeBuildingId).toBeUndefined()
    expect(tenant?.heldRoomId).toBeUndefined()
  })

  test('staff at the home site can still open the record while the resident is away', async () => {
    const { as, staff, homeOnly, tenantId, other, otherRoom } = await setup()

    await as(staff).mutation(api.tenants.transferSite, {
      tenantId, toBuildingId: other, roomId: otherRoom,
      temporary: true, reason: 'Behaviour evaluation',
    })

    // The home site is still billing them and expecting them back.
    const record = await as(homeOnly).query(api.tenants.get, { tenantId })
    expect(record?.name).toBe('Dwayne Robinson')
  })
})

describe('permanent transfer', () => {
  test('everything moves and nothing is held', async () => {
    const { t, as, staff, tenantId, other, otherRoom, home, homeRoom } = await setup()

    await as(staff).mutation(api.tenants.transferSite, {
      tenantId, toBuildingId: other, roomId: otherRoom,
      temporary: false, reason: 'Closer to family',
    })

    const tenant = await t.run((ctx) => ctx.db.get(tenantId))
    expect(tenant?.buildingId).toBe(other)
    expect(tenant?.homeBuildingId).toBeUndefined()
    expect(tenant?.heldRoomId).toBeUndefined()

    // The old room is free for the next person.
    const vacancies = await as(staff).query(api.tenants.vacancies, { buildingId: home })
    expect(vacancies.map((r) => r._id)).toContain(homeRoom)
  })

  test('a transfer to a site you do not cover is refused', async () => {
    const { as, homeOnly, tenantId, other, otherRoom } = await setup()
    await expect(
      as(homeOnly).mutation(api.tenants.transferSite, {
        tenantId, toBuildingId: other, roomId: otherRoom,
        temporary: true, reason: 'Trying it on',
      }),
    ).rejects.toThrow(/cannot do this|not assigned/)
  })

  test('a transfer has to say why', async () => {
    const { as, staff, tenantId, other } = await setup()
    await expect(
      as(staff).mutation(api.tenants.transferSite, {
        tenantId, toBuildingId: other, temporary: true, reason: '  ',
      }),
    ).rejects.toThrow(/why/)
  })
})

describe('eviction', () => {
  test('ends the tenancy, frees the room, and keeps the person', async () => {
    const { t, as, staff, tenantId, home, homeRoom } = await setup()

    await as(staff).mutation(api.tenants.evict, {
      tenantId, reason: 'Repeated violence toward staff', exitDate: '2026-08-01',
    })

    const tenant = await t.run((ctx) => ctx.db.get(tenantId))
    expect(tenant?.status).toBe('prior')
    expect(tenant?.roomId).toBeUndefined()
    expect(tenant?.exitReason).toMatch(/Evicted/)
    // The record survives; only the tenancy ended.
    expect(tenant?.name).toBe('Dwayne Robinson')

    const vacancies = await as(staff).query(api.tenants.vacancies, { buildingId: home })
    expect(vacancies.map((r) => r._id)).toContain(homeRoom)
  })

  test('can be revoked, and the resident housed again at any site', async () => {
    const { t, as, staff, tenantId, other, otherRoom } = await setup()

    await as(staff).mutation(api.tenants.evict, {
      tenantId, reason: 'Repeated violence toward staff', exitDate: '2026-08-01',
    })
    await as(staff).mutation(api.tenants.reinstate, {
      tenantId, buildingId: other, roomId: otherRoom,
      reason: 'Appeal upheld', intakeDate: '2026-09-01',
    })

    const tenant = await t.run((ctx) => ctx.db.get(tenantId))
    expect(tenant?.status).toBe('current')
    expect(tenant?.buildingId).toBe(other)
    expect(tenant?.exitReason).toBeUndefined()
  })

  test('revoking is recorded, not erased', async () => {
    const { as, staff, tenantId, other, otherRoom } = await setup()

    await as(staff).mutation(api.tenants.evict, {
      tenantId, reason: 'Repeated violence toward staff', exitDate: '2026-08-01',
    })
    await as(staff).mutation(api.tenants.reinstate, {
      tenantId, buildingId: other, roomId: otherRoom,
      reason: 'Appeal upheld', intakeDate: '2026-09-01',
    })

    const history = await as(staff).query(api.tenants.placementHistory, { tenantId })
    const kinds = history.map((h) => h.kind)
    // The eviction is still in the record after being revoked.
    expect(kinds).toContain('eviction')
    expect(kinds).toContain('return')
  })
})

describe('history', () => {
  test('a resident keeps every site they have lived at, newest first', async () => {
    const { as, staff, tenantId, other, otherRoom, home } = await setup()

    await as(staff).mutation(api.tenants.transferSite, {
      tenantId, toBuildingId: other, roomId: otherRoom,
      temporary: true, reason: 'Behaviour evaluation',
    })
    await as(staff).mutation(api.tenants.returnHome, { tenantId })

    const history = await as(staff).query(api.tenants.placementHistory, { tenantId })
    expect(history.length).toBeGreaterThanOrEqual(2)
    expect(history[0]?.building).toBe('Dodson Rooms') // newest first
    expect(history.some((h) => h.building === 'Carrall Annex')).toBe(true)

    // Exactly one placement is open — the one they are living in.
    expect(history.filter((h) => h.endedAt === null)).toHaveLength(1)
  })

  test('a room keeps who has lived in it', async () => {
    const { as, staff, tenantId, other, otherRoom } = await setup()

    await as(staff).mutation(api.tenants.transferSite, {
      tenantId, toBuildingId: other, roomId: otherRoom,
      temporary: true, reason: 'Behaviour evaluation',
    })

    const { room, history } = await as(staff).query(api.tenants.roomHistory, { roomId: otherRoom })
    expect(room.number).toBe('201')
    expect(history[0]?.name).toBe('Dwayne Robinson')
  })
})
