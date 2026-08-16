import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { checkOutcome } from './schema'
import {
  SHIFTS,
  dutiesFor,
  effectiveRole,
  requireCapability,
  photoUrlsFor,
  requireStaff,
  resolveBuilding,
  shiftAt,
} from './model'

/**
 * The Care Console — the shift home for Resident Support Workers, Wellness
 * Workers and Home Support Workers.
 *
 * Where the operations dashboard answers "how is this building doing", this
 * answers "who have I not laid eyes on yet, and what do I do next". Everything
 * is scoped to a shift: three segments a day, a wellness check per resident
 * per segment, and a report at the end of it.
 *
 * `now` and `tzOffsetMinutes` come from the client — a query is not re-run
 * because the clock moved, so the clock is an input.
 */

/** Weight per support level: a critical resident unseen is not the same miss. */
const LEVEL_WEIGHT = { independent: 1, moderate: 2, high: 3, critical: 4 } as const

/** How many consecutive shift segments without a check makes a resident flagged. */
const FLAG_AFTER_SEGMENTS = 2

/** Segments to look back over when deciding who has fallen off the round. */
const LOOKBACK_SEGMENTS = 4

type Occupant = {
  tenant: Doc<'tenants'>
  room: Doc<'rooms'> | undefined
}

/** The `LOOKBACK_SEGMENTS` segments ending with the live one, newest first. */
function recentSegments(now: number, tz: number) {
  const current = shiftAt(now, tz)
  const index = SHIFTS.findIndex((s) => s.key === current.key)
  const out: { key: string; shiftDate: string; label: string; hours: string; icon: string }[] = []

  for (let back = 0; back < LOOKBACK_SEGMENTS; back++) {
    let i = index - back
    let dayShift = 0
    while (i < 0) {
      i += SHIFTS.length
      dayShift += 1
    }
    const segment = SHIFTS[i]!
    const date = new Date(`${current.shiftDate}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() - dayShift)
    out.push({
      key: segment.key,
      shiftDate: date.toISOString().slice(0, 10),
      label: segment.label,
      hours: segment.hours,
      icon: segment.icon,
    })
  }
  return out
}

export const overview = query({
  args: {
    buildingId: v.optional(v.id('buildings')),
    now: v.number(),
    tzOffsetMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx)
    const building = await resolveBuilding(ctx, args.buildingId)
    if (!building) return null

    const buildingId = building._id
    const current = shiftAt(args.now, args.tzOffsetMinutes)
    const segments = recentSegments(args.now, args.tzOffsetMinutes)

    const [tenants, rooms, needs] = await Promise.all([
      ctx.db
        .query('tenants')
        .withIndex('by_building_status', (q) =>
          q.eq('buildingId', buildingId).eq('status', 'current'),
        )
        .collect(),
      ctx.db
        .query('rooms')
        .withIndex('by_building_sort', (q) => q.eq('buildingId', buildingId))
        .collect(),
      ctx.db
        .query('criticalNeeds')
        .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
        .collect(),
    ])

    const roomById = new Map(rooms.map((r) => [r._id as string, r]))
    const openNeedIds = new Set(
      needs.filter((n) => n.resolvedAt === undefined).map((n) => n.tenantId as string),
    )
    const photos = await photoUrlsFor(ctx, tenants)

    const occupants: Occupant[] = tenants
      .map((tenant) => ({ tenant, room: tenant.roomId ? roomById.get(tenant.roomId) : undefined }))
      .sort((a, b) =>
        (a.room?.number ?? '~').localeCompare(b.room?.number ?? '~', undefined, { numeric: true }),
      )

    /** Latest check per tenant within a segment — a re-check supersedes. */
    const byTenant = (checks: Doc<'wellnessChecks'>[]) => {
      const map = new Map<string, Doc<'wellnessChecks'>>()
      for (const check of checks) {
        const existing = map.get(check.tenantId)
        if (!existing || check.completedAt > existing.completedAt) map.set(check.tenantId, check)
      }
      return map
    }

    const readSegment = async (shiftDate: string, key: string) =>
      byTenant(
        await ctx.db
          .query('wellnessChecks')
          .withIndex('by_building_shift', (q) =>
            q
              .eq('buildingId', buildingId)
              .eq('shiftDate', shiftDate)
              .eq('shiftKey', key as 'morning'),
          )
          .collect(),
      )

    // The lookback drives the flagged list: the live segment and the ones
    // before it, however far back that reaches into yesterday.
    const segmentMaps = await Promise.all(
      segments.map((segment) => readSegment(segment.shiftDate, segment.key)),
    )

    /**
     * The board is always *today's* three segments in the order they happen —
     * overnight, morning, evening. A segment that has not started yet is
     * "upcoming", not a column of 42 misses: nobody has failed to do a check
     * that was never due.
     */
    const currentIndex = SHIFTS.findIndex((s) => s.key === current.key)
    const boardSegments = await Promise.all(
      SHIFTS.map(async (segment, i) => {
        const map =
          i === currentIndex
            ? segmentMaps[0]!
            : await readSegment(current.shiftDate, segment.key)

        const state = i === currentIndex ? 'current' : i < currentIndex ? 'complete' : 'upcoming'

        const checks = occupants.map(({ tenant, room }) => {
          const check = map.get(tenant._id)
          const status = check
            ? check.outcome === 'seen'
              ? 'done'
              : 'missed'
            : state === 'complete'
              ? 'missed'
              : 'pending'
          return {
            tenantId: tenant._id,
            name: tenant.name,
            room: room?.number ?? '—',
            photoUrl: photos.get(tenant._id) ?? null,
            supportLevel: tenant.supportLevel,
            critical: openNeedIds.has(tenant._id),
            status,
            outcome: check?.outcome ?? null,
            completedAt: check?.completedAt ?? null,
            note: check?.note ?? null,
          }
        })

        const done = checks.filter((c) => c.status === 'done').length
        return {
          key: segment.key,
          shiftDate: current.shiftDate,
          label: segment.label,
          hours: segment.hours,
          icon: segment.icon,
          state,
          checks,
          done,
          total: checks.length,
          missed: checks.filter((c) => c.status === 'missed').length,
          pending: checks.length - done,
        }
      }),
    )

    const live = boardSegments[currentIndex]!

    // ---- Flagged: nobody has laid eyes on them for several segments ----
    const flagged = occupants
      .map(({ tenant, room }) => {
        let segmentsMissed = 0
        let lastSeenAt: number | null = null
        let lastOutcome: string | null = null

        for (const map of segmentMaps) {
          const check = map.get(tenant._id)
          if (check?.outcome === 'seen') {
            lastSeenAt = check.completedAt
            break
          }
          if (check && lastOutcome === null) lastOutcome = check.outcome
          segmentsMissed++
        }

        return {
          tenantId: tenant._id,
          name: tenant.name,
          room: room?.number ?? '—',
          photoUrl: photos.get(tenant._id) ?? null,
          supportLevel: tenant.supportLevel,
          critical: openNeedIds.has(tenant._id),
          segmentsMissed,
          lastSeenAt,
          reason:
            lastOutcome === 'refused'
              ? 'Refused entry'
              : lastOutcome === 'absent'
                ? 'Out of building at check time'
                : lastOutcome === 'declined'
                  ? 'Declined wellness check'
                  : lastOutcome === 'no-answer'
                    ? 'No answer at the door'
                    : 'No check recorded',
        }
      })
      .filter((r) => r.segmentsMissed >= FLAG_AFTER_SEGMENTS)
      .sort((a, b) => b.segmentsMissed - a.segmentsMissed || Number(b.critical) - Number(a.critical))

    // ---- Wellness Index: are residents being seen inside their window? ----
    const seenNow = new Set(
      live.checks.filter((c) => c.status === 'done').map((c) => c.tenantId as string),
    )
    const previousMap = segmentMaps[1]
    const seenPrev = new Set(
      [...(previousMap?.values() ?? [])]
        .filter((check) => check.outcome === 'seen')
        .map((check) => check.tenantId as string),
    )

    let points = 0
    for (const { tenant } of occupants) {
      const critical = openNeedIds.has(tenant._id)
      if (seenNow.has(tenant._id)) points += 1
      else if (critical) points += 0 // a critical resident unseen is a full miss
      else if (seenPrev.has(tenant._id)) points += 0.7
      else points += 0.3
    }
    const score = occupants.length ? Math.round((points / occupants.length) * 100) : 100
    const criticalUnseen = occupants
      .filter(({ tenant }) => openNeedIds.has(tenant._id) && !seenNow.has(tenant._id))
      .map(({ tenant, room }) => ({ tenantId: tenant._id, name: tenant.name, room: room?.number ?? '—' }))

    // ---- Do this next: the live shift's outstanding checks, worst first ----
    const flaggedByTenant = new Map(flagged.map((f) => [f.tenantId as string, f]))
    const queue = live.checks
      .filter((c) => c.status !== 'done')
      .map((c) => {
        const flag = flaggedByTenant.get(c.tenantId)
        const weight =
          (c.status === 'missed' ? 10 : 0)
          + (c.critical ? 8 : 0)
          + (flag ? flag.segmentsMissed * 2 : 0)
          + LEVEL_WEIGHT[c.supportLevel]
        return {
          ...c,
          overdue: c.status === 'missed',
          reason: flag ? flag.reason : 'Wellness check due this shift',
          segmentsMissed: flag?.segmentsMissed ?? 0,
          weight,
        }
      })
      .sort((a, b) => b.weight - a.weight)

    // ---- This worker's shift ----
    const role = effectiveRole(staff)
    const duties = dutiesFor(role)
    const report = await ctx.db
      .query('shiftReports')
      .withIndex('by_author_status', (q) => q.eq('authorId', staff._id).eq('status', 'draft'))
      .first()

    const draftEntries = report
      ? await ctx.db
          .query('shiftLogEntries')
          .withIndex('by_report', (q) => q.eq('reportId', report._id))
          .collect()
      : []

    // ---- Recent handovers ----
    const recentReports = await ctx.db
      .query('shiftReports')
      .withIndex('by_building_started', (q) => q.eq('buildingId', buildingId))
      .order('desc')
      .take(12)

    const submitted = recentReports.filter((r) => r.status === 'submitted').slice(0, 3)
    const authors = await Promise.all(submitted.map((r) => ctx.db.get(r.authorId)))
    const entriesByReport = await Promise.all(
      submitted.map((r) =>
        ctx.db
          .query('shiftLogEntries')
          .withIndex('by_report', (q) => q.eq('reportId', r._id))
          .collect(),
      ),
    )

    return {
      building: { _id: building._id, name: building.name },
      current: { ...current, label: SHIFTS.find((s) => s.key === current.key)!.label },
      board: boardSegments,
      live: {
        key: live.key,
        shiftDate: live.shiftDate,
        done: live.done,
        total: live.total,
        pending: live.pending,
        overdue: live.checks.filter((c) => c.status === 'missed').length,
      },
      wellnessIndex: {
        score,
        band: score >= 80 ? 'Good' : score >= 65 ? 'Fair' : 'Needs attention',
        criticalUnseen,
        seen: seenNow.size,
        total: occupants.length,
      },
      queue,
      flagged,
      critical: occupants
        .filter(({ tenant }) => openNeedIds.has(tenant._id))
        .map(({ tenant, room }) => ({
          tenantId: tenant._id,
          name: tenant.name,
          room: room?.number ?? '—',
          photoUrl: photos.get(tenant._id) ?? null,
          supportLevel: tenant.supportLevel,
          note: needs.find((n) => n.tenantId === tenant._id && n.resolvedAt === undefined)?.summary
            ?? 'Open case on file',
        })),
      me: {
        role,
        duties: duties.items,
        dutyTitle: duties.title,
        dutyIcon: duties.icon,
        dutyAccent: duties.accent,
        dutyState: report?.duties ?? {},
        reportId: report?._id ?? null,
        entryCount: draftEntries.length,
        significantCount: draftEntries.filter((e) => e.significant).length,
      },
      reports: submitted.map((r, i) => ({
        _id: r._id,
        shiftKey: r.shiftKey,
        shiftDate: r.shiftDate,
        label: SHIFTS.find((s) => s.key === r.shiftKey)!.label,
        hours: SHIFTS.find((s) => s.key === r.shiftKey)!.hours,
        author: authors[i]?.name ?? 'Former staff',
        authorRole: r.authorRole,
        summary: r.summary ?? '',
        submittedAt: r.submittedAt ?? r.startedAt,
        interactions: (entriesByReport[i] ?? []).filter(
          (x) => (x.log ?? 'interaction') === 'interaction',
        ).length,
        events: (entriesByReport[i] ?? []).filter((x) => x.log === 'event').length,
        significant: (entriesByReport[i] ?? []).some((x) => x.significant),
        cameraReview: (entriesByReport[i] ?? []).some((x) => x.cameraReview),
        radioCheck: r.radioCheck ?? false,
        handover: r.handover ?? false,
        readPrevious: r.readPrevious ?? false,
      })),
    }
  },
})

/**
 * Record a wellness check. The shift it belongs to is derived from the clock,
 * never chosen — a check logged at 2 am belongs to the overnight shift whether
 * or not the worker thinks of it as "today".
 */
export const logCheck = mutation({
  args: {
    tenantId: v.id('tenants'),
    outcome: checkOutcome,
    note: v.optional(v.string()),
    now: v.number(),
    tzOffsetMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'wellness')

    const tenant = await ctx.db.get(args.tenantId)
    if (!tenant) throw new Error('That resident no longer exists.')
    if (tenant.status !== 'current') {
      throw new Error('That tenancy is not current — there is nobody to check on.')
    }

    const { key, shiftDate } = shiftAt(args.now, args.tzOffsetMinutes)

    return await ctx.db.insert('wellnessChecks', {
      buildingId: tenant.buildingId,
      tenantId: tenant._id,
      roomId: tenant.roomId,
      shiftDate,
      shiftKey: key,
      outcome: args.outcome,
      note: args.note?.trim() || undefined,
      completedAt: args.now,
      completedBy: staff._id,
    })
  },
})

/** One resident's check history — shown on the resident record. */
export const historyFor = query({
  args: { tenantId: v.id('tenants') },
  handler: async (ctx, { tenantId }) => {
    await requireStaff(ctx)

    const checks = await ctx.db
      .query('wellnessChecks')
      .withIndex('by_tenant_completed', (q) => q.eq('tenantId', tenantId))
      .order('desc')
      .take(30)

    const staffIds = [...new Set(checks.map((c) => c.completedBy).filter(Boolean))]
    const people = await Promise.all(staffIds.map((id) => ctx.db.get(id as Id<'users'>)))
    const nameById = new Map(people.filter(Boolean).map((p) => [p!._id as string, p!.name]))

    return checks.map((c) => ({
      _id: c._id,
      outcome: c.outcome,
      note: c.note ?? null,
      completedAt: c.completedAt,
      shiftKey: c.shiftKey,
      shiftDate: c.shiftDate,
      by: c.completedBy ? (nameById.get(c.completedBy) ?? null) : null,
    }))
  },
})

/** Toggle one duty on the current draft report. */
export const setDuty = mutation({
  args: { reportId: v.id('shiftReports'), duty: v.string(), done: v.boolean() },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'wellness')

    const report = await ctx.db.get(args.reportId)
    if (!report) throw new Error('That shift report no longer exists.')
    if (report.authorId !== staff._id) throw new Error('That is not your shift report.')
    if (report.status === 'submitted') throw new Error('That report has already been submitted.')

    await ctx.db.patch(args.reportId, {
      duties: { ...(report.duties ?? {}), [args.duty]: args.done },
    })
    return null
  },
})
