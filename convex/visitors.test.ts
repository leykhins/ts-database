/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { weekdayOf } from './visitors'

/**
 * The door rules: a ban that answers itself, a returning guest who is not
 * re-interviewed, and an overnight stay that only a manager can approve.
 */

const modules = import.meta.glob('./**/*.ts')

// 2026-08-15 is a Saturday; 2026-08-18 is a Tuesday.
const SATURDAY = Date.UTC(2026, 7, 15, 20)
const TUESDAY = Date.UTC(2026, 7, 18, 20)

async function setup() {
  const t = convexTest(schema, modules)

  const ids = await t.run(async (ctx) => {
    const buildingId = await ctx.db.insert('buildings', {
      name: 'Dodson Rooms',
      slug: 'dodson-rooms',
      units: 2,
    })

    const tenantIds: Id<'tenants'>[] = []
    for (let i = 0; i < 2; i++) {
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
          name: i === 0 ? 'Jane Okonkwo' : 'Marcus Bell',
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

  const jon = await as(ids.worker).mutation(api.visitors.register, {
    buildingId: ids.buildingId,
    name: 'Jon Ridley',
    dob: '1990-04-11',
  })

  return { t, as, jon, ...ids }
}

describe('registering', () => {
  test('a visitor needs something that identifies them again', async () => {
    const { as, worker, buildingId } = await setup()

    await expect(
      as(worker).mutation(api.visitors.register, { buildingId, name: 'No ID' }),
    ).rejects.toThrow(/date of birth or an ID/)

    // Either one is enough — a guest without a birth certificate has a licence.
    await as(worker).mutation(api.visitors.register, {
      buildingId,
      name: 'Has Licence',
      idNumber: 'BC-4471',
    })
  })
})

describe('the door', () => {
  test('a returning guest signs in without being re-registered', async () => {
    const { as, worker, jon, tenantIds, buildingId } = await setup()
    const staff = as(worker)

    for (const [i, now] of [SATURDAY, TUESDAY].entries()) {
      const { visitId } = await staff.mutation(api.visitors.signIn, {
        visitorId: jon,
        tenantId: tenantIds[0]!,
        overnight: false,
        now,
        tzOffsetMinutes: 0,
      })
      await staff.mutation(api.visitors.signOut, { visitId, now: now + 3_600_000 })
      expect(i).toBeLessThan(2)
    }

    const board = await staff.query(api.visitors.board, {
      buildingId,
      now: TUESDAY + 3_600_000,
      tzOffsetMinutes: 0,
    })
    const guest = board!.visitors.find((visitor) => visitor._id === jon)!
    // The desk can see who they actually come for.
    expect(guest).toMatchObject({ visitsThisMonth: 2, usuallyVisits: 'Jane Okonkwo' })
  })

  test('a guest cannot be signed in twice over', async () => {
    const { as, worker, jon, tenantIds } = await setup()
    const staff = as(worker)

    await staff.mutation(api.visitors.signIn, {
      visitorId: jon,
      tenantId: tenantIds[0]!,
      overnight: false,
      now: SATURDAY,
      tzOffsetMinutes: 0,
    })

    await expect(
      staff.mutation(api.visitors.signIn, {
        visitorId: jon,
        tenantId: tenantIds[1]!,
        overnight: false,
        now: SATURDAY + 60_000,
        tzOffsetMinutes: 0,
      }),
    ).rejects.toThrow(/already signed in/)
  })
})

describe('bans', () => {
  test('a ban is refused at the door, with the reason', async () => {
    const { as, worker, manager, jon, tenantIds } = await setup()

    await as(manager).mutation(api.visitors.setBan, {
      visitorId: jon,
      banned: true,
      reason: 'Aggressive toward staff in the lobby',
      now: SATURDAY,
    })

    await expect(
      as(worker).mutation(api.visitors.signIn, {
        visitorId: jon,
        tenantId: tenantIds[0]!,
        overnight: false,
        now: SATURDAY,
        tzOffsetMinutes: 0,
      }),
    ).rejects.toThrow(/banned from this site: Aggressive toward staff/)
  })

  test('only a manager may ban or lift', async () => {
    const { as, worker, jon } = await setup()

    await expect(
      as(worker).mutation(api.visitors.setBan, {
        visitorId: jon,
        banned: true,
        reason: 'Not my call',
        now: SATURDAY,
      }),
    ).rejects.toThrow(/cannot do this/)
  })

  test('a ban with no reason is refused — the desk has to be able to say', async () => {
    const { as, manager, jon } = await setup()

    await expect(
      as(manager).mutation(api.visitors.setBan, {
        visitorId: jon,
        banned: true,
        reason: '   ',
        now: SATURDAY,
      }),
    ).rejects.toThrow(/Record why/)
  })

  test('a ban with an end date expires on its own', async () => {
    const { as, worker, manager, jon, tenantIds } = await setup()

    await as(manager).mutation(api.visitors.setBan, {
      visitorId: jon,
      banned: true,
      reason: 'Two-week cooling off',
      until: '2026-08-16',
      now: SATURDAY,
    })

    await expect(
      as(worker).mutation(api.visitors.signIn, {
        visitorId: jon,
        tenantId: tenantIds[0]!,
        overnight: false,
        now: SATURDAY,
        tzOffsetMinutes: 0,
      }),
    ).rejects.toThrow(/banned/)

    // Two days later the ban has run out; nobody has to remember to lift it.
    await as(worker).mutation(api.visitors.signIn, {
      visitorId: jon,
      tenantId: tenantIds[0]!,
      overnight: false,
      now: Date.UTC(2026, 7, 17, 20),
      tzOffsetMinutes: 0,
    })
  })
})

describe('overnight stays', () => {
  test('weekday maths lines up with the approval', () => {
    expect(weekdayOf('2026-08-15')).toBe(6) // Saturday
    expect(weekdayOf('2026-08-18')).toBe(2) // Tuesday
  })

  test('approved on the right night, unauthorised on the wrong one', async () => {
    const { as, worker, manager, jon, tenantIds, buildingId } = await setup()

    // "Jon is approved for weekends to stay with Jane."
    await as(manager).mutation(api.visitors.authorizeOvernight, {
      visitorId: jon,
      tenantId: tenantIds[0]!,
      days: [0, 6],
      now: SATURDAY,
    })

    const staff = as(worker)
    const saturday = await staff.mutation(api.visitors.signIn, {
      visitorId: jon,
      tenantId: tenantIds[0]!,
      overnight: true,
      now: SATURDAY,
      tzOffsetMinutes: 0,
    })
    expect(saturday.authorized).toBe(true)
    await staff.mutation(api.visitors.signOut, { visitId: saturday.visitId, now: SATURDAY + 6e6 })

    // Tuesday is not a weekend. The stay is recorded, not blocked — at 11pm
    // the guest is already there and the honest record is worth more.
    const tuesday = await staff.mutation(api.visitors.signIn, {
      visitorId: jon,
      tenantId: tenantIds[0]!,
      overnight: true,
      now: TUESDAY,
      tzOffsetMinutes: 0,
    })
    expect(tuesday.authorized).toBe(false)

    const board = await staff.query(api.visitors.board, {
      buildingId,
      now: TUESDAY + 60_000,
      tzOffsetMinutes: 0,
    })
    expect(board!.inside[0]).toMatchObject({ overnight: true, authorized: false })
  })

  test('an approval is for one resident, not for the building', async () => {
    const { as, worker, manager, jon, tenantIds } = await setup()

    await as(manager).mutation(api.visitors.authorizeOvernight, {
      visitorId: jon,
      tenantId: tenantIds[0]!,
      days: [0, 6],
      now: SATURDAY,
    })

    // Same Saturday, different resident: not covered.
    const result = await as(worker).mutation(api.visitors.signIn, {
      visitorId: jon,
      tenantId: tenantIds[1]!,
      overnight: true,
      now: SATURDAY,
      tzOffsetMinutes: 0,
    })
    expect(result.authorized).toBe(false)
  })

  test('re-approving a pair replaces the old rule rather than stacking', async () => {
    const { as, manager, jon, tenantIds, buildingId } = await setup()
    const boss = as(manager)

    await boss.mutation(api.visitors.authorizeOvernight, {
      visitorId: jon,
      tenantId: tenantIds[0]!,
      days: [0, 6],
      now: SATURDAY,
    })
    await boss.mutation(api.visitors.authorizeOvernight, {
      visitorId: jon,
      tenantId: tenantIds[0]!,
      days: [5],
      now: SATURDAY,
    })

    const board = await boss.query(api.visitors.board, {
      buildingId,
      now: SATURDAY,
      tzOffsetMinutes: 0,
    })
    expect(board!.authorizations).toHaveLength(1)
    expect(board!.authorizations[0]!.days).toEqual([5])
  })

  test('only a manager may approve', async () => {
    const { as, worker, jon, tenantIds } = await setup()

    await expect(
      as(worker).mutation(api.visitors.authorizeOvernight, {
        visitorId: jon,
        tenantId: tenantIds[0]!,
        days: [0, 6],
        now: SATURDAY,
      }),
    ).rejects.toThrow(/cannot do this/)
  })

  test('the resident record carries the badge too', async () => {
    const { as, manager, worker, jon, tenantIds } = await setup()

    await as(manager).mutation(api.visitors.authorizeOvernight, {
      visitorId: jon,
      tenantId: tenantIds[0]!,
      days: [0, 6],
      now: SATURDAY,
    })

    const badges = await as(worker).query(api.visitors.overnightFor, {
      tenantId: tenantIds[0]!,
      now: SATURDAY,
      tzOffsetMinutes: 0,
    })
    expect(badges).toHaveLength(1)
    expect(badges[0]).toMatchObject({ name: 'Jon Ridley', days: [0, 6] })
  })
})
