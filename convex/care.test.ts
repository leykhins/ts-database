/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { shiftAt } from './model'

/**
 * The Care Console's rules: which shift a moment belongs to, what counts as a
 * completed check, when a resident falls off the round, and what a shift report
 * refuses to be submitted without.
 */

const modules = import.meta.glob('./**/*.ts')

/** 2026-06-15, in UTC, at the given hour. */
const at = (hour: number, minute = 0) => Date.UTC(2026, 5, 15, hour, minute)

async function setup(residents = 4) {
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
          supportLevel: i === 0 ? 'critical' : 'moderate',
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
    const bookkeeper = await ctx.db.insert('users', {
      name: 'Sam Ledger',
      email: 'sam@housing.org',
      role: 'front-desk',
    })

    return { buildingId, tenantIds, worker, bookkeeper }
  })

  const as = (userId: Id<'users'>) => t.withIdentity({ subject: `${userId}|session` })
  return { t, as, ...ids }
}

describe('shift derivation', () => {
  test('a moment lands in exactly one segment', () => {
    expect(shiftAt(at(2), 0).key).toBe('overnight')
    expect(shiftAt(at(9), 0).key).toBe('morning')
    expect(shiftAt(at(18), 0).key).toBe('evening')
    expect(shiftAt(at(0), 0).key).toBe('overnight')
    expect(shiftAt(at(23, 59), 0).key).toBe('evening')
  })

  test('the shift date follows local time, not UTC', () => {
    // 01:00 UTC on the 15th is 18:00 on the 14th in UTC-7 — an evening shift
    // belonging to the previous day, which is what the report must file under.
    const local = shiftAt(at(1), 420)
    expect(local).toMatchObject({ key: 'evening', shiftDate: '2026-06-14' })
  })
})

describe('wellness checks', () => {
  test('a check is filed under the shift it was made in', async () => {
    const { t, as, worker, tenantIds } = await setup()

    await as(worker).mutation(api.care.logCheck, {
      tenantId: tenantIds[0]!,
      outcome: 'seen',
      now: at(2, 30),
      tzOffsetMinutes: 0,
    })

    const rows = await t.run((ctx) => ctx.db.query('wellnessChecks').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ shiftKey: 'overnight', shiftDate: '2026-06-15', outcome: 'seen' })
  })

  test('only "seen" counts as done — a refusal is recorded, not counted', async () => {
    const { as, worker, tenantIds, buildingId } = await setup(2)

    await as(worker).mutation(api.care.logCheck, {
      tenantId: tenantIds[0]!,
      outcome: 'seen',
      now: at(18),
      tzOffsetMinutes: 0,
    })
    await as(worker).mutation(api.care.logCheck, {
      tenantId: tenantIds[1]!,
      outcome: 'refused',
      note: 'No contact at the door',
      now: at(18, 5),
      tzOffsetMinutes: 0,
    })

    const board = await as(worker).query(api.care.overview, {
      buildingId,
      now: at(19),
      tzOffsetMinutes: 0,
    })

    expect(board!.live).toMatchObject({ done: 1, total: 2 })
    const refused = board!.board
      .find((s) => s.state === 'current')!
      .checks.find((c) => c.tenantId === tenantIds[1])
    expect(refused).toMatchObject({ status: 'missed', outcome: 'refused' })
  })

  test('the queue puts the overdue critical resident first', async () => {
    const { as, worker, tenantIds, buildingId, t } = await setup(3)

    // Resident 1 is the critical one; give the other two a check this shift.
    await t.run(async (ctx) => {
      await ctx.db.insert('criticalNeeds', {
        tenantId: tenantIds[0]!,
        buildingId,
        summary: 'Diabetic — monitor intake',
        openedAt: at(1),
      })
    })
    await as(worker).mutation(api.care.logCheck, {
      tenantId: tenantIds[1]!,
      outcome: 'seen',
      now: at(17),
      tzOffsetMinutes: 0,
    })

    const board = await as(worker).query(api.care.overview, {
      buildingId,
      now: at(19),
      tzOffsetMinutes: 0,
    })

    expect(board!.queue[0]!.tenantId).toBe(tenantIds[0])
    expect(board!.wellnessIndex.criticalUnseen).toHaveLength(1)
  })

  test('a resident unseen across two segments is flagged', async () => {
    const { as, worker, tenantIds, buildingId } = await setup(2)

    // Everyone seen overnight and in the morning except resident 2.
    for (const hour of [2, 9]) {
      await as(worker).mutation(api.care.logCheck, {
        tenantId: tenantIds[0]!,
        outcome: 'seen',
        now: at(hour),
        tzOffsetMinutes: 0,
      })
    }

    const board = await as(worker).query(api.care.overview, {
      buildingId,
      now: at(18),
      tzOffsetMinutes: 0,
    })

    const flagged = board!.flagged.map((f) => f.tenantId)
    expect(flagged).toContain(tenantIds[1])
    expect(flagged).not.toContain(tenantIds[0])
  })

  test('a check on an ended tenancy is refused', async () => {
    const { as, worker, tenantIds, t } = await setup(1)

    await t.run((ctx) => ctx.db.patch(tenantIds[0]!, { status: 'prior' }))

    await expect(
      as(worker).mutation(api.care.logCheck, {
        tenantId: tenantIds[0]!,
        outcome: 'seen',
        now: at(18),
        tzOffsetMinutes: 0,
      }),
    ).rejects.toThrow(/not current/)
  })
})

describe('shift reports', () => {
  test('opening the form twice reuses the same draft', async () => {
    const { as, worker, buildingId } = await setup(1)
    const staff = as(worker)

    const first = await staff.mutation(api.shiftReports.start, {
      buildingId,
      now: at(18),
      tzOffsetMinutes: 0,
    })
    const second = await staff.mutation(api.shiftReports.start, {
      buildingId,
      now: at(19),
      tzOffsetMinutes: 0,
    })

    expect(second).toBe(first)
  })

  test('submitting needs a summary and all three confirmations', async () => {
    const { as, worker, buildingId } = await setup(1)
    const staff = as(worker)

    const reportId = await staff.mutation(api.shiftReports.start, {
      buildingId,
      now: at(18),
      tzOffsetMinutes: 0,
    })

    await expect(
      staff.mutation(api.shiftReports.submit, {
        reportId,
        summary: '',
        radioCheck: true,
        handover: true,
        readPrevious: true,
        now: at(23),
      }),
    ).rejects.toThrow(/summary/)

    await expect(
      staff.mutation(api.shiftReports.submit, {
        reportId,
        summary: 'Quiet shift.',
        radioCheck: true,
        handover: false,
        readPrevious: true,
        now: at(23),
      }),
    ).rejects.toThrow(/handover/)

    await staff.mutation(api.shiftReports.submit, {
      reportId,
      summary: 'Quiet shift.',
      radioCheck: true,
      handover: true,
      readPrevious: true,
      now: at(23),
    })
  })

  test('log entries belong to the author, and lock once submitted', async () => {
    const { as, worker, bookkeeper, buildingId, tenantIds } = await setup(1)
    const staff = as(worker)

    const reportId = await staff.mutation(api.shiftReports.start, {
      buildingId,
      now: at(18),
      tzOffsetMinutes: 0,
    })
    const entryId = await staff.mutation(api.shiftReports.addEntry, {
      reportId,
      log: 'interaction',
      tenantIds: [tenantIds[0]!],
      location: 'Lobby / amenity',
      occurredAt: at(21, 40),
      kind: 'medical',
      comments: 'Narcan administered, EHS attended, resident stable.',
      significant: true,
      cameraReview: true,
    })

    // Somebody else's shift report is not yours to write into.
    await expect(
      as(bookkeeper).mutation(api.shiftReports.addEntry, {
        reportId,
        log: 'interaction',
        location: 'Hallway',
        occurredAt: at(22),
        kind: 'other',
        comments: 'Not my report.',
        significant: false,
        cameraReview: false,
      }),
    ).rejects.toThrow(/not your shift report/)

    await staff.mutation(api.shiftReports.submit, {
      reportId,
      summary: 'One significant incident.',
      radioCheck: true,
      handover: true,
      readPrevious: true,
      now: at(23),
    })

    await expect(
      staff.mutation(api.shiftReports.updateEntry, {
        entryId,
        comments: 'Rewriting history.',
      }),
    ).rejects.toThrow(/submitted/)
  })

  test('a building event is filed without a resident', async () => {
    const { as, worker, buildingId } = await setup(1)
    const staff = as(worker)

    const reportId = await staff.mutation(api.shiftReports.start, {
      buildingId,
      now: at(2),
      tzOffsetMinutes: 0,
    })
    await staff.mutation(api.shiftReports.addEntry, {
      reportId,
      log: 'event',
      location: 'Whole building',
      occurredAt: at(2, 10),
      kind: 'fire',
      comments: 'Fire panel activated on the second floor. Cause: burnt food. Reset with the alarm company.',
      significant: false,
      cameraReview: false,
      emergencyServices: true,
      evacuated: true,
    })

    const form = await staff.query(api.shiftReports.current, {
      buildingId,
      now: at(3),
      tzOffsetMinutes: 0,
    })
    const events = form!.entries.filter((e) => e.log === 'event')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      residents: [],
      kindLabel: 'Fire alarm / fire',
      emergencyServices: true,
      evacuated: true,
    })

    const result = await staff.mutation(api.shiftReports.submit, {
      reportId,
      summary: 'Fire panel fault overnight.',
      radioCheck: true,
      handover: true,
      readPrevious: true,
      now: at(7),
    })
    expect(result).toMatchObject({ interactions: 0, events: 1 })
  })

  test('an entry can name several residents, and reaches each record', async () => {
    const { as, worker, buildingId, tenantIds } = await setup(3)
    const staff = as(worker)

    const reportId = await staff.mutation(api.shiftReports.start, {
      buildingId,
      now: at(18),
      tzOffsetMinutes: 0,
    })
    await staff.mutation(api.shiftReports.addEntry, {
      reportId,
      log: 'interaction',
      // A dispute has two sides; both belong on the record.
      tenantIds: [tenantIds[0]!, tenantIds[1]!, tenantIds[0]!],
      location: 'Hallway',
      occurredAt: at(19),
      kind: 'behavioural',
      comments: 'Argument in the second-floor hallway, both de-escalated and separated.',
      significant: false,
      cameraReview: false,
    })

    const form = await staff.query(api.shiftReports.current, {
      buildingId,
      now: at(19),
      tzOffsetMinutes: 0,
    })
    // The duplicate is collapsed rather than double-counted.
    expect(form!.entries[0]!.residents.map((r) => r.tenantId).sort()).toEqual(
      [tenantIds[0]!, tenantIds[1]!].sort(),
    )

    await staff.mutation(api.shiftReports.submit, {
      reportId,
      summary: 'One argument, both parties settled.',
      radioCheck: true,
      handover: true,
      readPrevious: true,
      now: at(23),
    })

    // It shows on both residents' records, and on nobody else's.
    for (const tenantId of [tenantIds[0]!, tenantIds[1]!]) {
      const notes = await staff.query(api.profile.shiftNotes, { tenantId })
      expect(notes.filter((n) => n.kind === 'interaction')).toHaveLength(1)
    }
    expect(
      (await staff.query(api.profile.shiftNotes, { tenantId: tenantIds[2]! })).filter(
        (n) => n.kind === 'interaction',
      ),
    ).toHaveLength(0)
  })

  test('removing an entry takes its residents with it', async () => {
    const { as, worker, buildingId, tenantIds, t } = await setup(2)
    const staff = as(worker)

    const reportId = await staff.mutation(api.shiftReports.start, {
      buildingId,
      now: at(18),
      tzOffsetMinutes: 0,
    })
    const entryId = await staff.mutation(api.shiftReports.addEntry, {
      reportId,
      log: 'interaction',
      tenantIds: [tenantIds[0]!, tenantIds[1]!],
      location: 'Hallway',
      occurredAt: at(19),
      kind: 'welfare',
      comments: 'Logged in error.',
      significant: false,
      cameraReview: false,
    })

    await staff.mutation(api.shiftReports.removeEntry, { entryId })

    const orphans = await t.run((ctx) => ctx.db.query('shiftLogParticipants').collect())
    expect(orphans).toHaveLength(0)
  })

  test('a kind cannot be filed in the wrong log', async () => {
    const { as, worker, buildingId, tenantIds } = await setup(1)
    const staff = as(worker)

    const reportId = await staff.mutation(api.shiftReports.start, {
      buildingId,
      now: at(18),
      tzOffsetMinutes: 0,
    })

    // A fire alarm is not something a resident did.
    await expect(
      staff.mutation(api.shiftReports.addEntry, {
        reportId,
        log: 'interaction',
        tenantIds: [tenantIds[0]!],
        location: 'Hallway',
        occurredAt: at(19),
        kind: 'fire',
        comments: 'Filed in the wrong log.',
        significant: false,
        cameraReview: false,
      }),
    ).rejects.toThrow(/belongs in the event log/)
  })

  test('an incident with no description is refused', async () => {
    const { as, worker, buildingId } = await setup(1)
    const staff = as(worker)

    const reportId = await staff.mutation(api.shiftReports.start, {
      buildingId,
      now: at(18),
      tzOffsetMinutes: 0,
    })

    await expect(
      staff.mutation(api.shiftReports.addEntry, {
        reportId,
        log: 'interaction',
        location: 'Hallway',
        occurredAt: at(20),
        kind: 'other',
        comments: '   ',
        significant: false,
        cameraReview: false,
      }),
    ).rejects.toThrow(/Describe what happened/)
  })
})
