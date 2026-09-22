/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { internal } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const TZ = 420

async function setup() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const buildingId = await ctx.db.insert('buildings', {
      name: 'Cedar House',
      slug: 'cedar-house',
      units: 1,
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
      name: 'Demo Resident',
      intakeDate: '2026-01-01',
      status: 'current',
      supportLevel: 'high',
      monthlyRentCents: 54_000,
      depositRequiredCents: 54_000,
    })
    const fixtures = [
      ['test.admin', 'admin'],
      ['test.manager', 'building-manager'],
      ['test.coordinator', 'coordinator'],
      ['test.rsw', 'rsw'],
      ['test.wellness', 'wellness'],
      ['test.support', 'home-support'],
      ['test.hca', 'health-care-aide'],
    ] as const
    for (const [username, role] of fixtures) {
      await ctx.db.insert('users', {
        name: username,
        username,
        role,
        assignedBuildingIds: [buildingId],
      })
    }
    await ctx.db.insert('medications', {
      tenantId,
      buildingId,
      name: 'Metformin',
      strength: '500 mg',
      dose: '1 tablet',
      route: 'oral',
      times: [8 * 60, 18 * 60],
      prn: false,
      startDate: '2026-08-01',
    })
  })
  return t
}

describe('the current-month demo history', () => {
  test('is repeatable and attributes records only to current test users', async () => {
    const t = await setup()
    const args = {
      date: '2026-09-08',
      through: Date.UTC(2026, 8, 9, 7),
      tzOffsetMinutes: TZ,
    }

    const first = await t.mutation(internal.demoMonth.seedDay, args)
    const second = await t.mutation(internal.demoMonth.seedDay, args)
    const proof = await t.query(internal.demoMonth.verify, { month: '2026-09' })

    expect(first.reports).toBe(3)
    expect(first.administrations).toBe(2)
    expect(first.corrections).toBe(1)
    expect(second).toMatchObject({ reports: 0, administrations: 0, corrections: 0 })
    expect(proof).toMatchObject({
      reports: 3,
      reportAuthors: 3,
      administrations: 3,
      staleAttributions: 0,
    })
    expect(proof.users).toHaveLength(7)
    expect(proof.outcomes.voided).toBe(1)
  })

  test('the reset removes operational rows that carry user references', async () => {
    const t = await setup()
    await t.run(async (ctx) => {
      const building = await ctx.db.query('buildings').first()
      const tenant = await ctx.db.query('tenants').first()
      const user = await ctx.db.query('users').first()
      await ctx.db.insert('routineCompletions', {
        buildingId: building!._id,
        routine: 'rounds',
        completedAt: Date.now(),
        completedBy: user!._id,
      })
      await ctx.db.insert('notificationReads', {
        userId: user!._id,
        key: 'demo',
        readAt: Date.now(),
      })
      await ctx.db.insert('placements', {
        tenantId: tenant!._id,
        buildingId: building!._id,
        roomId: tenant!.roomId,
        kind: 'intake',
        startedAt: Date.now(),
        recordedBy: user!._id,
      })
    })

    const result = await t.mutation(internal.seed.wipeAllBatch, { limit: 500 })
    const remaining = await t.run(async (ctx) => ({
      users: (await ctx.db.query('users').collect()).length,
      placements: (await ctx.db.query('placements').collect()).length,
      routines: (await ctx.db.query('routineCompletions').collect()).length,
      reads: (await ctx.db.query('notificationReads').collect()).length,
    }))

    expect(result.done).toBe(true)
    expect(remaining).toEqual({ users: 0, placements: 0, routines: 0, reads: 0 })
  })
})
