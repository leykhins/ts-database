/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { dueState } from './routines'

/**
 * Rounds and the bell.
 *
 * Both are computed rather than stored, which is the thing worth testing: a
 * round is due because an interval elapsed, and a notification exists because
 * the situation behind it is still true. The tests that matter are the ones
 * that show an item leaving the feed when the work is done, and the ones that
 * show a worker not being handed information that is not theirs.
 */

const modules = import.meta.glob('./**/*.ts')

const MINUTE = 60_000
const HOUR = 60 * MINUTE

async function setup() {
  const t = convexTest(schema, modules)

  const ids = await t.run(async (ctx) => {
    const buildingId = await ctx.db.insert('buildings', {
      name: 'Dodson Rooms',
      slug: 'dodson-rooms',
      units: 2,
    })

    const roomId = await ctx.db.insert('rooms', {
      buildingId,
      number: '101',
      floor: 'Floor 1',
      sortKey: 0,
      monthlyRentCents: 54_000,
      lastCheckedAt: Date.now(),
    })

    const tenantId = await ctx.db.insert('tenants', {
      buildingId,
      roomId,
      name: 'Marta Reyes',
      intakeDate: '2024-03-12',
      status: 'current',
      supportLevel: 'moderate',
      monthlyRentCents: 54_000,
      depositRequiredCents: 54_000,
      balanceCents: 0,
      depositHeldCents: 0,
    })

    const worker = await ctx.db.insert('users', {
      name: 'Devon Mraz',
      email: 'devon@housing.org',
      role: 'rsw',
      assignedBuildingIds: [buildingId],
    })
    const manager = await ctx.db.insert('users', {
      name: 'Ada Cole',
      email: 'ada@housing.org',
      role: 'coordinator',
      assignedBuildingIds: [buildingId],
    })

    return { buildingId, roomId, tenantId, worker, manager }
  })

  const as = (userId: Id<'users'>) => t.withIdentity({ subject: `${userId}|session` })
  return { t, as, ...ids }
}

describe('when a round is due', () => {
  test('a round nobody has ever walked is due, not late', () => {
    // A site's first morning on the system has not missed anything.
    expect(dueState(60, null, Date.now())).toMatchObject({ status: 'due', minutesLate: 0 })
  })

  test('grace scales with the interval', () => {
    const now = Date.now()

    // Hourly round, 10 minutes past: still "due", inside the 15-minute grace.
    expect(dueState(60, now - 70 * MINUTE, now).status).toBe('due')
    // 20 minutes past the same round is late.
    expect(dueState(60, now - 80 * MINUTE, now).status).toBe('overdue')

    // The same 20 minutes on a four-hourly round is not late at all — the
    // grace there is an hour, because the two lateness figures do not mean
    // the same thing.
    expect(dueState(240, now - 260 * MINUTE, now).status).toBe('due')
  })

  test('lateness is measured from when it fell due, not from the last walk', () => {
    const now = Date.now()
    const state = dueState(60, now - 150 * MINUTE, now)
    expect(state.status).toBe('overdue')
    expect(state.minutesLate).toBe(90)
  })
})

describe('logging a round', () => {
  test('a completion clears it from the board and from the bell', async () => {
    const { as, buildingId, worker } = await setup()
    const now = Date.now()

    const before = await as(worker).query(api.routines.board, { buildingId, now })
    // Nothing on record, so every enabled round is asking to be walked.
    expect(before!.rows.every((r) => r.status === 'due')).toBe(true)

    const feedBefore = await as(worker).query(api.notifications.feed, { buildingId, now })
    expect(feedBefore!.rows.filter((r) => r.kind === 'routine')).toHaveLength(3)

    await as(worker).mutation(api.routines.complete, { buildingId, routine: 'rounds' })

    const after = await as(worker).query(api.routines.board, { buildingId, now: Date.now() })
    expect(after!.rows.find((r) => r.routine === 'rounds')).toMatchObject({
      status: 'ok',
      lastBy: 'Devon Mraz',
    })

    const feedAfter = await as(worker).query(api.notifications.feed, {
      buildingId,
      now: Date.now(),
    })
    expect(feedAfter!.rows.some((r) => r.key.startsWith('routine:rounds'))).toBe(false)
  })

  test('how late it was is recorded, not recomputed later', async () => {
    const { t, as, buildingId, worker } = await setup()

    await t.run(async (ctx) => {
      await ctx.db.insert('routineCompletions', {
        buildingId,
        routine: 'perimeter',
        completedAt: Date.now() - 5 * HOUR,
      })
    })

    const result = await as(worker).mutation(api.routines.complete, {
      buildingId,
      routine: 'perimeter',
    })
    // Due every 2 hours, last walked 5 hours ago — three hours past due.
    expect(result.minutesLate).toBeGreaterThanOrEqual(179)

    // What was stored is what was returned — the row carries the figure rather
    // than leaving it to be worked out again against a frequency that may since
    // have changed.
    const stored = await t.run(async (ctx) =>
      await ctx.db
        .query('routineCompletions')
        .withIndex('by_building_routine', (q) =>
          q.eq('buildingId', buildingId).eq('routine', 'perimeter'),
        )
        .order('desc')
        .first(),
    )
    expect(stored!.minutesLate).toBe(result.minutesLate)
  })

  test('a round the site has switched off cannot be logged', async () => {
    const { as, buildingId, worker, manager } = await setup()

    await as(manager).mutation(api.routines.setRoutines, {
      buildingId,
      routines: [
        { routine: 'rounds', everyMinutes: 90, enabled: true },
        { routine: 'perimeter', everyMinutes: 120, enabled: false },
        { routine: 'meds', everyMinutes: 240, enabled: true },
      ],
    })

    await expect(
      as(worker).mutation(api.routines.complete, { buildingId, routine: 'perimeter' }),
    ).rejects.toThrow(/turned off/)

    const board = await as(worker).query(api.routines.board, { buildingId, now: Date.now() })
    expect(board!.rows.map((r) => r.routine)).not.toContain('perimeter')
    expect(board!.rows.find((r) => r.routine === 'rounds')!.everyMinutes).toBe(90)
  })
})

describe('who sets the frequencies', () => {
  test('a worker cannot, a coordinator can', async () => {
    const { as, buildingId, worker, manager } = await setup()

    await expect(
      as(worker).mutation(api.routines.setRoutines, {
        buildingId,
        routines: [{ routine: 'rounds', everyMinutes: 600, enabled: true }],
      }),
    ).rejects.toThrow(/cannot do this/)

    await as(manager).mutation(api.routines.setRoutines, {
      buildingId,
      routines: [{ routine: 'rounds', everyMinutes: 30, enabled: true }],
    })

    const settings = await as(manager).query(api.settings.get, { buildingId })
    expect(settings!.routines.find((r) => r.routine === 'rounds')!.everyMinutes).toBe(30)
  })

  test('an interval has to be one a shift could actually keep', async () => {
    const { as, buildingId, manager } = await setup()

    await expect(
      as(manager).mutation(api.routines.setRoutines, {
        buildingId,
        routines: [{ routine: 'rounds', everyMinutes: 5, enabled: true }],
      }),
    ).rejects.toThrow(/15 minutes/)

    await expect(
      as(manager).mutation(api.routines.setRoutines, {
        buildingId,
        routines: [{ routine: 'rounds', everyMinutes: 2000, enabled: true }],
      }),
    ).rejects.toThrow(/not a round/)
  })
})

describe('the notification feed', () => {
  test('rent is not shown to the desk', async () => {
    const { t, as, buildingId, tenantId, worker, manager } = await setup()

    await t.run(async (ctx) => {
      await ctx.db.patch(tenantId, { balanceCents: 200_000 })
    })

    const now = Date.now()
    const deskFeed = await as(worker).query(api.notifications.feed, { buildingId, now })
    expect(deskFeed!.rows.some((r) => r.kind === 'rent')).toBe(false)

    const managerFeed = await as(manager).query(api.notifications.feed, { buildingId, now })
    expect(managerFeed!.rows.find((r) => r.kind === 'rent')).toMatchObject({
      severity: 'med',
      key: `rent:${tenantId}`,
    })
  })

  test('an unresolved need is in the feed and a resolved one is not', async () => {
    const { t, as, buildingId, tenantId, worker } = await setup()

    const needId = await t.run(async (ctx) =>
      await ctx.db.insert('criticalNeeds', {
        buildingId,
        tenantId,
        summary: 'Detox bed on hold until Friday',
        openedAt: Date.now() - 2 * HOUR,
      }),
    )

    const feed = await as(worker).query(api.notifications.feed, { buildingId, now: Date.now() })
    expect(feed!.rows.find((r) => r.key === `need:${needId}`)).toMatchObject({
      severity: 'high',
      href: `/tenants/${tenantId}`,
    })

    await t.run(async (ctx) => {
      await ctx.db.patch(needId, { resolvedAt: Date.now() })
    })

    const after = await as(worker).query(api.notifications.feed, { buildingId, now: Date.now() })
    expect(after!.rows.some((r) => r.key === `need:${needId}`)).toBe(false)
  })

  test('marking read does not remove the item, only the badge', async () => {
    const { as, buildingId, worker } = await setup()
    const now = Date.now()

    const before = await as(worker).query(api.notifications.feed, { buildingId, now })
    const keys = before!.rows.map((r) => r.key)
    expect(before!.unread).toBe(keys.length)

    await as(worker).mutation(api.notifications.markRead, { keys })

    const after = await as(worker).query(api.notifications.feed, { buildingId, now })
    expect(after!.rows).toHaveLength(keys.length)
    expect(after!.unread).toBe(0)
    expect(after!.rows.every((r) => r.read)).toBe(true)
  })

  test('read state is per person', async () => {
    const { as, buildingId, worker, manager } = await setup()
    const now = Date.now()

    const feed = await as(worker).query(api.notifications.feed, { buildingId, now })
    await as(worker).mutation(api.notifications.markRead, {
      keys: feed!.rows.map((r) => r.key),
    })

    const theirs = await as(manager).query(api.notifications.feed, { buildingId, now })
    expect(theirs!.unread).toBeGreaterThan(0)
  })

  test('a round marked read comes back when it next falls due', async () => {
    const { t, as, buildingId, worker } = await setup()
    const start = Date.now()

    // The completions are written directly so their times are ours to choose —
    // going through the mutation twice inside one test stamps both with the
    // same millisecond, which is exactly the case this test must not hit.
    const walk = async (at: number) =>
      await t.run(async (ctx) => {
        await ctx.db.insert('routineCompletions', {
          buildingId,
          routine: 'rounds',
          completedAt: at,
        })
      })

    await walk(start)
    const due = await as(worker).query(api.notifications.feed, {
      buildingId,
      now: start + 2 * HOUR,
    })
    const key = due!.rows.find((r) => r.key.startsWith('routine:rounds'))!.key

    await as(worker).mutation(api.notifications.markRead, { keys: [key] })
    const read = await as(worker).query(api.notifications.feed, {
      buildingId,
      now: start + 2 * HOUR,
    })
    expect(read!.rows.find((r) => r.key === key)!.read).toBe(true)

    // Walked again three hours later; the round that falls due after *that* is
    // a new notification, not the one already dismissed this morning.
    await walk(start + 3 * HOUR)
    const nextDue = await as(worker).query(api.notifications.feed, {
      buildingId,
      now: start + 5 * HOUR,
    })
    const next = nextDue!.rows.find((r) => r.key.startsWith('routine:rounds'))!
    expect(next.key).not.toBe(key)
    expect(next.read).toBe(false)
  })

  test('a guest who stayed the night without approval is a high alert', async () => {
    const { t, as, buildingId, tenantId, worker } = await setup()

    await t.run(async (ctx) => {
      const visitorId = await ctx.db.insert('visitors', {
        buildingId,
        name: 'Ray Okafor',
      })
      await ctx.db.insert('visits', {
        visitorId,
        buildingId,
        tenantId,
        signedInAt: Date.now() - 14 * HOUR,
        overnight: true,
        authorized: false,
      })
    })

    const feed = await as(worker).query(api.notifications.feed, { buildingId, now: Date.now() })
    const row = feed!.rows.find((r) => r.kind === 'visitor')!
    expect(row.severity).toBe('high')
    expect(row.title).toContain('Ray Okafor')
    expect(row.href).toBe('/visitors')
  })

  test('a worker cannot read another site’s feed', async () => {
    const { t, as, worker } = await setup()

    const elsewhere = await t.run(async (ctx) =>
      await ctx.db.insert('buildings', {
        name: 'Carrall Annex',
        slug: 'carrall-annex',
        units: 12,
      }),
    )

    await expect(
      as(worker).query(api.notifications.feed, { buildingId: elsewhere, now: Date.now() }),
    ).rejects.toThrow(/not assigned/)

    await expect(
      as(worker).mutation(api.routines.complete, { buildingId: elsewhere, routine: 'rounds' }),
    ).rejects.toThrow(/not assigned/)
  })
})
