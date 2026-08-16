/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { laundrySlots } from './settings'

/**
 * The service rules that only mean anything if the server holds them: a supply
 * cap, a laundry slot that two people cannot both have, and a bike that cannot
 * leave twice.
 */

const modules = import.meta.glob('./**/*.ts')

const at = (hour: number, minute = 0) => Date.UTC(2026, 7, 16, hour, minute)
const DATE = '2026-08-16'

async function setup(residents = 3) {
  const t = convexTest(schema, modules)

  const ids = await t.run(async (ctx) => {
    const buildingId = await ctx.db.insert('buildings', {
      name: 'Dodson Rooms',
      slug: 'dodson-rooms',
      units: residents,
    })

    const tenantIds: Id<'tenants'>[] = []
    for (let i = 0; i < residents; i++) {
      const roomId = await ctx.db.insert('rooms', {
        buildingId,
        number: String(101 + i),
        floor: 'Floor 1',
        sortKey: i,
        monthlyRentCents: 54_000,
      })
      tenantIds.push(
        await ctx.db.insert('tenants', {
          buildingId,
          roomId,
          name: `Resident ${i + 1}`,
          intakeDate: '2024-03-12',
          status: 'current',
          supportLevel: 'moderate',
          monthlyRentCents: 54_000,
          depositRequiredCents: 54_000,
          balanceCents: 0,
          depositHeldCents: 0,
        }),
      )
    }

    const worker = await ctx.db.insert('users', {
      name: 'Devon Mraz',
      email: 'devon@housing.org',
      role: 'rsw',
    })
    const manager = await ctx.db.insert('users', {
      name: 'Ada Cole',
      email: 'ada@housing.org',
      role: 'supervisor',
    })

    return { buildingId, tenantIds, worker, manager }
  })

  const as = (userId: Id<'users'>) => t.withIdentity({ subject: `${userId}|session` })
  return { t, as, ...ids }
}

describe('site settings', () => {
  test('slots come from the site’s own hours', () => {
    expect(
      laundrySlots({ fromMinutes: 8 * 60, toMinutes: 14 * 60, slotMinutes: 120, maxPerResidentPerWeek: 0 }),
    ).toEqual([
      { startMinutes: 480, endMinutes: 600 },
      { startMinutes: 600, endMinutes: 720 },
      { startMinutes: 720, endMinutes: 840 },
    ])

    // A trailing part-slot is not offered — nobody gets 40 minutes of a washer.
    expect(
      laundrySlots({ fromMinutes: 8 * 60, toMinutes: 13 * 60, slotMinutes: 120, maxPerResidentPerWeek: 0 }),
    ).toHaveLength(2)
  })

  test('only a site manager may change them', async () => {
    const { as, buildingId, worker, manager } = await setup()

    await as(manager).mutation(api.settings.setLaundry, {
      buildingId,
      fromMinutes: 9 * 60,
      toMinutes: 21 * 60,
      slotMinutes: 90,
      maxPerResidentPerWeek: 3,
    })

    await expect(
      as(worker).mutation(api.settings.setLaundry, {
        buildingId,
        fromMinutes: 0,
        toMinutes: 60,
        slotMinutes: 60,
        maxPerResidentPerWeek: 0,
      }),
    ).rejects.toThrow(/cannot do this/)
  })

  test('hours that produce nothing are refused', async () => {
    const { as, manager, buildingId } = await setup()

    await expect(
      as(manager).mutation(api.settings.setLaundry, {
        buildingId,
        fromMinutes: 20 * 60,
        toMinutes: 8 * 60,
        slotMinutes: 120,
        maxPerResidentPerWeek: 0,
      }),
    ).rejects.toThrow(/close after it opens/)
  })
})

describe('meals', () => {
  test('the checklist toggles and does not double-count', async () => {
    const { as, worker, buildingId, tenantIds } = await setup(2)
    const staff = as(worker)

    const tick = (served: boolean) =>
      staff.mutation(api.services.setMealServed, {
        buildingId,
        tenantId: tenantIds[0]!,
        date: DATE,
        meal: 'lunch',
        served,
        now: at(12, 30),
      })

    await tick(true)
    await tick(true) // a second tick is not a second meal

    let board = await staff.query(api.services.meals, { buildingId, date: DATE })
    expect(board!.sittings.find((s) => s.meal === 'lunch')!.servedCount).toBe(1)

    await tick(false)
    board = await staff.query(api.services.meals, { buildingId, date: DATE })
    expect(board!.sittings.find((s) => s.meal === 'lunch')!.servedCount).toBe(0)
  })
})

describe('laundry', () => {
  test('a slot cannot be double-booked, and nobody gets two in a day', async () => {
    const { as, worker, buildingId, tenantIds } = await setup(3)
    const staff = as(worker)

    await staff.mutation(api.services.bookLaundry, {
      buildingId,
      tenantId: tenantIds[0]!,
      date: DATE,
      startMinutes: 8 * 60,
      now: at(9),
    })

    await expect(
      staff.mutation(api.services.bookLaundry, {
        buildingId,
        tenantId: tenantIds[1]!,
        date: DATE,
        startMinutes: 8 * 60,
        now: at(9),
      }),
    ).rejects.toThrow(/already taken/)

    await expect(
      staff.mutation(api.services.bookLaundry, {
        buildingId,
        tenantId: tenantIds[0]!,
        date: DATE,
        startMinutes: 10 * 60,
        now: at(9),
      }),
    ).rejects.toThrow(/already has a slot today/)
  })

  test('the weekly cap counts the seven days ending on the booking', async () => {
    const { as, worker, manager, buildingId, tenantIds } = await setup(1)

    await as(manager).mutation(api.settings.setLaundry, {
      buildingId,
      fromMinutes: 8 * 60,
      toMinutes: 20 * 60,
      slotMinutes: 120,
      maxPerResidentPerWeek: 2,
    })

    const staff = as(worker)
    for (const date of ['2026-08-11', '2026-08-13']) {
      await staff.mutation(api.services.bookLaundry, {
        buildingId,
        tenantId: tenantIds[0]!,
        date,
        startMinutes: 8 * 60,
        now: at(9),
      })
    }

    await expect(
      staff.mutation(api.services.bookLaundry, {
        buildingId,
        tenantId: tenantIds[0]!,
        date: '2026-08-16',
        startMinutes: 8 * 60,
        now: at(9),
      }),
    ).rejects.toThrow(/the cap is 2/)

    // Far enough out that the earlier two have rolled off the window.
    await staff.mutation(api.services.bookLaundry, {
      buildingId,
      tenantId: tenantIds[0]!,
      date: '2026-08-20',
      startMinutes: 8 * 60,
      now: at(9),
    })
  })

  test('a slot the site does not run is refused', async () => {
    const { as, worker, buildingId, tenantIds } = await setup(1)

    await expect(
      as(worker).mutation(api.services.bookLaundry, {
        buildingId,
        tenantId: tenantIds[0]!,
        date: DATE,
        startMinutes: 3 * 60,
        now: at(9),
      }),
    ).rejects.toThrow(/not a slot/)
  })
})

describe('harm-reduction supplies', () => {
  test('the per-site daily cap is enforced on the server', async () => {
    const { as, worker, buildingId, tenantIds } = await setup(1)
    const staff = as(worker)

    // Default for a bubble pipe is one a day.
    await staff.mutation(api.services.issueSupply, {
      buildingId,
      tenantId: tenantIds[0]!,
      item: 'bubble-pipe',
      date: DATE,
      now: at(14),
    })

    await expect(
      staff.mutation(api.services.issueSupply, {
        buildingId,
        tenantId: tenantIds[0]!,
        item: 'bubble-pipe',
        date: DATE,
        now: at(15),
      }),
    ).rejects.toThrow(/limit is 1/)

    // The next day starts fresh.
    await staff.mutation(api.services.issueSupply, {
      buildingId,
      tenantId: tenantIds[0]!,
      item: 'bubble-pipe',
      date: '2026-08-17',
      now: at(15),
    })
  })

  test('a site can raise its own limit', async () => {
    const { as, worker, manager, buildingId, tenantIds } = await setup(1)

    await as(manager).mutation(api.settings.setSupplyLimits, {
      buildingId,
      supplyLimits: { 'bubble-pipe': 3 },
    })

    const staff = as(worker)
    for (let i = 0; i < 3; i++) {
      await staff.mutation(api.services.issueSupply, {
        buildingId,
        tenantId: tenantIds[0]!,
        item: 'bubble-pipe',
        date: DATE,
        now: at(14 + i),
      })
    }

    await expect(
      staff.mutation(api.services.issueSupply, {
        buildingId,
        tenantId: tenantIds[0]!,
        item: 'bubble-pipe',
        date: DATE,
        now: at(18),
      }),
    ).rejects.toThrow(/limit is 3/)
  })

  test('an item with no cap is never refused', async () => {
    const { as, worker, buildingId, tenantIds } = await setup(1)
    const staff = as(worker)

    for (let i = 0; i < 5; i++) {
      await staff.mutation(api.services.issueSupply, {
        buildingId,
        tenantId: tenantIds[0]!,
        item: 'naloxone',
        date: DATE,
        now: at(10 + i),
      })
    }

    const board = await staff.query(api.services.supplies, { buildingId, date: DATE })
    expect(board!.items.find((i) => i.item === 'naloxone')!.issuedToday).toBe(5)
  })
})

describe('the bike room', () => {
  test('a machine is inside until it is signed out, and only once', async () => {
    const { as, worker, buildingId, tenantIds } = await setup(1)
    const staff = as(worker)

    const movementId = await staff.mutation(api.services.signInWheeled, {
      buildingId,
      tenantId: tenantIds[0]!,
      kind: 'e-bike',
      description: 'Blue Norco, rear rack',
      now: at(9),
    })

    let room = await staff.query(api.services.wheeled, { buildingId })
    expect(room!.inside).toHaveLength(1)
    expect(room!.inside[0]).toMatchObject({ kind: 'e-bike', description: 'Blue Norco, rear rack' })

    await staff.mutation(api.services.signOutWheeled, { movementId, now: at(17) })

    room = await staff.query(api.services.wheeled, { buildingId })
    expect(room!.inside).toHaveLength(0)
    expect(room!.history).toHaveLength(1)

    await expect(
      staff.mutation(api.services.signOutWheeled, { movementId, now: at(18) }),
    ).rejects.toThrow(/already been signed out/)
  })

  test('an unnamed machine is refused', async () => {
    const { as, worker, buildingId, tenantIds } = await setup(1)

    await expect(
      as(worker).mutation(api.services.signInWheeled, {
        buildingId,
        tenantId: tenantIds[0]!,
        kind: 'bike',
        description: '   ',
        now: at(9),
      }),
    ).rejects.toThrow(/Describe the machine/)
  })
})

describe('pets', () => {
  test('an animal nobody has seen for two days is flagged', async () => {
    const { as, worker, buildingId, tenantIds } = await setup(1)
    const staff = as(worker)

    const petId = await staff.mutation(api.services.addPet, {
      buildingId,
      tenantId: tenantIds[0]!,
      name: 'Biscuit',
      kind: 'Cat',
    })

    let roster = await staff.query(api.services.petRoster, { buildingId, now: at(12) })
    expect(roster!.pets[0]).toMatchObject({ name: 'Biscuit', lastSeenAt: null, overdue: true })

    await staff.mutation(api.services.logPetSighting, { petId, now: at(12) })

    roster = await staff.query(api.services.petRoster, { buildingId, now: at(13) })
    expect(roster!.pets[0]).toMatchObject({ daysSince: 0, overdue: false })

    // Three days later, nobody has laid eyes on it again.
    roster = await staff.query(api.services.petRoster, { buildingId, now: at(12) + 3 * 86_400_000 })
    expect(roster!.pets[0]).toMatchObject({ daysSince: 3, overdue: true })
  })

  test('retiring an animal takes it off the roster but keeps the sightings', async () => {
    const { as, worker, buildingId, t } = await setup(1)
    const staff = as(worker)

    const petId = await staff.mutation(api.services.addPet, {
      buildingId,
      name: 'Biscuit',
      kind: 'Cat',
    })
    await staff.mutation(api.services.logPetSighting, { petId, now: at(12) })
    await staff.mutation(api.services.retirePet, { petId, now: at(13) })

    const roster = await staff.query(api.services.petRoster, { buildingId, now: at(14) })
    expect(roster!.pets).toHaveLength(0)
    expect(await t.run((ctx) => ctx.db.query('petSightings').collect())).toHaveLength(1)
  })
})
