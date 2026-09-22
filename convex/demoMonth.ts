import { v } from 'convex/values'
import type { Doc, Id } from './_generated/dataModel'
import { internalMutation, internalQuery } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { dutiesFor, localDate, SHIFTS } from './model'
import type { Role } from './model'
import { atLocal } from './routines'

const TEST_USERS = [
  'test.admin',
  'test.manager',
  'test.coordinator',
  'test.rsw',
  'test.wellness',
  'test.support',
  'test.hca',
] as const

const MEDICATION_USERS = new Set([
  'test.admin',
  'test.manager',
  'test.coordinator',
  'test.rsw',
  'test.support',
  'test.hca',
])

type DbCtx = QueryCtx | MutationCtx

async function currentDemoUsers(ctx: DbCtx): Promise<Doc<'users'>[]> {
  const users = await Promise.all(
    TEST_USERS.map((username) =>
      ctx.db
        .query('users')
        .withIndex('by_username', (q) => q.eq('username', username))
        .unique(),
    ),
  )
  const missing = TEST_USERS.filter((_, i) => users[i] === null)
  if (missing.length) {
    throw new Error(`Create the current demo accounts first: ${missing.join(', ')}`)
  }
  return users as Doc<'users'>[]
}

function assertDate(date: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])-([012]\d|3[01])$/.test(date)) {
    throw new Error('date must be YYYY-MM-DD')
  }
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('date must be a real calendar date')
  }
}

function dayNumber(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00Z`).valueOf() / 86_400_000)
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

const SUMMARIES = [
  'Wellness rounds completed. Resident requests were followed up and the next shift received a verbal handover.',
  'A steady shift with scheduled care, medication support and common-area checks completed.',
  'Several residents needed extra support with appointments and daily living. Outstanding items are noted for follow-up.',
  'Routine building operations completed. One resident interaction required additional documentation and monitoring.',
] as const

const IMPORTANT = [
  'Please follow up on the open maintenance request in Room 118 and continue contact attempts.',
  'Morning staff should review the MAR exceptions and appointment list before rounds.',
  'Continue hydration prompts and mobility support for residents with active care plans.',
  'No urgent handover items. Review flagged wellness checks at the start of shift.',
] as const

async function seedReports(
  ctx: MutationCtx,
  date: string,
  through: number,
  tz: number,
  staff: Doc<'users'>[],
): Promise<{ reports: number; entries: number }> {
  const building = await ctx.db
    .query('buildings')
    .withIndex('by_slug', (q) => q.eq('slug', 'cedar-house'))
    .unique()
  if (!building) throw new Error('Seed the fictional buildings before the month history.')

  const tenants = await ctx.db
    .query('tenants')
    .withIndex('by_building_status', (q) =>
      q.eq('buildingId', building._id).eq('status', 'current'),
    )
    .take(12)
  const ordinal = dayNumber(date)
  let reports = 0
  let entries = 0

  for (const [shiftIndex, shift] of SHIFTS.entries()) {
    const shiftEnd = atLocal(date, shift.to * 60, tz)
    if (shiftEnd > through) continue

    const author = staff[(ordinal * SHIFTS.length + shiftIndex) % staff.length]!
    const existing = await ctx.db
      .query('shiftReports')
      .withIndex('by_building_shift', (q) =>
        q.eq('buildingId', building._id).eq('shiftDate', date).eq('shiftKey', shift.key),
      )
      .collect()
    if (existing.some((report) => report.authorId === author._id)) continue

    const role = (author.role ?? 'rsw') as Role
    const dutyItems = dutiesFor(role).items
    const duties = Object.fromEntries(
      dutyItems.map((duty, i) => [duty.key, (ordinal + shiftIndex + i) % 6 !== 0]),
    )
    const startedAt = atLocal(date, shift.from * 60 + 7, tz)
    const submittedAt = shiftEnd - 8 * 60_000
    const reportId = await ctx.db.insert('shiftReports', {
      buildingId: building._id,
      shiftDate: date,
      shiftKey: shift.key,
      authorId: author._id,
      authorRole: role,
      status: 'submitted',
      summary: SUMMARIES[(ordinal + shiftIndex) % SUMMARIES.length],
      importantInfo: IMPORTANT[(ordinal + shiftIndex * 2) % IMPORTANT.length],
      extraTasks: shiftIndex === 1 ? 'Supported a resident with an appointment reminder.' : undefined,
      radioCheck: true,
      handover: true,
      readPrevious: true,
      duties,
      startedAt,
      submittedAt,
    })
    reports++

    const tenant = tenants[(ordinal + shiftIndex) % tenants.length]
    const interactionAt = startedAt + (2 + ((ordinal + shiftIndex) % 4)) * 60 * 60_000
    const interactionId = await ctx.db.insert('shiftLogEntries', {
      reportId,
      buildingId: building._id,
      log: 'interaction',
      location: tenant ? `Room ${tenant.roomId ? 'resident room' : 'front desk'}` : 'Front desk',
      occurredAt: interactionAt,
      kind: (ordinal + shiftIndex) % 5 === 0 ? 'medical' : 'welfare',
      comments:
        (ordinal + shiftIndex) % 5 === 0
          ? 'Resident reported feeling unwell. Vitals and presentation were observed, the coordinator was notified, and follow-up was arranged.'
          : 'Resident checked in with staff, discussed current needs, and accepted the planned support.',
      significant: (ordinal + shiftIndex) % 5 === 0,
      cameraReview: (ordinal + shiftIndex) % 11 === 0,
      loggedBy: author._id,
    })
    entries++
    if (tenant) {
      await ctx.db.insert('shiftLogParticipants', {
        entryId: interactionId,
        tenantId: tenant._id,
        buildingId: building._id,
        occurredAt: interactionAt,
      })
    }

    if ((ordinal + shiftIndex) % 3 === 0) {
      await ctx.db.insert('shiftLogEntries', {
        reportId,
        buildingId: building._id,
        log: 'event',
        location: 'Lobby / amenity',
        occurredAt: startedAt + 5 * 60 * 60_000,
        kind: (ordinal + shiftIndex) % 2 === 0 ? 'contractor' : 'security',
        comments:
          (ordinal + shiftIndex) % 2 === 0
            ? 'Contractor attended, signed in, and completed the scheduled building service.'
            : 'Staff responded to a noise concern in the lobby and restored a calm environment.',
        significant: false,
        cameraReview: (ordinal + shiftIndex) % 6 === 0,
        emergencyServices: false,
        evacuated: false,
        loggedBy: author._id,
      })
      entries++
    }
  }

  return { reports, entries }
}

async function seedMar(
  ctx: MutationCtx,
  date: string,
  through: number,
  tz: number,
  staff: Doc<'users'>[],
): Promise<{ administrations: number; corrections: number }> {
  const medications = await ctx.db.query('medications').collect()
  const medicationStaff = staff.filter((user) => MEDICATION_USERS.has(user.username ?? ''))
  const today = localDate(through, tz)
  const ordinal = dayNumber(date)
  let administrations = 0
  let corrections = 0

  for (const [medIndex, medication] of medications.entries()) {
    if (medication.startDate > date || (medication.endDate && medication.endDate < date)) continue
    const existing = await ctx.db
      .query('medicationAdministrations')
      .withIndex('by_medication_date', (q) =>
        q.eq('medicationId', medication._id).eq('date', date),
      )
      .collect()

    if (medication.prn) {
      if (
        ordinal % 5 === medIndex % 5 &&
        !existing.some((entry) => entry.scheduledMinutes === undefined && entry.voidedAt === undefined)
      ) {
        const recordedBy = medicationStaff[(ordinal + medIndex) % medicationStaff.length]!
        const givenAt = atLocal(date, 13 * 60 + (medIndex % 4) * 15, tz)
        if (givenAt <= through) {
          await ctx.db.insert('medicationAdministrations', {
            medicationId: medication._id,
            tenantId: medication.tenantId,
            buildingId: medication.buildingId,
            date,
            outcome: 'given',
            reason: medication.prnIndication ?? 'Resident requested as-needed medication',
            note: 'Effect reviewed after administration; resident reported improvement.',
            givenAt,
            recordedAt: givenAt + 4 * 60_000,
            recordedBy: recordedBy._id,
          })
          administrations++
        }
      }
      continue
    }

    for (const [slotIndex, minutes] of medication.times.entries()) {
      if (existing.some((entry) => entry.scheduledMinutes === minutes && entry.voidedAt === undefined)) {
        continue
      }
      const scheduledAt = atLocal(date, minutes, tz)
      if (scheduledAt + 60 * 60_000 > through) continue

      const code = ordinal + medIndex * 7 + slotIndex * 13
      // A few real gaps make the past-day "Not charted" state visible.
      if (date < today && code % 41 === 0) continue
      // Keep one due slot open today so the live board has work to show.
      if (date === today && code % 17 === 0) continue

      const recordedBy = medicationStaff[code % medicationStaff.length]!
      const late = code % 19 === 0
      const givenAt = scheduledAt + (late ? 92 : (code % 21) - 7) * 60_000
      const outcome =
        code % 37 === 0
          ? ('not-given' as const)
          : code % 29 === 0
            ? ('absent' as const)
            : code % 23 === 0
              ? ('held' as const)
              : code % 17 === 0
                ? ('refused' as const)
                : ('given' as const)
      const reason =
        outcome === 'refused'
          ? 'Resident declined after the dose was offered.'
          : outcome === 'held'
            ? 'Held because the resident was too drowsy; coordinator notified.'
            : outcome === 'absent'
              ? 'Resident was away from the building during the medication window.'
              : outcome === 'not-given'
                ? 'Dose unavailable; pharmacy follow-up documented for the next shift.'
                : undefined

      if (date.endsWith('-08') && medIndex === 0 && slotIndex === 0 && existing.length === 0) {
        await ctx.db.insert('medicationAdministrations', {
          medicationId: medication._id,
          tenantId: medication.tenantId,
          buildingId: medication.buildingId,
          date,
          scheduledMinutes: minutes,
          outcome: 'given',
          note: 'Original entry retained as part of the correction history.',
          givenAt,
          recordedAt: givenAt + 2 * 60_000,
          recordedBy: recordedBy._id,
          voidedAt: givenAt + 12 * 60_000,
          voidedBy: medicationStaff[(code + 1) % medicationStaff.length]!._id,
          voidReason: 'Wrong outcome selected; corrected immediately below.',
        })
        corrections++
      }

      await ctx.db.insert('medicationAdministrations', {
        medicationId: medication._id,
        tenantId: medication.tenantId,
        buildingId: medication.buildingId,
        date,
        scheduledMinutes: minutes,
        outcome,
        ...(reason ? { reason } : {}),
        givenAt,
        recordedAt: givenAt + (code % 13 === 0 ? 68 : 3) * 60_000,
        recordedBy: recordedBy._id,
      })
      administrations++
    }
  }

  return { administrations, corrections }
}

/** Seed one bounded calendar day. Safe to repeat. */
export const seedDay = internalMutation({
  args: {
    date: v.string(),
    through: v.number(),
    tzOffsetMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertDate(args.date)
    const tz = args.tzOffsetMinutes ?? 0
    const staff = await currentDemoUsers(ctx)
    const reports = await seedReports(ctx, args.date, args.through, tz, staff)
    const mar = await seedMar(ctx, args.date, args.through, tz, staff)
    return { date: args.date, ...reports, ...mar }
  },
})

/** Keep reports and MAR moving after the initial month has been seeded. */
export async function continueDemoDay(
  ctx: MutationCtx,
  now: number,
  tz: number,
): Promise<{ reports: number; entries: number; administrations: number; corrections: number }> {
  const staff = await currentDemoUsers(ctx)
  const today = localDate(now, tz)
  const yesterday = addDays(today, -1)
  const previousReports = await seedReports(ctx, yesterday, now, tz, staff)
  const reports = await seedReports(ctx, today, now, tz, staff)
  const mar = await seedMar(ctx, today, now, tz, staff)
  return {
    reports: previousReports.reports + reports.reports,
    entries: previousReports.entries + reports.entries,
    ...mar,
  }
}

/** Read-only proof that all attributed demo data belongs to current fixtures. */
export const verify = internalQuery({
  args: { month: v.string() },
  handler: async (ctx, args) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month)) throw new Error('month must be YYYY-MM')
    const users = await currentDemoUsers(ctx)
    const allowed = new Set(users.map((user) => user._id as string))
    const reports = await ctx.db.query('shiftReports').take(500)
    const administrations = await ctx.db.query('medicationAdministrations').take(10_000)
    const [allUsers, medications, entries, wellness, routines] = await Promise.all([
      ctx.db.query('users').take(50),
      ctx.db.query('medications').take(500),
      ctx.db.query('shiftLogEntries').take(1_000),
      ctx.db.query('wellnessChecks').take(5_000),
      ctx.db.query('routineCompletions').take(2_000),
    ])
    const monthReports = reports.filter((report) => report.shiftDate.startsWith(args.month))
    const monthAdministrations = administrations.filter((entry) => entry.date.startsWith(args.month))
    const attributedIds = new Set<string>()
    for (const report of monthReports) attributedIds.add(report.authorId)
    for (const entry of monthAdministrations) {
      if (entry.recordedBy) attributedIds.add(entry.recordedBy)
      if (entry.voidedBy) attributedIds.add(entry.voidedBy)
    }
    for (const medication of medications) {
      if (medication.createdBy) attributedIds.add(medication.createdBy)
      if (medication.discontinuedBy) attributedIds.add(medication.discontinuedBy)
    }
    for (const entry of entries) if (entry.loggedBy) attributedIds.add(entry.loggedBy)
    for (const check of wellness) if (check.completedBy) attributedIds.add(check.completedBy)
    for (const completion of routines) {
      if (completion.completedBy) attributedIds.add(completion.completedBy)
    }
    return {
      users: users.map((user) => user.username ?? ''),
      unexpectedUsers: allUsers
        .map((user) => user.username ?? '')
        .filter((username) => !TEST_USERS.includes(username as (typeof TEST_USERS)[number])),
      reports: monthReports.length,
      reportAuthors: new Set(monthReports.map((report) => report.authorId as string)).size,
      administrations: monthAdministrations.length,
      outcomes: {
        given: monthAdministrations.filter((entry) => entry.outcome === 'given').length,
        refused: monthAdministrations.filter((entry) => entry.outcome === 'refused').length,
        held: monthAdministrations.filter((entry) => entry.outcome === 'held').length,
        absent: monthAdministrations.filter((entry) => entry.outcome === 'absent').length,
        notGiven: monthAdministrations.filter((entry) => entry.outcome === 'not-given').length,
        voided: monthAdministrations.filter((entry) => entry.voidedAt !== undefined).length,
      },
      staleAttributions: [...attributedIds].filter((id) => !allowed.has(id)).length,
    }
  },
})
