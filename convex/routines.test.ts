/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { graceMinutes, shiftSlots } from './routines'

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

const HOUR = 60 * 60_000

/**
 * UTC. Slots are anchored to local midnight, so a fixture that drifts with the
 * machine's timezone would put "the 9pm round" in a different slot depending on
 * where the suite runs.
 */
const TZ = 0

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

describe('how a shift divides into slots', () => {
  test('the frequency sets how many rounds a shift owes', () => {
    // Evening, 4pm–12am.
    expect(shiftSlots(60, 16, 24)).toHaveLength(8)
    expect(shiftSlots(120, 16, 24)).toHaveLength(4)
    expect(shiftSlots(240, 16, 24)).toHaveLength(2)

    expect(shiftSlots(120, 16, 24)[0]).toEqual({ startMinutes: 960, endMinutes: 1080 })
  })

  test('a trailing part-slot is not offered as a round', () => {
    // 90 minutes across an 8-hour shift leaves half an hour over. Five rounds,
    // not five and a bit — 30 minutes is not a walk of the building, and
    // offering it as one invites a half-done sweep to be signed off.
    expect(shiftSlots(90, 16, 24)).toHaveLength(5)
    expect(shiftSlots(90, 16, 24).at(-1)!.endMinutes).toBe(1410) // 23:30
  })

  test('grace scales with the interval', () => {
    // Fifteen minutes into an hourly round is still that round being walked;
    // fifteen minutes into a four-hourly one is barely started.
    expect(graceMinutes(60)).toBe(15)
    expect(graceMinutes(240)).toBe(60)
    // Never so small that a round is late the moment its hour opens.
    expect(graceMinutes(15)).toBe(5)
  })
})

describe('logging a round', () => {
  test('a walked slot is filled, and the bell stops asking about it', async () => {
    const { t, as, buildingId, worker } = await setup()

    // 08:30 UTC: half an hour into the morning shift's first hourly slot, so
    // there is a live slot and nothing yet missed behind it.
    const at = (h: number, m = 0) => Date.UTC(2026, 8, 4, h, m)

    const before = await as(worker).query(api.routines.board, {
      buildingId,
      now: at(8, 30),
      tzOffsetMinutes: TZ,
    })
    const rounds = before!.rows.find((r) => r.routine === 'rounds')!
    expect(rounds.total).toBe(8) // 8am–4pm, hourly
    expect(rounds.slots[0]).toMatchObject({ startMinutes: 480, status: 'now' })
    expect(rounds.missed).toBe(0)

    // Past the 15-minute grace inside its own hour, so the bell is asking.
    const feedBefore = await as(worker).query(api.notifications.feed, {
      buildingId,
      now: at(8, 30),
      tzOffsetMinutes: TZ,
    })
    expect(feedBefore!.rows.find((r) => r.key === `routine:rounds:${at(8)}`)).toMatchObject({
      severity: 'med',
    })

    await t.run(async (ctx) => {
      await ctx.db.insert('routineCompletions', {
        buildingId,
        routine: 'rounds',
        completedAt: at(8, 40),
        completedBy: worker,
      })
    })

    const after = await as(worker).query(api.routines.board, {
      buildingId,
      now: at(8, 45),
      tzOffsetMinutes: TZ,
    })
    const walked = after!.rows.find((r) => r.routine === 'rounds')!
    expect(walked.slots[0]).toMatchObject({ status: 'done', doneAt: at(8, 40) })
    expect(walked.done).toBe(1)
    expect(walked.lastBy).toBe('Devon Mraz')

    const feedAfter = await as(worker).query(api.notifications.feed, {
      buildingId,
      now: at(8, 45),
      tzOffsetMinutes: TZ,
    })
    expect(feedAfter!.rows.some((r) => r.key.startsWith('routine:rounds'))).toBe(false)
  })

  test('a slot that has ended unwalked is missed, and stays missed', async () => {
    const { t, as, buildingId, worker } = await setup()
    const at = (h: number, m = 0) => Date.UTC(2026, 8, 4, h, m)

    // Walked at 10:20 — the 9am hour was skipped and cannot be recovered by
    // walking the 10am one. This is the case a rolling interval forgets.
    await t.run(async (ctx) => {
      await ctx.db.insert('routineCompletions', {
        buildingId,
        routine: 'rounds',
        completedAt: at(10, 20),
        completedBy: worker,
      })
    })

    const board = await as(worker).query(api.routines.board, {
      buildingId,
      now: at(10, 30),
      tzOffsetMinutes: TZ,
    })
    const rounds = board!.rows.find((r) => r.routine === 'rounds')!
    expect(rounds.slots.filter((s) => s.status === 'missed').map((s) => s.startMinutes))
      .toEqual([480, 540]) // 8am and 9am
    expect(rounds.done).toBe(1)

    const feed = await as(worker).query(api.notifications.feed, {
      buildingId,
      now: at(10, 30),
      tzOffsetMinutes: TZ,
    })
    expect(feed!.rows.find((r) => r.kind === 'routine' && r.key.includes('rounds:missed')))
      .toMatchObject({ severity: 'high', title: 'Building rounds missed 2 times this shift' })
  })

  test('a walk is timed against its own slot, not against the last one', async () => {
    const { t, as, buildingId, worker } = await setup()

    // Nothing walked for five hours. Measured as a stopwatch that is three
    // hours past due on a two-hourly round; measured as a slot, the walk
    // happening now is simply this period's walk.
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
      tzOffsetMinutes: TZ,
    })

    // Perimeter runs every 2 hours, so a slot is 120 minutes and no walk inside
    // one can be more than that far into it — however long the gap before it.
    expect(result.slotStartMinutes).not.toBeNull()
    expect(result.slotStartMinutes! % 120).toBe(0)
    expect(result.minutesIntoSlot).toBeGreaterThanOrEqual(0)
    expect(result.minutesIntoSlot).toBeLessThan(120)

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
    expect(stored!.minutesLate ?? 0).toBe(result.minutesIntoSlot)
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
      as(worker).mutation(api.routines.complete, { buildingId, routine: 'perimeter', tzOffsetMinutes: TZ }),
    ).rejects.toThrow(/turned off/)

    const board = await as(worker).query(api.routines.board, { buildingId, now: Date.now(), tzOffsetMinutes: TZ })
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
    const deskFeed = await as(worker).query(api.notifications.feed, { buildingId, now, tzOffsetMinutes: TZ })
    expect(deskFeed!.rows.some((r) => r.kind === 'rent')).toBe(false)

    const managerFeed = await as(manager).query(api.notifications.feed, { buildingId, now, tzOffsetMinutes: TZ })
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

    const feed = await as(worker).query(api.notifications.feed, { buildingId, now: Date.now(), tzOffsetMinutes: TZ })
    expect(feed!.rows.find((r) => r.key === `need:${needId}`)).toMatchObject({
      severity: 'high',
      href: `/tenants/${tenantId}`,
    })

    await t.run(async (ctx) => {
      await ctx.db.patch(needId, { resolvedAt: Date.now() })
    })

    const after = await as(worker).query(api.notifications.feed, { buildingId, now: Date.now(), tzOffsetMinutes: TZ })
    expect(after!.rows.some((r) => r.key === `need:${needId}`)).toBe(false)
  })

  test('marking read does not remove the item, only the badge', async () => {
    const { as, buildingId, worker } = await setup()
    const now = Date.now()

    const before = await as(worker).query(api.notifications.feed, { buildingId, now, tzOffsetMinutes: TZ })
    const keys = before!.rows.map((r) => r.key)
    expect(before!.unread).toBe(keys.length)

    await as(worker).mutation(api.notifications.markRead, { keys })

    const after = await as(worker).query(api.notifications.feed, { buildingId, now, tzOffsetMinutes: TZ })
    expect(after!.rows).toHaveLength(keys.length)
    expect(after!.unread).toBe(0)
    expect(after!.rows.every((r) => r.read)).toBe(true)
  })

  test('read state is per person', async () => {
    const { as, buildingId, worker, manager } = await setup()
    const now = Date.now()

    const feed = await as(worker).query(api.notifications.feed, { buildingId, now, tzOffsetMinutes: TZ })
    await as(worker).mutation(api.notifications.markRead, {
      keys: feed!.rows.map((r) => r.key),
    })

    const theirs = await as(manager).query(api.notifications.feed, { buildingId, now, tzOffsetMinutes: TZ })
    expect(theirs!.unread).toBeGreaterThan(0)
  })

  test('dismissing “due this hour” does not also dismiss “you missed it”', async () => {
    const { t, as, buildingId, worker } = await setup()
    const at = (h: number, m = 0) => Date.UTC(2026, 8, 4, h, m)

    // 8am walked, so the shift opens clean and the 9am slot is the live one.
    await t.run(async (ctx) => {
      await ctx.db.insert('routineCompletions', {
        buildingId,
        routine: 'rounds',
        completedAt: at(8, 10),
      })
    })

    const due = await as(worker).query(api.notifications.feed, {
      buildingId,
      now: at(9, 30),
      tzOffsetMinutes: TZ,
    })
    const key = due!.rows.find((r) => r.key.startsWith('routine:rounds'))!.key
    expect(key).toBe(`routine:rounds:${at(9)}`)

    await as(worker).mutation(api.notifications.markRead, { keys: [key] })
    const read = await as(worker).query(api.notifications.feed, {
      buildingId,
      now: at(9, 30),
      tzOffsetMinutes: TZ,
    })
    expect(read!.rows.find((r) => r.key === key)!.read).toBe(true)

    /*
       An hour on, that same 9am slot has ended unwalked. "It is due" and "it
       was missed" are different statements about the same hour, and waving away
       the first must not silently swallow the second — that is precisely the
       gap somebody needs told about at handover.
    */
    const later = await as(worker).query(api.notifications.feed, {
      buildingId,
      now: at(10, 30),
      tzOffsetMinutes: TZ,
    })
    const next = later!.rows.find((r) => r.key.startsWith('routine:rounds'))!
    expect(next.key).toBe(`routine:rounds:missed:${at(9)}`)
    expect(next.severity).toBe('high')
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

    const feed = await as(worker).query(api.notifications.feed, { buildingId, now: Date.now(), tzOffsetMinutes: TZ })
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
      as(worker).query(api.notifications.feed, { buildingId: elsewhere, now: Date.now(), tzOffsetMinutes: TZ }),
    ).rejects.toThrow(/not assigned/)

    await expect(
      as(worker).mutation(api.routines.complete, { buildingId: elsewhere, routine: 'rounds', tzOffsetMinutes: TZ }),
    ).rejects.toThrow(/not assigned/)
  })
})
