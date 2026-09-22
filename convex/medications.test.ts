/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { slotApplies, slotStatus } from './medications'

/**
 * The medication administration record.
 *
 * What is worth testing is what makes it a record: a dose cannot be charted
 * twice, a mistake is voided and not overwritten, a dose that did not go in
 * has to say why, and nobody outside the building — or outside the roles that
 * hand doses over — can touch it. And that the two screens which summarise
 * the MAR (the medication round, the bell) follow it rather than the flag.
 */

const modules = import.meta.glob('./**/*.ts')

/** UTC, so "the 8am dose" is the same slot wherever the suite runs. */
const TZ = 0
const at = (h: number, m = 0) => Date.UTC(2026, 8, 18, h, m)
const DATE = '2026-09-18'

async function setup() {
  const t = convexTest(schema, modules)

  const ids = await t.run(async (ctx) => {
    const buildingB = await ctx.db.insert('buildings', { name: 'Eastside Lodge', slug: 'eastside-lodge', units: 2 })
    const buildingA = await ctx.db.insert('buildings', { name: 'Cedar House', slug: 'cedar-house', units: 2 })

    const room = async (buildingId: Id<'buildings'>, number: string) =>
      await ctx.db.insert('rooms', { buildingId, number, floor: 'Floor 1', sortKey: Number(number), monthlyRentCents: 54_000 })
    const roomA = await room(buildingA, '101')
    const roomA2 = await room(buildingA, '102')
    const roomB = await room(buildingB, '201')

    const tenant = async (buildingId: Id<'buildings'>, roomId: Id<'rooms'>, name: string, programme: boolean) =>
      await ctx.db.insert('tenants', {
        buildingId, roomId, name,
        intakeDate: '2024-03-12', status: 'current', supportLevel: 'high',
        monthlyRentCents: 54_000, depositRequiredCents: 54_000, balanceCents: 0, depositHeldCents: 0,
        health: programme ? { careRxProgram: true, allergies: 'Penicillin' } : { careRxProgram: false },
      })
    const marta = await tenant(buildingA, roomA, 'Marta Reyes', true)
    const dwayne = await tenant(buildingA, roomA2, 'Dwayne Robinson', false)
    const maria = await tenant(buildingB, roomB, 'Maria Santos', true)

    const users = {
      coordinator: await ctx.db.insert('users', { name: 'Ada Cole', username: 'ada', role: 'coordinator', assignedBuildingIds: [buildingA] }),
      rsw: await ctx.db.insert('users', { name: 'Devon Mraz', username: 'devon', role: 'rsw', assignedBuildingIds: [buildingA] }),
      homeSupport: await ctx.db.insert('users', { name: 'Priya Nair', username: 'priya', role: 'home-support', assignedBuildingIds: [buildingA] }),
      wellness: await ctx.db.insert('users', { name: 'Sam Oduya', username: 'sam', role: 'wellness', assignedBuildingIds: [buildingA] }),
      workerB: await ctx.db.insert('users', { name: 'Lee Park', username: 'lee', role: 'rsw', assignedBuildingIds: [buildingB] }),
    }

    return { buildingA, buildingB, marta, dwayne, maria, users }
  })

  const as = (userId: Id<'users'>) => t.withIdentity({ subject: `${userId}|session` })

  const order = {
    name: 'Metformin', strength: '500 mg', dose: '1 tablet', route: 'oral' as const,
    times: [8 * 60, 18 * 60], prn: false, startDate: '2026-09-01',
  }

  return { t, as, order, ...ids }
}

const REFUSED = /not assigned to that building/

describe('slot status', () => {
  test('a dose is due inside the hour either side, overdue after, upcoming before', () => {
    const base = { date: DATE, scheduledMinutes: 8 * 60, charted: false, today: DATE }
    expect(slotStatus({ ...base, nowMinutes: 6 * 60 + 59 })).toBe('upcoming')
    expect(slotStatus({ ...base, nowMinutes: 7 * 60 })).toBe('due')
    expect(slotStatus({ ...base, nowMinutes: 9 * 60 })).toBe('due')
    expect(slotStatus({ ...base, nowMinutes: 9 * 60 + 1 })).toBe('overdue')
    expect(slotStatus({ ...base, charted: true, nowMinutes: 12 * 60 })).toBe('charted')
  })

  test('a past day with nothing charted is a gap, not something to act on', () => {
    expect(slotStatus({ date: '2026-09-17', scheduledMinutes: 480, charted: false, today: DATE, nowMinutes: 0 })).toBe('not-charted')
    expect(slotStatus({ date: '2026-09-19', scheduledMinutes: 480, charted: false, today: DATE, nowMinutes: 0 })).toBe('upcoming')
  })
})

describe('orders', () => {
  test('an order needs the resident to be on the programme', async () => {
    const { as, users, marta, dwayne, order } = await setup()
    await as(users.coordinator).mutation(api.medications.add, { tenantId: marta, ...order })
    await expect(
      as(users.coordinator).mutation(api.medications.add, { tenantId: dwayne, ...order }),
    ).rejects.toThrow(/not on the medication programme/)
  })

  test('support and home-support workers may write the MAR; a wellness worker may not', async () => {
    const { as, users, marta, order } = await setup()
    await as(users.rsw).mutation(api.medications.add, { tenantId: marta, ...order })
    await as(users.homeSupport).mutation(api.medications.add, { tenantId: marta, ...order, name: 'Ramipril' })
    await expect(
      as(users.wellness).mutation(api.medications.add, { tenantId: marta, ...order }),
    ).rejects.toThrow(/cannot do this/)
  })

  test('a scheduled order needs times; an as-needed one needs an indication and no times', async () => {
    const { as, users, marta, order } = await setup()
    const add = (patch: Partial<typeof order> & { prnIndication?: string }) =>
      as(users.coordinator).mutation(api.medications.add, { tenantId: marta, ...order, ...patch })

    await expect(add({ times: [] })).rejects.toThrow(/at least one time/)
    await expect(add({ prn: true, times: [480] })).rejects.toThrow(/no scheduled times/)
    await expect(add({ prn: true, times: [] })).rejects.toThrow(/what an as-needed dose is for/)
    await add({ prn: true, times: [], prnIndication: 'Pain' })
  })

  test('discontinuing takes an order off the board but keeps it on the record', async () => {
    const { t, as, users, marta, order } = await setup()
    const id = await as(users.coordinator).mutation(api.medications.add, { tenantId: marta, ...order })

    await expect(
      as(users.coordinator).mutation(api.medications.discontinue, { medicationId: id, reason: '' }),
    ).rejects.toThrow(/why/)
    await as(users.coordinator).mutation(api.medications.discontinue, { medicationId: id, reason: 'Stopped by GP' })
    // Pin the stop to 7am on the test day, before either dose fell due.
    await t.run((ctx) => ctx.db.patch(id, { discontinuedAt: at(7) }))

    const board = await as(users.rsw).query(api.medications.board, { date: DATE, now: at(12), tzOffsetMinutes: TZ })
    expect(board!.residents.find((r) => r.tenantId === marta)!.medications).toHaveLength(0)

    const record = await as(users.rsw).query(api.medications.forResident, { tenantId: marta, now: at(12), tzOffsetMinutes: TZ })
    expect(record!.active).toHaveLength(0)
    expect(record!.inactive[0]).toMatchObject({ name: 'Metformin', discontinuedReason: 'Stopped by GP', discontinuedBy: 'Ada Cole' })

    await expect(
      as(users.rsw).mutation(api.medications.administer, {
        medicationId: id, date: DATE, scheduledMinutes: 480, outcome: 'given', now: at(8), tzOffsetMinutes: TZ,
      }),
    ).rejects.toThrow(/discontinued/)
  })
})

describe('charting', () => {
  test('a resident not on the programme with no orders is not on the board; the flag alone is enough', async () => {
    const { as, users, marta, dwayne } = await setup()
    const board = await as(users.rsw).query(api.medications.board, { date: DATE, now: at(12), tzOffsetMinutes: TZ })
    expect(board!.residents.map((r) => r.tenantId)).toEqual([marta])
    expect(board!.residents.map((r) => r.tenantId)).not.toContain(dwayne)
  })

  test('a charted dose fills its slot, and the slot cannot be charted twice', async () => {
    const { as, users, marta, order } = await setup()
    const id = await as(users.coordinator).mutation(api.medications.add, { tenantId: marta, ...order })

    const before = await as(users.rsw).query(api.medications.board, { date: DATE, now: at(8, 20), tzOffsetMinutes: TZ })
    const med = before!.residents[0]!.medications[0]!
    expect(med.slots.map((s) => s.status)).toEqual(['due', 'upcoming'])
    expect(before!.counts.due).toBe(1)

    await as(users.rsw).mutation(api.medications.administer, {
      medicationId: id, date: DATE, scheduledMinutes: 480, outcome: 'given', now: at(8, 20), tzOffsetMinutes: TZ,
    })

    await expect(
      as(users.rsw).mutation(api.medications.administer, {
        medicationId: id, date: DATE, scheduledMinutes: 480, outcome: 'given', now: at(8, 25), tzOffsetMinutes: TZ,
      }),
    ).rejects.toThrow(/already charted/)

    const after = await as(users.rsw).query(api.medications.board, { date: DATE, now: at(8, 30), tzOffsetMinutes: TZ })
    const slot = after!.residents[0]!.medications[0]!.slots[0]!
    expect(slot.status).toBe('charted')
    expect(slot.administration).toMatchObject({ outcome: 'given', recordedBy: 'Devon Mraz', timing: 'on-time' })
    expect(after!.counts.given).toBe(1)
  })

  test('a dose that did not go in has to say why', async () => {
    const { as, users, marta, order } = await setup()
    const id = await as(users.coordinator).mutation(api.medications.add, { tenantId: marta, ...order })
    const chart = (outcome: 'refused' | 'held', reason?: string) =>
      as(users.rsw).mutation(api.medications.administer, {
        medicationId: id, date: DATE, scheduledMinutes: 480, outcome, reason, now: at(8), tzOffsetMinutes: TZ,
      })

    await expect(chart('refused')).rejects.toThrow(/why the dose was refused/)
    await expect(chart('held', '   ')).rejects.toThrow(/why the dose was held/)
    await chart('refused', 'Said she had taken it already')
  })

  test('the slot must be on the order, the date must not be in the future', async () => {
    const { as, users, marta, order } = await setup()
    const id = await as(users.coordinator).mutation(api.medications.add, { tenantId: marta, ...order })

    await expect(
      as(users.rsw).mutation(api.medications.administer, {
        medicationId: id, date: DATE, scheduledMinutes: 12 * 60, outcome: 'given', now: at(12), tzOffsetMinutes: TZ,
      }),
    ).rejects.toThrow(/not on the order/)
    await expect(
      as(users.rsw).mutation(api.medications.administer, {
        medicationId: id, date: '2026-09-19', scheduledMinutes: 480, outcome: 'given', now: at(12), tzOffsetMinutes: TZ,
      }),
    ).rejects.toThrow(/has not come/)
  })

  test('a mistake is voided and re-entered, never overwritten', async () => {
    const { as, users, marta, order } = await setup()
    const id = await as(users.coordinator).mutation(api.medications.add, { tenantId: marta, ...order })
    const entry = await as(users.rsw).mutation(api.medications.administer, {
      medicationId: id, date: DATE, scheduledMinutes: 480, outcome: 'given', now: at(8), tzOffsetMinutes: TZ,
    })

    await expect(
      as(users.rsw).mutation(api.medications.voidEntry, { administrationId: entry, reason: '' }),
    ).rejects.toThrow(/why/)
    await as(users.rsw).mutation(api.medications.voidEntry, { administrationId: entry, reason: 'Wrong resident' })

    // The slot is open again and can be charted afresh.
    await as(users.rsw).mutation(api.medications.administer, {
      medicationId: id, date: DATE, scheduledMinutes: 480, outcome: 'refused', reason: 'Declined', now: at(8, 10), tzOffsetMinutes: TZ,
    })

    // Both rows are on the record; the voided one says so.
    const record = await as(users.rsw).query(api.medications.forResident, { tenantId: marta, now: at(9), tzOffsetMinutes: TZ })
    expect(record!.history).toHaveLength(2)
    const voided = record!.history.find((h) => h._id === entry)!
    expect(voided).toMatchObject({ outcome: 'given', voidReason: 'Wrong resident', voidedBy: 'Devon Mraz' })

    // The printed sheet shows what stands, not what was struck through.
    const sheet = await as(users.rsw).query(api.medications.sheet, { tenantId: marta, month: '2026-09' })
    const cell = sheet!.grid.find((g) => g.minutes === 480)!.days[17]
    expect(cell).toMatchObject({ outcome: 'refused', initials: 'DM' })
  })

  test('an as-needed dose needs the reason it was given, and respects the daily cap', async () => {
    const { as, users, marta, order } = await setup()
    const id = await as(users.coordinator).mutation(api.medications.add, {
      tenantId: marta, ...order, name: 'Acetaminophen', times: [], prn: true, prnIndication: 'Pain', prnMaxPerDay: 2,
    })
    const give = (h: number, reason?: string) =>
      as(users.rsw).mutation(api.medications.administer, {
        medicationId: id, date: DATE, outcome: 'given', reason, now: at(h), tzOffsetMinutes: TZ,
      })

    await expect(give(8)).rejects.toThrow(/why the as-needed dose was given/)
    await give(8, 'Headache 6/10')
    await give(14, 'Headache again')
    await expect(give(20, 'Back pain')).rejects.toThrow(/capped at 2 doses/)

    // A refusal does not count against the cap.
    await as(users.rsw).mutation(api.medications.administer, {
      medicationId: id, date: DATE, outcome: 'refused', reason: 'Offered, declined', now: at(20), tzOffsetMinutes: TZ,
    })

    const board = await as(users.rsw).query(api.medications.board, { date: DATE, now: at(21), tzOffsetMinutes: TZ })
    expect(board!.residents[0]!.medications[0]!.prnToday).toHaveLength(3)
    expect(board!.counts.prn).toBe(3)
  })
})

describe('the time a dose was given', () => {
  test('is kept apart from when it was charted, and judged against the slot', async () => {
    const { as, users, marta, order } = await setup()
    const id = await as(users.coordinator).mutation(api.medications.add, { tenantId: marta, ...order })

    // Given at 8:05, written up at 11:40.
    await as(users.rsw).mutation(api.medications.administer, {
      medicationId: id, date: DATE, scheduledMinutes: 480, outcome: 'given',
      givenAt: at(8, 5), now: at(11, 40), tzOffsetMinutes: TZ,
    })
    const board = await as(users.rsw).query(api.medications.board, { date: DATE, now: at(11, 45), tzOffsetMinutes: TZ })
    expect(board!.residents[0]!.medications[0]!.slots[0]!.administration).toMatchObject({
      givenAt: at(8, 5), recordedAt: at(11, 40), timing: 'on-time', backCharted: true,
    })
  })

  test('a dose given outside the hour either side is early or late', async () => {
    const { as, users, marta, order } = await setup()
    const id = await as(users.coordinator).mutation(api.medications.add, { tenantId: marta, ...order })
    await as(users.rsw).mutation(api.medications.administer, {
      medicationId: id, date: DATE, scheduledMinutes: 480, outcome: 'given',
      givenAt: at(10, 15), now: at(10, 20), tzOffsetMinutes: TZ,
    })
    await as(users.rsw).mutation(api.medications.administer, {
      medicationId: id, date: DATE, scheduledMinutes: 18 * 60, outcome: 'given',
      givenAt: at(16, 30), now: at(16, 30), tzOffsetMinutes: TZ,
    })
    const board = await as(users.rsw).query(api.medications.board, { date: DATE, now: at(17), tzOffsetMinutes: TZ })
    const [eight, six] = board!.residents[0]!.medications[0]!.slots
    expect(eight!.administration).toMatchObject({ timing: 'late', backCharted: false })
    expect(six!.administration!.timing).toBe('early')
    expect(board!.counts.late).toBe(2)
  })

  test('the time given cannot be in the future, or off the day of the dose', async () => {
    const { as, users, marta, order } = await setup()
    const id = await as(users.coordinator).mutation(api.medications.add, { tenantId: marta, ...order })
    const chart = (givenAt: number) =>
      as(users.rsw).mutation(api.medications.administer, {
        medicationId: id, date: DATE, scheduledMinutes: 480, outcome: 'given', givenAt, now: at(9), tzOffsetMinutes: TZ,
      })
    await expect(chart(at(9, 30))).rejects.toThrow(/future/)
    await expect(chart(at(-2))).rejects.toThrow(/fall on the day/)
  })

  test('a late-evening dose may be given after midnight and charted to its own day', async () => {
    const { as, users, marta, order } = await setup()
    const id = await as(users.coordinator).mutation(api.medications.add, { tenantId: marta, ...order, times: [23 * 60 + 30] })
    await as(users.rsw).mutation(api.medications.administer, {
      medicationId: id, date: DATE, scheduledMinutes: 23 * 60 + 30, outcome: 'given',
      givenAt: at(24, 20), now: at(24, 25), tzOffsetMinutes: TZ,
    })
    const board = await as(users.rsw).query(api.medications.board, { date: DATE, now: at(24, 30), tzOffsetMinutes: TZ })
    expect(board!.residents[0]!.medications[0]!.slots[0]!.administration!.timing).toBe('on-time')
  })
})

describe('different schedules, and changing them', () => {
  test('each resident’s order carries its own times', async () => {
    const { t, as, users, marta, order, buildingA } = await setup()
    await t.run((ctx) => ctx.db.patch(marta, { health: { careRxProgram: true } }))
    const priyaT = await t.run(async (ctx) => {
      const room = await ctx.db.insert('rooms', { buildingId: buildingA, number: '103', floor: 'Floor 1', sortKey: 103, monthlyRentCents: 1 })
      return ctx.db.insert('tenants', {
        buildingId: buildingA, roomId: room, name: 'Kofi Mensah', intakeDate: '2024-01-01', status: 'current',
        supportLevel: 'high', monthlyRentCents: 1, depositRequiredCents: 1, health: { careRxProgram: true },
      })
    })
    await as(users.coordinator).mutation(api.medications.add, { tenantId: marta, ...order, times: [8 * 60] })
    await as(users.coordinator).mutation(api.medications.add, { tenantId: priyaT, ...order, times: [9 * 60 + 30, 21 * 60] })

    const board = await as(users.rsw).query(api.medications.board, { date: DATE, now: at(7), tzOffsetMinutes: TZ })
    const times = Object.fromEntries(
      board!.residents.map((r) => [r.name, r.medications[0]!.slots.map((s) => s.minutes)]),
    )
    expect(times).toEqual({ 'Marta Reyes': [480], 'Kofi Mensah': [570, 1260] })
  })

  test('a prescription change is a cutover: earlier doses stay with the old order, later ones move', async () => {
    const { as, users, marta, order } = await setup()
    const oldId = await as(users.coordinator).mutation(api.medications.add, { tenantId: marta, ...order })
    await as(users.rsw).mutation(api.medications.administer, {
      medicationId: oldId, date: DATE, scheduledMinutes: 480, outcome: 'given', givenAt: at(8), now: at(8), tzOffsetMinutes: TZ,
    })

    // The change is written "now"; the test pins now to 11am on the day.
    const newId = await as(users.coordinator).mutation(api.medications.change, {
      medicationId: oldId, reason: 'GP increased dose, phone order', tzOffsetMinutes: TZ,
      ...order, strength: '1000 mg', times: [8 * 60, 14 * 60, 20 * 60], startDate: DATE,
    })
    // convex-test cannot pin `_creationTime` to 11am on the test day, so the
    // cutover rule is exercised directly on documents shaped like the pair.
    const base = { _id: newId, _creationTime: at(11), tenantId: marta, buildingId: 'b' as Id<'buildings'>,
      name: 'Metformin', dose: '1 tablet', route: 'oral' as const, prn: false, startDate: DATE, times: [480, 840, 1200] }
    expect(slotApplies(base, DATE, 480, TZ)).toBe(false) // came and went before the order existed
    expect(slotApplies(base, DATE, 840, TZ)).toBe(true)
    const old = { ...base, _id: oldId, _creationTime: at(-100), startDate: '2026-09-01', times: [480, 1080], discontinuedAt: at(11) }
    expect(slotApplies(old, DATE, 480, TZ)).toBe(true)
    expect(slotApplies(old, DATE, 1080, TZ)).toBe(false) // never owed: stopped before it fell due

    const record = await as(users.rsw).query(api.medications.forResident, { tenantId: marta, now: at(12), tzOffsetMinutes: TZ })
    expect(record!.inactive[0]).toMatchObject({ _id: oldId, discontinuedReason: 'Changed: GP increased dose, phone order' })
  })

  test('change refuses a missing reason and links the new order to the old', async () => {
    const { as, users, marta, order } = await setup()
    const oldId = await as(users.coordinator).mutation(api.medications.add, { tenantId: marta, ...order })
    await expect(
      as(users.coordinator).mutation(api.medications.change, { medicationId: oldId, reason: ' ', tzOffsetMinutes: TZ, ...order }),
    ).rejects.toThrow(/what changed/)

    const newId = await as(users.coordinator).mutation(api.medications.change, {
      medicationId: oldId, reason: 'Dose up', tzOffsetMinutes: TZ, ...order, strength: '1000 mg',
    })
    const record = await as(users.rsw).query(api.medications.forResident, { tenantId: marta, now: Date.now(), tzOffsetMinutes: TZ })
    expect(record!.active.map((o) => o._id)).toEqual([newId])
    expect(record!.active[0]!.replaces).toBe('Metformin 500 mg · 1 tablet')
    expect(record!.inactive[0]!.replacedBy).toBe('Metformin 1000 mg · 1 tablet')
    // A change takes effect today, however it was dated.
    expect(record!.active[0]!.startDate >= '2026-09-01').toBe(true)
    await expect(
      as(users.wellness).mutation(api.medications.change, { medicationId: newId, reason: 'x', tzOffsetMinutes: TZ, ...order }),
    ).rejects.toThrow(/cannot do this/)
  })
})

describe('the medication round', () => {
  test('its slots are the times residents are actually due, not a frequency', async () => {
    const { t, as, users, marta, order, buildingA } = await setup()
    await t.run((ctx) =>
      ctx.db.insert('siteSettings', {
        buildingId: buildingA,
        routines: [{ routine: 'meds', everyMinutes: 240, enabled: true }],
      }),
    )
    // 8am and 6pm on one order, 9am and 2pm on another: the morning shift owes
    // 8, 9 and 2 — never the 8-and-12 a four-hourly strip would have drawn.
    const eight = await as(users.coordinator).mutation(api.medications.add, { tenantId: marta, ...order })
    await as(users.coordinator).mutation(api.medications.add, {
      tenantId: marta, ...order, name: 'Ramipril', times: [9 * 60, 14 * 60],
    })

    // 9:30 — the 8am window (7–9) has closed, the 9am one (8–10) is open.
    const board = await as(users.rsw).query(api.routines.board, { now: at(9, 30), tzOffsetMinutes: TZ })
    const meds = board!.rows.find((r) => r.routine === 'meds')!
    expect(meds.cadence).toBe('orders')
    expect(meds.slots.map((s) => s.startMinutes)).toEqual([480, 540, 840])
    // 8am is past its window and uncharted; 9am still inside it; 2pm to come.
    expect(meds.slots.map((s) => s.status)).toEqual(['missed', 'now', 'upcoming'])

    await as(users.rsw).mutation(api.medications.administer, {
      medicationId: eight, date: DATE, scheduledMinutes: 480, outcome: 'given',
      givenAt: at(8, 5), now: at(9, 35), tzOffsetMinutes: TZ,
    })
    const after = await as(users.rsw).query(api.routines.board, { now: at(9, 35), tzOffsetMinutes: TZ })
    expect(after!.rows.find((r) => r.routine === 'meds')!.slots[0]).toMatchObject({
      startMinutes: 480, status: 'done', due: 1, charted: 1,
    })
  })

  test('the round is charted in the MAR, not logged, and the bell says it once', async () => {
    const { as, users, marta, order } = await setup()
    await as(users.coordinator).mutation(api.medications.add, { tenantId: marta, ...order })

    await expect(
      as(users.rsw).mutation(api.routines.complete, { routine: 'meds', tzOffsetMinutes: TZ }),
    ).rejects.toThrow(/dose by dose in the MAR/)

    // 9:30: the 8am dose is overdue. One line about it, from the MAR — not a
    // second one about a missed round.
    const feed = await as(users.rsw).query(api.notifications.feed, { now: at(9, 30), tzOffsetMinutes: TZ })
    expect(feed!.rows.filter((r) => r.kind === 'medication')).toHaveLength(1)
    expect(feed!.rows.filter((r) => r.kind === 'routine' && /Medication/.test(r.title))).toEqual([])
  })
})

describe('the Care Console tracker', () => {
  test('shows this shift’s doses in time order, with what has been charted', async () => {
    const { as, users, marta, order } = await setup()
    const id = await as(users.coordinator).mutation(api.medications.add, {
      tenantId: marta, ...order, times: [7 * 60, 9 * 60, 13 * 60, 18 * 60],
    })
    await as(users.rsw).mutation(api.medications.administer, {
      medicationId: id, date: DATE, scheduledMinutes: 9 * 60, outcome: 'given', givenAt: at(9, 10), now: at(9, 10), tzOffsetMinutes: TZ,
    })

    // 12:30, the morning shift (8–4): 9am and 1pm are this shift's; 7am and 6pm are not.
    const shift = await as(users.rsw).query(api.medications.shift, { now: at(12, 30), tzOffsetMinutes: TZ })
    expect(shift!.shift.key).toBe('morning')
    expect(shift!.doses.map((d) => [d.minutes, d.status])).toEqual([[540, 'charted'], [780, 'due']])
    expect(shift!.counts).toMatchObject({ total: 2, given: 1, due: 1, overdue: 0 })
    expect(shift!.doses[0]!.administration!.givenAt).toBe(at(9, 10))
    expect(shift!.doses[0]!.allergies).toBe('Penicillin')
  })
})

describe('what follows the record', () => {
  test('the medication round counts doses due this shift, not residents flagged', async () => {
    const { as, users, marta, order } = await setup()

    // Flagged but no orders: the round is for nobody yet.
    let board = await as(users.rsw).query(api.routines.board, { now: at(10), tzOffsetMinutes: TZ })
    expect(board!.rows.find((r) => r.routine === 'meds')!.subjectCount).toBe(0)

    // 8am and 6pm: one dose in the morning shift, one in the evening.
    await as(users.coordinator).mutation(api.medications.add, { tenantId: marta, ...order })
    await as(users.coordinator).mutation(api.medications.add, { tenantId: marta, ...order, name: 'Ramipril', times: [9 * 60] })

    board = await as(users.rsw).query(api.routines.board, { now: at(10), tzOffsetMinutes: TZ })
    expect(board!.rows.find((r) => r.routine === 'meds')!.subjectCount).toBe(2)
    board = await as(users.rsw).query(api.routines.board, { now: at(19), tzOffsetMinutes: TZ })
    expect(board!.rows.find((r) => r.routine === 'meds')!.subjectCount).toBe(1)
  })

  test('the bell raises overdue doses for those who can chart them, and drops them once charted', async () => {
    const { as, users, marta, order } = await setup()
    const id = await as(users.coordinator).mutation(api.medications.add, { tenantId: marta, ...order })

    const feed = async (user: Id<'users'>, h: number, m = 0) =>
      (await as(user).query(api.notifications.feed, { now: at(h, m), tzOffsetMinutes: TZ }))!.rows.filter(
        (r) => r.kind === 'medication',
      )

    // 8:30 — inside the window, nothing to shout about.
    expect(await feed(users.rsw, 8, 30)).toHaveLength(0)

    // 9:30 — past it.
    const rows = await feed(users.rsw, 9, 30)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.title).toMatch(/Marta Reyes — 1 dose overdue/)

    // A wellness worker cannot chart it, so is not told about it.
    expect(await feed(users.wellness, 9, 30)).toHaveLength(0)

    await as(users.rsw).mutation(api.medications.administer, {
      medicationId: id, date: DATE, scheduledMinutes: 480, outcome: 'given', now: at(9, 30), tzOffsetMinutes: TZ,
    })
    expect(await feed(users.rsw, 9, 30)).toHaveLength(0)

    // Charted after the window: shown as late, never hidden.
    const board = await as(users.rsw).query(api.medications.board, { date: DATE, now: at(10), tzOffsetMinutes: TZ })
    // No time given was entered, so it was taken as the moment of charting.
    expect(board!.residents[0]!.medications[0]!.slots[0]!.administration!.timing).toBe('late')
  })
})

describe('scoping', () => {
  test('a worker cannot read or write another building’s MAR', async () => {
    const { as, users, buildingB, maria, order } = await setup()
    const lee = as(users.workerB)
    const id = await lee.mutation(api.medications.add, { tenantId: maria, ...order })
    const entry = await lee.mutation(api.medications.administer, {
      medicationId: id, date: DATE, scheduledMinutes: 480, outcome: 'given', now: at(8), tzOffsetMinutes: TZ,
    })

    const devon = as(users.rsw)
    await expect(devon.query(api.medications.board, { buildingId: buildingB, date: DATE, now: at(8), tzOffsetMinutes: TZ })).rejects.toThrow(REFUSED)
    await expect(devon.query(api.medications.forResident, { tenantId: maria, now: at(8), tzOffsetMinutes: TZ })).rejects.toThrow(REFUSED)
    await expect(devon.query(api.medications.sheet, { tenantId: maria, month: '2026-09' })).rejects.toThrow(REFUSED)
    await expect(devon.mutation(api.medications.add, { tenantId: maria, ...order })).rejects.toThrow(REFUSED)
    await expect(devon.mutation(api.medications.update, { medicationId: id, ...order })).rejects.toThrow(REFUSED)
    await expect(devon.mutation(api.medications.discontinue, { medicationId: id, reason: 'x' })).rejects.toThrow(REFUSED)
    await expect(
      devon.mutation(api.medications.administer, {
        medicationId: id, date: DATE, scheduledMinutes: 18 * 60, outcome: 'given', now: at(18), tzOffsetMinutes: TZ,
      }),
    ).rejects.toThrow(REFUSED)
    await expect(devon.mutation(api.medications.voidEntry, { administrationId: entry, reason: 'x' })).rejects.toThrow(REFUSED)
  })
})
