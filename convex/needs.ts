import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireCapability, requireStaff, resolveBuilding } from './model'

/**
 * Critical needs — residents with an open case, and what is on file.
 *
 * A "need" here is the thing the building has to act on: a health crisis, a
 * missed medication run, an eviction risk. Open ones are the queue; resolved
 * ones are the record of what was done, which is why nothing is ever deleted.
 */

export const list = query({
  args: {
    buildingId: v.optional(v.id('buildings')),
    includeResolved: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireStaff(ctx)
    const building = await resolveBuilding(ctx, args.buildingId)
    if (!building) return null

    const buildingId = building._id
    const [needs, tenants, rooms] = await Promise.all([
      ctx.db
        .query('criticalNeeds')
        .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
        .collect(),
      ctx.db
        .query('tenants')
        .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
        .collect(),
      ctx.db
        .query('rooms')
        .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
        .collect(),
    ])

    const tenantById = new Map(tenants.map((t) => [t._id as string, t]))
    const roomById = new Map(rooms.map((r) => [r._id as string, r]))
    const now = Date.now()

    const rows = needs
      .filter((n) => args.includeResolved || n.resolvedAt === undefined)
      .map((n) => {
        const tenant = tenantById.get(n.tenantId)
        return {
          _id: n._id,
          tenantId: n.tenantId,
          name: tenant?.name ?? 'Former resident',
          room: tenant?.roomId ? (roomById.get(tenant.roomId)?.number ?? '—') : '—',
          supportLevel: tenant?.supportLevel ?? 'moderate',
          summary: n.summary,
          detail: n.detail,
          caseManager: n.caseManager,
          openedAt: n.openedAt,
          resolvedAt: n.resolvedAt,
          daysOpen: Math.floor(((n.resolvedAt ?? now) - n.openedAt) / 86_400_000),
        }
      })
      .sort((a, b) => {
        if ((a.resolvedAt === undefined) !== (b.resolvedAt === undefined)) {
          return a.resolvedAt === undefined ? -1 : 1
        }
        return b.openedAt - a.openedAt
      })

    return {
      building: { _id: building._id, name: building.name },
      rows,
      counts: {
        open: needs.filter((n) => n.resolvedAt === undefined).length,
        resolved: needs.filter((n) => n.resolvedAt !== undefined).length,
        residents: new Set(
          needs.filter((n) => n.resolvedAt === undefined).map((n) => n.tenantId as string),
        ).size,
        overSevenDays: needs.filter(
          (n) => n.resolvedAt === undefined && now - n.openedAt > 7 * 86_400_000,
        ).length,
      },
      // The intake picker: current residents, so a need can be opened here
      // rather than from the resident's profile.
      residents: tenants
        .filter((t) => t.status === 'current')
        .map((t) => ({
          _id: t._id,
          name: t.name,
          room: t.roomId ? (roomById.get(t.roomId)?.number ?? '—') : '—',
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  },
})

export const open = mutation({
  args: {
    tenantId: v.id('tenants'),
    summary: v.string(),
    detail: v.optional(v.string()),
    caseManager: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, 'care')

    const tenant = await ctx.db.get(args.tenantId)
    if (!tenant) throw new Error('That resident no longer exists.')
    if (!args.summary.trim()) throw new Error('Summarise the need in one line.')

    return await ctx.db.insert('criticalNeeds', {
      tenantId: tenant._id,
      buildingId: tenant.buildingId,
      summary: args.summary.trim(),
      detail: args.detail?.trim() || undefined,
      caseManager: args.caseManager?.trim() || undefined,
      openedAt: Date.now(),
    })
  },
})

export const update = mutation({
  args: {
    needId: v.id('criticalNeeds'),
    summary: v.optional(v.string()),
    detail: v.optional(v.string()),
    caseManager: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, 'care')

    const need = await ctx.db.get(args.needId)
    if (!need) throw new Error('That case is no longer on file.')

    const patch: Record<string, unknown> = {}
    if (args.summary !== undefined) {
      if (!args.summary.trim()) throw new Error('Summarise the need in one line.')
      patch.summary = args.summary.trim()
    }
    if (args.detail !== undefined) patch.detail = args.detail.trim() || undefined
    if (args.caseManager !== undefined) {
      patch.caseManager = args.caseManager.trim() || undefined
    }

    await ctx.db.patch(args.needId, patch)
    return null
  },
})

/** Close a case. Reopening is allowed — a need that comes back is not a new one. */
export const resolve = mutation({
  args: { needId: v.id('criticalNeeds'), resolved: v.boolean() },
  handler: async (ctx, args) => {
    await requireCapability(ctx, 'care')

    const need = await ctx.db.get(args.needId)
    if (!need) throw new Error('That case is no longer on file.')

    await ctx.db.patch(args.needId, {
      resolvedAt: args.resolved ? Date.now() : undefined,
    })
    return null
  },
})
