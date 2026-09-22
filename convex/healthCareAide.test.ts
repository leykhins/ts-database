/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')
const now = Date.UTC(2026, 8, 21, 10)

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const buildingId = await ctx.db.insert('buildings', { name: 'Respite', slug: 'respite', units: 1 })
    const otherBuildingId = await ctx.db.insert('buildings', { name: 'Other site', slug: 'other', units: 1 })
    const adminId = await ctx.db.insert('users', { name: 'Administrator', role: 'admin' })
    const aideId = await ctx.db.insert('users', {
      name: 'Health Care Aide', role: 'health-care-aide', assignedBuildingIds: [buildingId],
    })
    const tenantId = await ctx.db.insert('tenants', {
      buildingId, name: 'Resident', status: 'current', intakeDate: '2026-01-01',
      supportLevel: 'high', monthlyRentCents: 54000, depositRequiredCents: 54000,
      health: { careRxProgram: true },
    })
    return { buildingId, otherBuildingId, adminId, aideId, tenantId }
  })
  return {
    t, ...ids,
    aide: t.withIdentity({ subject: `${ids.aideId}|session` }),
    admin: t.withIdentity({ subject: `${ids.adminId}|session` }),
  }
}

describe('Health Care Aide', () => {
  test('can be assigned and simulated with frontline permissions', async () => {
    const { t, admin, aide, aideId, tenantId } = await setup()
    await t.run((ctx) => ctx.db.patch(aideId, { role: 'rsw' }))
    await admin.mutation(api.users.updateRole, { userId: aideId, role: 'health-care-aide' })
    expect(await aide.query(api.users.me)).toMatchObject({
      role: 'health-care-aide', roleLabel: 'Health Care Aide',
      capabilities: ['care', 'checks', 'wellness', 'medications'],
    })
    await admin.mutation(api.users.setSimulatedRole, { role: 'health-care-aide' })
    expect(await admin.query(api.users.me)).toMatchObject({
      role: 'health-care-aide', realRole: 'admin', simulating: true,
    })
    await expect(admin.mutation(api.rents.receivePayment, {
      tenantId, amountCents: 1000, method: 'cash',
    })).rejects.toThrow(/testing as Health Care Aide/)
    await admin.mutation(api.users.setSimulatedRole, { role: null })
    expect(await admin.query(api.users.me)).toMatchObject({ role: 'admin', simulating: false })
  })

  test('persists HCA duties, resident observations and the report author role', async () => {
    const { t, aide, buildingId, tenantId } = await setup()
    const args = { buildingId, now, tzOffsetMinutes: 0 }
    const before = await aide.query(api.care.overview, args)
    expect(before?.me.duties.map((d) => d.key)).toContain('hca-nutrition')
    expect(before?.me.duties.map((d) => d.key)).not.toContain('lobby')
    const reportId = await aide.mutation(api.shiftReports.start, args)
    await aide.mutation(api.care.setDuty, { reportId, duty: 'hca-nutrition', done: true })
    await aide.mutation(api.care.logCheck, { tenantId, outcome: 'seen', now, tzOffsetMinutes: 0 })
    await aide.mutation(api.shiftReports.addEntry, {
      reportId, log: 'interaction', tenantIds: [tenantId], location: 'Resident room',
      occurredAt: now, kind: 'welfare', comments: 'Assisted with lunch; intake shared with the care team.',
      significant: false, cameraReview: false,
    })
    const after = await aide.query(api.care.overview, args)
    expect(after?.me).toMatchObject({ dutyProgress: { done: 1, total: 7 }, entryCount: 1 })
    expect(after?.queue).toHaveLength(0)
    expect(await t.run((ctx) => ctx.db.get(reportId))).toMatchObject({ authorRole: 'health-care-aide' })
    await aide.mutation(api.care.setDuty, { reportId, duty: 'hca-nutrition', done: false })
    expect((await aide.query(api.care.overview, args))?.me.dutyProgress.done).toBe(0)
  })

  test('can chart medication support within an assigned building', async () => {
    const { admin, aide, tenantId } = await setup()
    const medicationId = await admin.mutation(api.medications.add, {
      tenantId, name: 'Fixture medication', dose: '1 tablet', route: 'oral',
      times: [600], prn: false, startDate: '2026-09-21',
    })
    await aide.mutation(api.medications.administer, {
      medicationId, date: '2026-09-21', scheduledMinutes: 600, outcome: 'given',
      now, tzOffsetMinutes: 0,
    })
  })

  test('cannot reach another building or manage money or staff', async () => {
    const { aide, otherBuildingId, tenantId, aideId } = await setup()
    await expect(aide.query(api.care.overview, {
      buildingId: otherBuildingId, now, tzOffsetMinutes: 0,
    })).rejects.toThrow(/not assigned to that building/)
    await expect(aide.mutation(api.shiftReports.start, {
      buildingId: otherBuildingId, now, tzOffsetMinutes: 0,
    })).rejects.toThrow(/not assigned to that building/)
    await expect(aide.mutation(api.rents.receivePayment, {
      tenantId, amountCents: 1000, method: 'cash',
    })).rejects.toThrow(/cannot do this/)
    await expect(aide.mutation(api.users.updateRole, {
      userId: aideId, role: 'admin',
    })).rejects.toThrow(/cannot do this/)
  })
})
