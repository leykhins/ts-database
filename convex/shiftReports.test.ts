/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'

/**
 * A worker's own shift history. What matters: it is *theirs* (nobody else's
 * reports, no drafts), it is bounded to the month asked for, and it reaches
 * across every building they have worked at.
 */

const modules = import.meta.glob('./**/*.ts')

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const buildingA = await ctx.db.insert('buildings', { name: 'Cedar House', slug: 'cedar-house', units: 2 })
    const buildingB = await ctx.db.insert('buildings', { name: 'Eastside Lodge', slug: 'eastside-lodge', units: 2 })
    const devon = await ctx.db.insert('users', { name: 'Devon Mraz', username: 'devon', role: 'rsw', assignedBuildingIds: [buildingA, buildingB] })
    const sam = await ctx.db.insert('users', { name: 'Sam Oduya', username: 'sam', role: 'wellness', assignedBuildingIds: [buildingA] })

    const report = (
      authorId: Id<'users'>,
      buildingId: Id<'buildings'>,
      shiftDate: string,
      shiftKey: 'overnight' | 'morning' | 'evening',
      status: 'draft' | 'submitted' = 'submitted',
    ) =>
      ctx.db.insert('shiftReports', {
        buildingId, shiftDate, shiftKey, authorId, authorRole: 'rsw', status,
        summary: `${shiftDate} ${shiftKey}`, startedAt: 0, submittedAt: 1,
      })

    await report(devon, buildingA, '2026-08-30', 'evening')
    await report(devon, buildingA, '2026-09-02', 'morning')
    await report(devon, buildingA, '2026-09-02', 'evening')
    await report(devon, buildingB, '2026-09-15', 'overnight')
    await report(devon, buildingA, '2026-09-20', 'morning', 'draft')
    await report(devon, buildingA, '2026-10-01', 'morning')
    await report(sam, buildingA, '2026-09-02', 'morning')

    return { buildingA, buildingB, devon, sam }
  })
  const as = (userId: Id<'users'>) => t.withIdentity({ subject: `${userId}|session` })
  return { t, as, ...ids }
}

describe('shiftReports.mine', () => {
  test('returns only my submitted reports for the month, newest first, across buildings', async () => {
    const { as, devon } = await setup()
    const result = await as(devon).query(api.shiftReports.mine, { month: '2026-09' })

    expect(result.reports.map((r) => [r.shiftDate, r.shiftKey, r.building])).toEqual([
      ['2026-09-15', 'overnight', 'Eastside Lodge'],
      ['2026-09-02', 'evening', 'Cedar House'],
      ['2026-09-02', 'morning', 'Cedar House'],
    ])
    expect(result.earliest).toBe('2026-08-30')
  })

  test('another worker sees their own, and a month with nothing is empty', async () => {
    const { as, sam } = await setup()
    const sept = await as(sam).query(api.shiftReports.mine, { month: '2026-09' })
    expect(sept.reports).toHaveLength(1)
    expect(sept.reports[0]!.shiftDate).toBe('2026-09-02')

    const aug = await as(sam).query(api.shiftReports.mine, { month: '2026-08' })
    expect(aug.reports).toEqual([])
    expect(aug.earliest).toBe('2026-09-02')
  })

  test('refuses a month that is not a month', async () => {
    const { as, devon } = await setup()
    await expect(as(devon).query(api.shiftReports.mine, { month: '2026-13' })).rejects.toThrow(/Pick a month/)
  })
})
