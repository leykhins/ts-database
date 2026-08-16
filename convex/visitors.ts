import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import {
  localDate,
  photoUrlsFor,
  requireCapability,
  requireStaff,
  resolveBuilding,
} from './model'

/**
 * Visitors — who is in the building, who they came for, and who is not
 * allowed in.
 *
 * Three rules shape this file:
 *
 *  1. **A visitor is registered once.** Name, date of birth or ID, a photo.
 *     Every later visit is who they are here to see and the time. Asking a
 *     returning guest for their date of birth every Saturday is how a sign-in
 *     book stops being filled in.
 *  2. **A ban is answered at the door, not afterwards.** It lives on the
 *     visitor, the sign-in refuses, and the reason is given — so the worker on
 *     the desk does not have to know the history.
 *  3. **An overnight stay is a manager's decision.** Staff on shift log what
 *     happened; they do not grant permission. An unauthorised overnight is
 *     recorded as such rather than blocked, because at 11pm the guest is
 *     already there and the honest record is worth more than a locked form.
 */

const DAY = 86_400_000

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Weekday number for a local calendar date, 0 = Sunday. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay()
}

/** Is a visitor banned right now? A ban with a date runs out on its own. */
export function banState(visitor: Doc<'visitors'>, today: string) {
  if (!visitor.bannedAt) return { banned: false as const }
  if (visitor.bannedUntil && visitor.bannedUntil < today) return { banned: false as const }
  return {
    banned: true as const,
    reason: visitor.bannedReason ?? 'No reason recorded',
    until: visitor.bannedUntil ?? null,
  }
}

/** Live authorizations for a building, with the expired and revoked dropped. */
async function activeAuthorizations(
  ctx: QueryCtx | MutationCtx,
  buildingId: Id<'buildings'>,
  today: string,
) {
  const rows = await ctx.db
    .query('overnightAuthorizations')
    .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
    .collect()

  return rows.filter(
    (row) =>
      !row.revokedAt
      && (!row.fromDate || row.fromDate <= today)
      && (!row.toDate || row.toDate >= today),
  )
}

/** Does this guest have permission to stay with this resident, on this day? */
export function authorizedFor(
  authorizations: Doc<'overnightAuthorizations'>[],
  visitorId: Id<'visitors'>,
  tenantId: Id<'tenants'>,
  date: string,
): boolean {
  const weekday = weekdayOf(date)
  return authorizations.some(
    (row) =>
      row.visitorId === visitorId
      && row.tenantId === tenantId
      && (row.days.length === 0 || row.days.includes(weekday)),
  )
}

/* ------------------------------------------------------------------------
   The desk
   ------------------------------------------------------------------------ */

export const board = query({
  args: {
    buildingId: v.optional(v.id('buildings')),
    now: v.number(),
    tzOffsetMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    await requireStaff(ctx)
    const building = await resolveBuilding(ctx, args.buildingId)
    if (!building) return null

    const today = localDate(args.now, args.tzOffsetMinutes)
    const buildingId = building._id

    const [visitorRows, tenants, rooms, authorizations] = await Promise.all([
      ctx.db
        .query('visitors')
        .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
        .collect(),
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
      activeAuthorizations(ctx, buildingId, today),
    ])

    const roomById = new Map(rooms.map((r) => [r._id as string, r]))
    const tenantPhotos = await photoUrlsFor(ctx, tenants)
    const tenantById = new Map(tenants.map((t) => [t._id as string, t]))

    const residents = tenants
      .map((t) => ({
        tenantId: t._id,
        name: t.name,
        room: t.roomId ? (roomById.get(t.roomId)?.number ?? '—') : '—',
        photoUrl: tenantPhotos.get(t._id) ?? null,
        /** Anyone approved to stay with them, for the badge on their name. */
        overnightGuests: authorizations
          .filter((a) => a.tenantId === t._id)
          .map((a) => visitorRows.find((x) => x._id === a.visitorId)?.name)
          .filter(Boolean) as string[],
      }))
      .sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }))

    const visitorPhotos = await Promise.all(
      visitorRows.map(async (visitor) =>
        visitor.photoId ? await ctx.storage.getUrl(visitor.photoId) : null,
      ),
    )

    // Visits in the last month: enough for "who do they usually come for"
    // without reading the building's whole history.
    const recent = await ctx.db
      .query('visits')
      .withIndex('by_building_in', (q) =>
        q.eq('buildingId', buildingId).gte('signedInAt', args.now - 30 * DAY),
      )
      .collect()

    const visitors = visitorRows.map((visitor, i) => {
      const ban = banState(visitor, today)
      const theirs = recent.filter((visit) => visit.visitorId === visitor._id)
      const counts = new Map<string, number>()
      for (const visit of theirs) {
        counts.set(visit.tenantId, (counts.get(visit.tenantId) ?? 0) + 1)
      }
      const usual = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]

      return {
        _id: visitor._id,
        name: visitor.name,
        dob: visitor.dob ?? null,
        idNumber: visitor.idNumber ?? null,
        photoUrl: visitorPhotos[i] ?? null,
        note: visitor.note ?? null,
        banned: ban.banned,
        bannedReason: ban.banned ? ban.reason : null,
        bannedUntil: ban.banned ? ban.until : null,
        visitsThisMonth: theirs.length,
        usuallyVisits: usual ? (tenantById.get(usual[0])?.name ?? null) : null,
        overnightWith: authorizations
          .filter((a) => a.visitorId === visitor._id)
          .map((a) => ({
            tenantId: a.tenantId,
            name: tenantById.get(a.tenantId)?.name ?? 'Former resident',
            days: a.days,
          })),
      }
    })

    const onSite = await ctx.db
      .query('visits')
      .withIndex('by_building_in', (q) => q.eq('buildingId', buildingId))
      .order('desc')
      .take(120)

    const visitRow = (visit: Doc<'visits'>) => {
      const index = visitorRows.findIndex((x) => x._id === visit.visitorId)
      const visitor = visitorRows[index]
      const tenant = tenantById.get(visit.tenantId)
      return {
        _id: visit._id,
        visitorId: visit.visitorId,
        visitorName: visitor?.name ?? 'Former visitor',
        visitorPhotoUrl: visitorPhotos[index] ?? null,
        banned: visitor ? banState(visitor, today).banned : false,
        tenantId: visit.tenantId,
        residentName: tenant?.name ?? 'Former resident',
        room: tenant?.roomId ? (roomById.get(tenant.roomId)?.number ?? '—') : '—',
        signedInAt: visit.signedInAt,
        signedOutAt: visit.signedOutAt ?? null,
        overnight: visit.overnight,
        authorized: visit.authorized ?? true,
      }
    }

    return {
      building: { _id: building._id, name: building.name },
      today,
      weekday: WEEKDAYS[weekdayOf(today)]!,
      residents,
      visitors,
      inside: onSite.filter((visit) => !visit.signedOutAt).map(visitRow),
      history: onSite.filter((visit) => visit.signedOutAt).slice(0, 25).map(visitRow),
      banned: visitors.filter((visitor) => visitor.banned),
      /** Approved to stay tonight — the card the desk checks at handover. */
      overnightTonight: authorizations
        .filter((a) => a.days.length === 0 || a.days.includes(weekdayOf(today)))
        .map((a) => {
          const index = visitorRows.findIndex((x) => x._id === a.visitorId)
          return {
            _id: a._id,
            visitorId: a.visitorId,
            visitorName: visitorRows[index]?.name ?? 'Former visitor',
            visitorPhotoUrl: visitorPhotos[index] ?? null,
            tenantId: a.tenantId,
            residentName: tenantById.get(a.tenantId)?.name ?? 'Former resident',
            days: a.days,
            note: a.note ?? null,
          }
        }),
      authorizations: authorizations.map((a) => {
        const index = visitorRows.findIndex((x) => x._id === a.visitorId)
        return {
          _id: a._id,
          visitorId: a.visitorId,
          visitorName: visitorRows[index]?.name ?? 'Former visitor',
          visitorPhotoUrl: visitorPhotos[index] ?? null,
          tenantId: a.tenantId,
          residentName: tenantById.get(a.tenantId)?.name ?? 'Former resident',
          days: a.days,
          fromDate: a.fromDate ?? null,
          toDate: a.toDate ?? null,
          note: a.note ?? null,
        }
      }),
    }
  },
})

/** Every visit a guest has made, newest first — who they actually come for. */
export const visitorHistory = query({
  args: { visitorId: v.id('visitors') },
  handler: async (ctx, { visitorId }) => {
    await requireStaff(ctx)

    const visits = await ctx.db
      .query('visits')
      .withIndex('by_visitor_in', (q) => q.eq('visitorId', visitorId))
      .order('desc')
      .take(50)

    const tenantIds = [...new Set(visits.map((visit) => visit.tenantId))]
    const tenants = await Promise.all(tenantIds.map((id) => ctx.db.get(id)))
    const nameById = new Map(tenants.filter(Boolean).map((t) => [t!._id as string, t!.name]))

    return visits.map((visit) => ({
      _id: visit._id,
      residentName: nameById.get(visit.tenantId) ?? 'Former resident',
      tenantId: visit.tenantId,
      signedInAt: visit.signedInAt,
      signedOutAt: visit.signedOutAt ?? null,
      overnight: visit.overnight,
      authorized: visit.authorized ?? true,
    }))
  },
})

export const register = mutation({
  args: {
    buildingId: v.id('buildings'),
    name: v.string(),
    dob: v.optional(v.string()),
    idNumber: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, 'wellness')

    const name = args.name.trim()
    if (!name) throw new Error('Enter the visitor’s name.')
    if (!args.dob?.trim() && !args.idNumber?.trim()) {
      throw new Error('Record a date of birth or an ID — one of the two identifies them again.')
    }
    if (args.dob && !/^\d{4}-\d{2}-\d{2}$/.test(args.dob)) {
      throw new Error('Date of birth must be a calendar date.')
    }

    return await ctx.db.insert('visitors', {
      buildingId: args.buildingId,
      name,
      dob: args.dob?.trim() || undefined,
      idNumber: args.idNumber?.trim() || undefined,
      note: args.note?.trim() || undefined,
    })
  },
})

export const generatePhotoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, 'wellness')
    return await ctx.storage.generateUploadUrl()
  },
})

export const setPhoto = mutation({
  args: { visitorId: v.id('visitors'), storageId: v.id('_storage') },
  handler: async (ctx, args) => {
    await requireCapability(ctx, 'wellness')

    const visitor = await ctx.db.get(args.visitorId)
    if (!visitor) throw new Error('That visitor is no longer on file.')
    if (visitor.photoId) await ctx.storage.delete(visitor.photoId)

    await ctx.db.patch(args.visitorId, { photoId: args.storageId })
    return null
  },
})

/**
 * Sign a guest in.
 *
 * A banned guest is refused with the reason, so nobody has to remember the
 * history. An overnight stay without a manager's authorization goes through
 * but is recorded as unauthorised — at 11pm the guest is already in the
 * building, and an honest record beats a form that will be worked around.
 */
export const signIn = mutation({
  args: {
    visitorId: v.id('visitors'),
    tenantId: v.id('tenants'),
    overnight: v.boolean(),
    note: v.optional(v.string()),
    now: v.number(),
    tzOffsetMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'wellness')

    const [visitor, tenant] = await Promise.all([
      ctx.db.get(args.visitorId),
      ctx.db.get(args.tenantId),
    ])
    if (!visitor) throw new Error('That visitor is no longer on file.')
    if (!tenant) throw new Error('That resident no longer exists.')
    if (tenant.status !== 'current') {
      throw new Error(`${tenant.name} is not a current resident.`)
    }

    const today = localDate(args.now, args.tzOffsetMinutes)

    const ban = banState(visitor, today)
    if (ban.banned) {
      throw new Error(
        `${visitor.name} is banned from this site: ${ban.reason}.` +
          (ban.until ? ` The ban runs until ${ban.until}.` : ''),
      )
    }

    const open = await ctx.db
      .query('visits')
      .withIndex('by_visitor_in', (q) => q.eq('visitorId', args.visitorId))
      .order('desc')
      .take(5)
    if (open.some((visit) => !visit.signedOutAt)) {
      throw new Error(`${visitor.name} is already signed in.`)
    }

    const authorizations = await activeAuthorizations(ctx, visitor.buildingId, today)
    const authorized = args.overnight
      ? authorizedFor(authorizations, args.visitorId, args.tenantId, today)
      : true

    const visitId = await ctx.db.insert('visits', {
      visitorId: args.visitorId,
      buildingId: visitor.buildingId,
      tenantId: args.tenantId,
      signedInAt: args.now,
      signedInBy: staff._id,
      overnight: args.overnight,
      authorized,
      note: args.note?.trim() || undefined,
    })

    return { visitId, authorized }
  },
})

export const signOut = mutation({
  args: { visitId: v.id('visits'), now: v.number() },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'wellness')

    const visit = await ctx.db.get(args.visitId)
    if (!visit) throw new Error('That visit is no longer on file.')
    if (visit.signedOutAt) throw new Error('That visitor has already been signed out.')

    await ctx.db.patch(args.visitId, { signedOutAt: args.now, signedOutBy: staff._id })
    return null
  },
})

/* ------------------------------------------------------------------------
   Manager decisions: bans and overnight authorizations
   ------------------------------------------------------------------------ */

export const setBan = mutation({
  args: {
    visitorId: v.id('visitors'),
    banned: v.boolean(),
    reason: v.optional(v.string()),
    until: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'site-config')

    const visitor = await ctx.db.get(args.visitorId)
    if (!visitor) throw new Error('That visitor is no longer on file.')

    if (!args.banned) {
      await ctx.db.patch(args.visitorId, {
        bannedAt: undefined,
        bannedBy: undefined,
        bannedReason: undefined,
        bannedUntil: undefined,
      })
      return null
    }

    if (!args.reason?.trim()) {
      throw new Error('Record why they are banned — the desk has to be able to say.')
    }
    if (args.until && !/^\d{4}-\d{2}-\d{2}$/.test(args.until)) {
      throw new Error('An end date must be a calendar date.')
    }

    await ctx.db.patch(args.visitorId, {
      bannedAt: args.now,
      bannedBy: staff._id,
      bannedReason: args.reason.trim(),
      bannedUntil: args.until?.trim() || undefined,
    })
    return null
  },
})

export const authorizeOvernight = mutation({
  args: {
    visitorId: v.id('visitors'),
    tenantId: v.id('tenants'),
    days: v.array(v.number()),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
    note: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'site-config')

    const [visitor, tenant] = await Promise.all([
      ctx.db.get(args.visitorId),
      ctx.db.get(args.tenantId),
    ])
    if (!visitor) throw new Error('That visitor is no longer on file.')
    if (!tenant) throw new Error('That resident no longer exists.')
    if (visitor.buildingId !== tenant.buildingId) {
      throw new Error('That visitor is registered at a different site.')
    }
    if (args.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw new Error('Days must be weekday numbers, 0 for Sunday through 6 for Saturday.')
    }

    // One live authorization per guest-and-resident pair: two overlapping
    // rules is a question nobody at the desk can answer.
    const existing = await ctx.db
      .query('overnightAuthorizations')
      .withIndex('by_visitor', (q) => q.eq('visitorId', args.visitorId))
      .collect()
    for (const row of existing) {
      if (row.tenantId === args.tenantId && !row.revokedAt) {
        await ctx.db.patch(row._id, { revokedAt: args.now })
      }
    }

    return await ctx.db.insert('overnightAuthorizations', {
      visitorId: args.visitorId,
      tenantId: args.tenantId,
      buildingId: visitor.buildingId,
      days: [...new Set(args.days)].sort(),
      fromDate: args.fromDate?.trim() || undefined,
      toDate: args.toDate?.trim() || undefined,
      note: args.note?.trim() || undefined,
      authorizedAt: args.now,
      authorizedBy: staff._id,
    })
  },
})

export const revokeOvernight = mutation({
  args: { authorizationId: v.id('overnightAuthorizations'), now: v.number() },
  handler: async (ctx, args) => {
    await requireCapability(ctx, 'site-config')
    await ctx.db.patch(args.authorizationId, { revokedAt: args.now })
    return null
  },
})

/**
 * Guests approved to stay with a resident, for the badge on their record.
 * Cheap enough to call from the resident page without loading the whole desk.
 */
export const overnightFor = query({
  args: { tenantId: v.id('tenants'), now: v.number(), tzOffsetMinutes: v.number() },
  handler: async (ctx, args) => {
    await requireStaff(ctx)

    const today = localDate(args.now, args.tzOffsetMinutes)
    const rows = await ctx.db
      .query('overnightAuthorizations')
      .withIndex('by_tenant', (q) => q.eq('tenantId', args.tenantId))
      .collect()

    const live = rows.filter(
      (row) =>
        !row.revokedAt
        && (!row.fromDate || row.fromDate <= today)
        && (!row.toDate || row.toDate >= today),
    )

    const visitors = await Promise.all(live.map((row) => ctx.db.get(row.visitorId)))

    return live.map((row, i) => ({
      _id: row._id,
      visitorId: row.visitorId,
      name: visitors[i]?.name ?? 'Former visitor',
      days: row.days,
      note: row.note ?? null,
    }))
  },
})
