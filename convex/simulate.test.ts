/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'

/**
 * The demo simulator.
 *
 * Two properties are worth a test and the rest is scenery: it must refuse to
 * run unless a deployment opted in, and it must reach the same answer every
 * time it is asked. The second is what lets a cron re-run every fifteen
 * minutes over the same shift without the past reshuffling itself.
 */

const modules = import.meta.glob('./**/*.ts')
const TZ = 0

async function setup(tenantCount = 30) {
  const t = convexTest(schema, modules)

  const ids = await t.run(async (ctx) => {
    const buildingId = await ctx.db.insert('buildings', {
      name: 'Dodson Rooms',
      slug: 'dodson-rooms',
      units: tenantCount,
    })

    const tenantIds: Id<'tenants'>[] = []
    for (let i = 0; i < tenantCount; i++) {
      const roomId = await ctx.db.insert('rooms', {
        buildingId,
        number: String(101 + i),
        floor: 'Floor 1',
        sortKey: i,
        monthlyRentCents: 54_000,
        lastCheckedAt: Date.now(),
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
          // Every third resident is on the managed pharmacy programme.
          ...(i % 3 === 0 ? { health: { careRxProgram: true } } : {}),
        }),
      )
    }

    const worker = await ctx.db.insert('users', {
      name: 'Devon Mraz',
      role: 'rsw',
      assignedBuildingIds: [buildingId],
    })

    return { buildingId, tenantIds, worker }
  })

  const as = (userId: Id<'users'>) => t.withIdentity({ subject: `${userId}|session` })
  return { t, as, ...ids }
}

const checksFor = (t: Awaited<ReturnType<typeof setup>>['t']) =>
  t.run(async (ctx) => await ctx.db.query('wellnessChecks').collect())

describe('the demo simulator', () => {
  afterEach(() => {
    delete process.env.DEMO_SIMULATION
  })

  test('refuses to write care records unless the deployment opted in', async () => {
    const { t } = await setup()
    delete process.env.DEMO_SIMULATION

    await expect(
      t.mutation(internal.simulate.backfill, { tzOffsetMinutes: TZ }),
    ).rejects.toThrow(/DEMO_SIMULATION/)

    // These are fabricated entries in a care record. Off must mean nothing
    // was written, not "wrote a bit then stopped".
    expect(await checksFor(t)).toHaveLength(0)
  })

  test('the tick is a quiet no-op when it is off', async () => {
    const { t } = await setup()
    delete process.env.DEMO_SIMULATION

    // The cron fires everywhere, so the tick must not throw where it is not
    // wanted — an erroring cron is noise on a deployment doing nothing wrong.
    const result = await t.mutation(internal.simulate.tick, { tzOffsetMinutes: TZ })
    expect(result).toMatchObject({ skipped: 'DEMO_SIMULATION is not set' })
    expect(await checksFor(t)).toHaveLength(0)
  })

  describe('when enabled', () => {
    beforeEach(() => {
      process.env.DEMO_SIMULATION = '1'
    })

    test('leaves most of the roster seen and a few deliberately missed', async () => {
      const { t } = await setup(30)
      await t.mutation(internal.simulate.backfill, { tzOffsetMinutes: TZ })

      const checks = await checksFor(t)
      // Six segments of 30 residents, most but not all of them.
      expect(checks.length).toBeGreaterThan(30 * 6 * 0.7)
      expect(checks.length).toBeLessThan(30 * 6)

      // A shift where everybody was seen teaches the screens nothing — the
      // gaps are the whole point of simulating.
      const bySegment = new Map<string, number>()
      for (const c of checks) {
        const key = `${c.shiftDate}|${c.shiftKey}`
        bySegment.set(key, (bySegment.get(key) ?? 0) + 1)
      }
      expect([...bySegment.values()].every((n) => n < 30)).toBe(true)
    })

    test('running it again changes nothing', async () => {
      const { t } = await setup(20)

      await t.mutation(internal.simulate.backfill, { tzOffsetMinutes: TZ })
      const first = await checksFor(t)

      const again = await t.mutation(internal.simulate.backfill, { tzOffsetMinutes: TZ })
      const second = await checksFor(t)

      expect(again.checks).toBe(0)
      expect(second).toHaveLength(first.length)
    })

    /**
     * The property the cron depends on. A resident missed on a shift must stay
     * missed however many times the question is asked — with `Math.random()`
     * they would flip every fifteen minutes and the flagged list would
     * reshuffle in front of whoever was reading it.
     */
    test('the same residents are skipped every time', async () => {
      const seen = async () => {
        const { t } = await setup(24)
        await t.mutation(internal.simulate.backfill, { tzOffsetMinutes: TZ })
        return (await checksFor(t))
          .map((c) => `${c.shiftDate}|${c.shiftKey}|${c.roomId}`)
          .sort()
      }

      // Two independent deployments, same fixtures: identical gaps.
      const a = await seen()
      const b = await seen()
      expect(a).toEqual(b)
      expect(a.length).toBeGreaterThan(0)
    })
  })
})

describe('the medication round', () => {
  test('counts the residents it is actually for', async () => {
    const { t, as, buildingId, worker } = await setup(30)

    const board = await as(worker).query(api.routines.board, {
      buildingId,
      now: Date.UTC(2026, 8, 4, 10, 30),
      tzOffsetMinutes: TZ,
    })

    // Every third resident of 30 is on the programme.
    const meds = board!.rows.find((r) => r.routine === 'meds')!
    expect(meds.subjectCount).toBe(10)

    // The building rounds are the building, not a number of people.
    expect(board!.rows.find((r) => r.routine === 'rounds')!.subjectCount).toBeNull()
  })
})
