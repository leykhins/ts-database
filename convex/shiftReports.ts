import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { logKind, shiftLog } from './schema'
import {
  SHIFTS,
  dutiesFor,
  photoUrlsFor,
  effectiveRole,
  requireCapability,
  requireStaff,
  resolveBuilding,
  shiftAt,
} from './model'

/**
 * Shift reports — the handover, in two phases.
 *
 * Phase one runs all shift: log entries are written as things happen, into a draft
 * that is created the first time the worker opens the form. Phase two is
 * finalizing: the whole-shift questions (wellness checks, the checklist, the
 * handover notes) only appear once, at the end, because asking them mid-shift
 * produces answers that are wrong by the time the shift ends.
 *
 * Reporter, site, date and shift period are derived from who is signed in and
 * what time it is. None of them are typed, so none of them can be wrong.
 */

/**
 * Two logs, one row shape.
 *
 * The **interaction log** is what happened with a resident. The **event log**
 * is what happened to the building — a fire alarm, a flood, police attending.
 * Keeping them apart matters at handover: "three interactions" and "a fire
 * panel fault" are different kinds of shift, and a building event that had to
 * be filed against a resident would put somebody's name on a burst pipe.
 */
export const LOG_KIND = {
  // Interaction log
  welfare: { log: 'interaction', label: 'Welfare concern' },
  medical: { log: 'interaction', label: 'Medical / overdose' },
  behavioural: { log: 'interaction', label: 'Behavioural / conflict' },
  'harm-reduction': { log: 'interaction', label: 'Harm reduction' },
  property: { log: 'interaction', label: 'Property / maintenance' },
  other: { log: 'interaction', label: 'Other' },
  // Event log
  fire: { log: 'event', label: 'Fire alarm / fire' },
  flood: { log: 'event', label: 'Flood / water' },
  power: { log: 'event', label: 'Power / heat outage' },
  elevator: { log: 'event', label: 'Elevator failure' },
  police: { log: 'event', label: 'Police attendance' },
  ambulance: { log: 'event', label: 'Ambulance / EHS attendance' },
  evacuation: { log: 'event', label: 'Evacuation' },
  violence: { log: 'event', label: 'Violence / threat on site' },
  contractor: { log: 'event', label: 'Contractor / vendor on site' },
  security: { log: 'event', label: 'Security / break-in' },
} as const

type LogKind = keyof typeof LOG_KIND

/** Entries written before the two logs were split are interactions. */
function logOf(kind: LogKind, stored: 'interaction' | 'event' | undefined) {
  return stored ?? LOG_KIND[kind]?.log ?? 'interaction'
}

/** The worker's draft for the current shift, with everything the form needs. */
export const current = query({
  args: {
    buildingId: v.optional(v.id('buildings')),
    now: v.number(),
    tzOffsetMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx)
    const building = await resolveBuilding(ctx, args.buildingId)
    if (!building) return null

    const { key, shiftDate } = shiftAt(args.now, args.tzOffsetMinutes)
    const segment = SHIFTS.find((s) => s.key === key)!
    const role = effectiveRole(staff)

    const draft = await ctx.db
      .query('shiftReports')
      .withIndex('by_author_status', (q) => q.eq('authorId', staff._id).eq('status', 'draft'))
      .first()

    const entries = draft
      ? await ctx.db
          .query('shiftLogEntries')
          .withIndex('by_report', (q) => q.eq('reportId', draft._id))
          .collect()
      : []

    // The residents an incident can be filed against, and how many rooms the
    // shift is expected to have checked.
    const [tenants, rooms, checks] = await Promise.all([
      ctx.db
        .query('tenants')
        .withIndex('by_building_status', (q) =>
          q.eq('buildingId', building._id).eq('status', 'current'),
        )
        .collect(),
      ctx.db
        .query('rooms')
        .withIndex('by_building_sort', (q) => q.eq('buildingId', building._id))
        .collect(),
      ctx.db
        .query('wellnessChecks')
        .withIndex('by_building_shift', (q) =>
          q.eq('buildingId', building._id).eq('shiftDate', shiftDate).eq('shiftKey', key),
        )
        .collect(),
    ])

    const roomById = new Map(rooms.map((r) => [r._id as string, r]))
    const seen = new Set(checks.filter((c) => c.outcome === 'seen').map((c) => c.tenantId as string))
    const recorded = new Map(checks.map((c) => [c.tenantId as string, c.outcome]))

    const photos = await photoUrlsFor(ctx, tenants)
    const tenantById = new Map(tenants.map((t) => [t._id as string, t]))
    const roomOf = (t: (typeof tenants)[number]) =>
      t.roomId ? (roomById.get(t.roomId)?.number ?? '—') : '—'

    // Residents named on each entry, resolved in one pass.
    const participants = await Promise.all(
      entries.map((e) =>
        ctx.db
          .query('shiftLogParticipants')
          .withIndex('by_entry', (q) => q.eq('entryId', e._id))
          .collect(),
      ),
    )

    const residents = tenants
      .map((t) => ({
        _id: t._id,
        name: t.name,
        room: t.roomId ? (roomById.get(t.roomId)?.number ?? '—') : '—',
        photoUrl: photos.get(t._id) ?? null,
        checked: seen.has(t._id),
        outcome: recorded.get(t._id) ?? null,
      }))
      .sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }))

    const duties = dutiesFor(role)

    return {
      building: { _id: building._id, name: building.name },
      context: {
        author: staff.name ?? staff.username ?? 'Staff',
        role,
        shiftKey: key,
        shiftDate,
        shiftLabel: segment.label,
        shiftHours: segment.hours,
      },
      report: draft
        ? {
            _id: draft._id,
            status: draft.status,
            summary: draft.summary ?? '',
            importantInfo: draft.importantInfo ?? '',
            extraTasks: draft.extraTasks ?? '',
            radioCheck: draft.radioCheck ?? false,
            handover: draft.handover ?? false,
            readPrevious: draft.readPrevious ?? false,
            duties: draft.duties ?? {},
            startedAt: draft.startedAt,
            // A draft opened on an earlier shift is still the worker's draft —
            // the form says so rather than silently filing it under today.
            staleShift: draft.shiftDate !== shiftDate || draft.shiftKey !== key,
            shiftDate: draft.shiftDate,
            shiftKey: draft.shiftKey,
          }
        : null,
      entries: entries
        .map((entry, index) => ({ entry, named: participants[index] ?? [] }))
        .sort((a, b) => a.entry.occurredAt - b.entry.occurredAt)
        .map(({ entry: i, named }) => ({
          _id: i._id,
          log: logOf(i.kind, i.log),
          residents: named
            .map((p) => tenantById.get(p.tenantId))
            .filter(Boolean)
            .map((t) => ({
              tenantId: t!._id,
              name: t!.name,
              room: roomOf(t!),
              photoUrl: photos.get(t!._id) ?? null,
            })),
          location: i.location,
          occurredAt: i.occurredAt,
          kind: i.kind,
          kindLabel: LOG_KIND[i.kind]?.label ?? i.kind,
          comments: i.comments,
          significant: i.significant,
          cameraReview: i.cameraReview,
          emergencyServices: i.emergencyServices ?? false,
          evacuated: i.evacuated ?? false,
        })),
      residents,
      duties: duties.items,
      dutyTitle: duties.title,
      checks: {
        completed: seen.size,
        total: residents.length,
        missed: residents.filter((r) => !r.checked),
      },
    }
  },
})

/** Recent handovers for the building, newest first. */
export const list = query({
  args: { buildingId: v.optional(v.id('buildings')) },
  handler: async (ctx, args) => {
    await requireStaff(ctx)
    const building = await resolveBuilding(ctx, args.buildingId)
    if (!building) return null

    const reports = await ctx.db
      .query('shiftReports')
      .withIndex('by_building_started', (q) => q.eq('buildingId', building._id))
      .order('desc')
      .take(30)

    const submitted = reports.filter((r) => r.status === 'submitted')
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
      reports: submitted.map((r, i) => {
        const rows = entriesByReport[i] ?? []
        return {
          _id: r._id,
          shiftKey: r.shiftKey,
          shiftDate: r.shiftDate,
          label: SHIFTS.find((s) => s.key === r.shiftKey)!.label,
          hours: SHIFTS.find((s) => s.key === r.shiftKey)!.hours,
          author: authors[i]?.name ?? 'Former staff',
          authorRole: r.authorRole,
          summary: r.summary ?? '',
          importantInfo: r.importantInfo ?? '',
          submittedAt: r.submittedAt ?? r.startedAt,
          interactions: rows.filter((x) => logOf(x.kind, x.log) === 'interaction').length,
          events: rows.filter((x) => logOf(x.kind, x.log) === 'event').length,
          entries: rows.length,
          significant: rows.filter((x) => x.significant).length,
          cameraReview: rows.some((x) => x.cameraReview),
          radioCheck: r.radioCheck ?? false,
          handover: r.handover ?? false,
          readPrevious: r.readPrevious ?? false,
          dutiesDone: Object.values(r.duties ?? {}).filter(Boolean).length,
          dutiesTotal: Object.keys(r.duties ?? {}).length,
        }
      }),
    }
  },
})

/** One submitted report in full, with its log entries. */
export const get = query({
  args: { reportId: v.id('shiftReports') },
  handler: async (ctx, { reportId }) => {
    await requireStaff(ctx)

    const report = await ctx.db.get(reportId)
    if (!report) return null

    const [author, building, entries] = await Promise.all([
      ctx.db.get(report.authorId),
      ctx.db.get(report.buildingId),
      ctx.db
        .query('shiftLogEntries')
        .withIndex('by_report', (q) => q.eq('reportId', reportId))
        .collect(),
    ])

    const participants = await Promise.all(
      entries.map((e) =>
        ctx.db
          .query('shiftLogParticipants')
          .withIndex('by_entry', (q) => q.eq('entryId', e._id))
          .collect(),
      ),
    )
    const tenantIds = [...new Set(participants.flat().map((p) => p.tenantId))]
    const tenants = await Promise.all(tenantIds.map((id) => ctx.db.get(id)))
    const nameById = new Map(tenants.filter(Boolean).map((t) => [t!._id as string, t!.name]))

    const segment = SHIFTS.find((s) => s.key === report.shiftKey)!

    return {
      _id: report._id,
      status: report.status,
      shiftDate: report.shiftDate,
      shiftKey: report.shiftKey,
      label: segment.label,
      hours: segment.hours,
      building: building?.name ?? '—',
      author: author?.name ?? 'Former staff',
      authorRole: report.authorRole,
      submittedAt: report.submittedAt ?? report.startedAt,
      summary: report.summary ?? '',
      importantInfo: report.importantInfo ?? '',
      extraTasks: report.extraTasks ?? '',
      radioCheck: report.radioCheck ?? false,
      handover: report.handover ?? false,
      readPrevious: report.readPrevious ?? false,
      duties: report.duties ?? {},
      entries: entries
        .map((entry, index) => ({ entry, named: participants[index] ?? [] }))
        .sort((a, b) => a.entry.occurredAt - b.entry.occurredAt)
        .map(({ entry: i, named }) => ({
          _id: i._id,
          log: logOf(i.kind, i.log),
          residents: named.map((p) => nameById.get(p.tenantId) ?? 'Former resident'),
          location: i.location,
          occurredAt: i.occurredAt,
          kindLabel: LOG_KIND[i.kind]?.label ?? i.kind,
          comments: i.comments,
          significant: i.significant,
          cameraReview: i.cameraReview,
          emergencyServices: i.emergencyServices ?? false,
          evacuated: i.evacuated ?? false,
        })),
    }
  },
})

/**
 * Open (or reuse) the worker's draft for this shift. Idempotent: a worker has
 * at most one draft, so opening the form twice does not create two reports.
 */
export const start = mutation({
  args: {
    buildingId: v.id('buildings'),
    now: v.number(),
    tzOffsetMinutes: v.number(),
  },
  handler: async (ctx, args): Promise<Id<'shiftReports'>> => {
    const staff = await requireCapability(ctx, 'wellness')

    const existing = await ctx.db
      .query('shiftReports')
      .withIndex('by_author_status', (q) => q.eq('authorId', staff._id).eq('status', 'draft'))
      .first()
    if (existing) return existing._id

    const { key, shiftDate } = shiftAt(args.now, args.tzOffsetMinutes)

    return await ctx.db.insert('shiftReports', {
      buildingId: args.buildingId,
      shiftDate,
      shiftKey: key,
      authorId: staff._id,
      authorRole: effectiveRole(staff),
      status: 'draft',
      startedAt: args.now,
    })
  },
})

export const addEntry = mutation({
  args: {
    reportId: v.id('shiftReports'),
    log: shiftLog,
    tenantIds: v.optional(v.array(v.id('tenants'))),
    location: v.string(),
    occurredAt: v.number(),
    kind: logKind,
    comments: v.string(),
    significant: v.boolean(),
    cameraReview: v.boolean(),
    emergencyServices: v.optional(v.boolean()),
    evacuated: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'wellness')

    const report = await ctx.db.get(args.reportId)
    if (!report) throw new Error('That shift report no longer exists.')
    if (report.status === 'submitted') throw new Error('That report has already been submitted.')
    if (report.authorId !== staff._id) throw new Error('That is not your shift report.')

    if (!args.comments.trim()) {
      throw new Error('Describe what happened and what was done about it.')
    }
    if (!args.location.trim()) throw new Error('Say where it happened.')

    // A kind belongs to one log or the other; filing a fire alarm as an
    // interaction would put a resident's name on a building fault.
    const expected = LOG_KIND[args.kind]?.log
    if (expected && expected !== args.log) {
      throw new Error(`"${LOG_KIND[args.kind]!.label}" belongs in the ${expected} log.`)
    }

    const entryId = await ctx.db.insert('shiftLogEntries', {
      reportId: args.reportId,
      buildingId: report.buildingId,
      log: args.log,
      location: args.location.trim(),
      occurredAt: args.occurredAt,
      kind: args.kind,
      comments: args.comments.trim(),
      significant: args.significant,
      cameraReview: args.cameraReview,
      ...(args.log === 'event'
        ? {
            emergencyServices: args.emergencyServices ?? false,
            evacuated: args.evacuated ?? false,
          }
        : {}),
      loggedBy: staff._id,
    })

    // De-duplicated: naming the same resident twice on one entry would double
    // it on their record.
    for (const tenantId of [...new Set(args.tenantIds ?? [])]) {
      const tenant = await ctx.db.get(tenantId)
      if (!tenant || tenant.buildingId !== report.buildingId) {
        throw new Error('That resident is not in this building.')
      }
      await ctx.db.insert('shiftLogParticipants', {
        entryId,
        tenantId,
        buildingId: report.buildingId,
        occurredAt: args.occurredAt,
      })
    }

    return entryId
  },
})

/** Replace the residents an entry names. */
export const setEntryResidents = mutation({
  args: { entryId: v.id('shiftLogEntries'), tenantIds: v.array(v.id('tenants')) },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'wellness')

    const entry = await ctx.db.get(args.entryId)
    if (!entry) throw new Error('That log entry is no longer on file.')
    const report = await ctx.db.get(entry.reportId)
    if (!report) throw new Error('That shift report no longer exists.')
    if (report.status === 'submitted') {
      throw new Error('That report has been submitted — its entries can no longer be edited.')
    }
    if (report.authorId !== staff._id) throw new Error('That is not your shift report.')

    const existing = await ctx.db
      .query('shiftLogParticipants')
      .withIndex('by_entry', (q) => q.eq('entryId', args.entryId))
      .collect()
    for (const row of existing) await ctx.db.delete(row._id)

    for (const tenantId of [...new Set(args.tenantIds)]) {
      await ctx.db.insert('shiftLogParticipants', {
        entryId: args.entryId,
        tenantId,
        buildingId: entry.buildingId,
        occurredAt: entry.occurredAt,
      })
    }
    return null
  },
})

export const updateEntry = mutation({
  args: {
    entryId: v.id('shiftLogEntries'),
    location: v.optional(v.string()),
    kind: v.optional(logKind),
    comments: v.optional(v.string()),
    significant: v.optional(v.boolean()),
    cameraReview: v.optional(v.boolean()),
    emergencyServices: v.optional(v.boolean()),
    evacuated: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'wellness')

    const entry = await ctx.db.get(args.entryId)
    if (!entry) throw new Error('That log entry is no longer on file.')
    const report = await ctx.db.get(entry.reportId)
    if (!report) throw new Error('That shift report no longer exists.')
    if (report.status === 'submitted') {
      throw new Error('That report has been submitted — its entries can no longer be edited.')
    }
    if (report.authorId !== staff._id) throw new Error('That is not your shift report.')

    const patch: Record<string, unknown> = {}
    if (args.location !== undefined) {
      if (!args.location.trim()) throw new Error('Say where it happened.')
      patch.location = args.location.trim()
    }
    if (args.kind !== undefined) patch.kind = args.kind
    if (args.comments !== undefined) {
      if (!args.comments.trim()) throw new Error('Describe what happened.')
      patch.comments = args.comments.trim()
    }
    if (args.significant !== undefined) patch.significant = args.significant
    if (args.cameraReview !== undefined) patch.cameraReview = args.cameraReview
    if (args.emergencyServices !== undefined) patch.emergencyServices = args.emergencyServices
    if (args.evacuated !== undefined) patch.evacuated = args.evacuated

    await ctx.db.patch(args.entryId, patch)
    return null
  },
})

export const removeEntry = mutation({
  args: { entryId: v.id('shiftLogEntries') },
  handler: async (ctx, { entryId }) => {
    const staff = await requireCapability(ctx, 'wellness')

    const entry = await ctx.db.get(entryId)
    if (!entry) return null
    const report = await ctx.db.get(entry.reportId)
    if (report?.status === 'submitted') {
      throw new Error('That report has been submitted — its entries are part of the record.')
    }
    if (report && report.authorId !== staff._id) throw new Error('That is not your shift report.')

    const participants = await ctx.db
      .query('shiftLogParticipants')
      .withIndex('by_entry', (q) => q.eq('entryId', entryId))
      .collect()
    for (const row of participants) await ctx.db.delete(row._id)

    await ctx.db.delete(entryId)
    return null
  },
})

/** Save the whole-shift answers without submitting. */
export const saveDraft = mutation({
  args: {
    reportId: v.id('shiftReports'),
    summary: v.optional(v.string()),
    importantInfo: v.optional(v.string()),
    extraTasks: v.optional(v.string()),
    radioCheck: v.optional(v.boolean()),
    handover: v.optional(v.boolean()),
    readPrevious: v.optional(v.boolean()),
    duties: v.optional(v.record(v.string(), v.boolean())),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'wellness')

    const report = await ctx.db.get(args.reportId)
    if (!report) throw new Error('That shift report no longer exists.')
    if (report.status === 'submitted') throw new Error('That report has already been submitted.')
    if (report.authorId !== staff._id) throw new Error('That is not your shift report.')

    const { reportId, ...rest } = args
    await ctx.db.patch(reportId, rest)
    return null
  },
})

/**
 * Submit. The three confirmations and the summary are required — they are the
 * things the next shift actually reads, and a report filed without them is a
 * report nobody can hand over from.
 */
export const submit = mutation({
  args: {
    reportId: v.id('shiftReports'),
    summary: v.string(),
    importantInfo: v.optional(v.string()),
    extraTasks: v.optional(v.string()),
    radioCheck: v.boolean(),
    handover: v.boolean(),
    readPrevious: v.boolean(),
    duties: v.optional(v.record(v.string(), v.boolean())),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'wellness')

    const report = await ctx.db.get(args.reportId)
    if (!report) throw new Error('That shift report no longer exists.')
    if (report.status === 'submitted') throw new Error('That report has already been submitted.')
    if (report.authorId !== staff._id) throw new Error('That is not your shift report.')

    if (!args.summary.trim()) throw new Error('Write a short summary of how the shift went.')
    if (!args.radioCheck || !args.handover || !args.readPrevious) {
      throw new Error(
        'Confirm the radio check, the handover, and that you read the previous reports.',
      )
    }

    const entries = await ctx.db
      .query('shiftLogEntries')
      .withIndex('by_report', (q) => q.eq('reportId', args.reportId))
      .collect()
    const incomplete = entries.find((i) => !i.comments.trim() || !i.location.trim())
    if (incomplete) throw new Error('Finish every log entry before submitting.')

    await ctx.db.patch(args.reportId, {
      status: 'submitted',
      summary: args.summary.trim(),
      importantInfo: args.importantInfo?.trim() || undefined,
      extraTasks: args.extraTasks?.trim() || undefined,
      radioCheck: args.radioCheck,
      handover: args.handover,
      readPrevious: args.readPrevious,
      duties: args.duties ?? report.duties,
      submittedAt: args.now,
    })

    return {
      interactions: entries.filter((i) => logOf(i.kind, i.log) === 'interaction').length,
      events: entries.filter((i) => logOf(i.kind, i.log) === 'event').length,
      significant: entries.filter((i) => i.significant).length,
    }
  },
})
