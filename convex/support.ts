import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { supportLevel } from './schema'
import { requireCapability, requireStaff, resolveBuilding, scoped, scopedTenant } from './model'

/**
 * Support levels — where each resident sits between independent living and
 * critical care, and how that has changed.
 *
 * The level drives staffing, so the screen leads with the distribution rather
 * than the roster: "how many high-support residents are on this floor tonight"
 * is the question a shift supervisor actually asks.
 */

const LEVELS = ['independent', 'moderate', 'high', 'critical'] as const

export const overview = query({
  args: { buildingId: v.optional(v.id('buildings')) },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx)
    const building = await resolveBuilding(ctx, staff, args.buildingId)
    if (!building) return null

    const buildingId = building._id
    const [tenants, rooms, changes, needs] = await Promise.all([
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
        .query('supportLevelChanges')
        .withIndex('by_building_changed', (q) => q.eq('buildingId', buildingId))
        .order('desc')
        .take(25),
      ctx.db
        .query('criticalNeeds')
        .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
        .collect(),
    ])

    const roomById = new Map(rooms.map((r) => [r._id as string, r]))
    const tenantName = new Map(tenants.map((t) => [t._id as string, t.name]))
    const openNeeds = new Set(
      needs.filter((n) => n.resolvedAt === undefined).map((n) => n.tenantId as string),
    )

    const distribution = LEVELS.map((level) => ({
      level,
      count: tenants.filter((t) => t.supportLevel === level).length,
    }))

    const residents = tenants
      .map((t) => ({
        _id: t._id,
        name: t.name,
        room: t.roomId ? (roomById.get(t.roomId)?.number ?? '—') : '—',
        floor: t.roomId ? (roomById.get(t.roomId)?.floor ?? '—') : '—',
        supportLevel: t.supportLevel,
        critical: openNeeds.has(t._id),
      }))
      .sort(
        (a, b) =>
          LEVELS.indexOf(b.supportLevel) - LEVELS.indexOf(a.supportLevel)
          || a.room.localeCompare(b.room, undefined, { numeric: true }),
      )

    // Staffing implication: the ratio the building is actually carrying.
    const weighted = tenants.reduce(
      (sum, t) => sum + { independent: 1, moderate: 2, high: 3, critical: 4 }[t.supportLevel],
      0,
    )

    const byFloor = [...new Set(rooms.map((r) => r.floor))].map((floor) => ({
      floor,
      counts: LEVELS.map((level) => ({
        level,
        count: residents.filter((r) => r.floor === floor && r.supportLevel === level).length,
      })),
    }))

    return {
      building: { _id: building._id, name: building.name },
      distribution,
      residents,
      byFloor,
      weighted,
      averageLoad: tenants.length ? weighted / tenants.length : 0,
      recentChanges: changes.map((c) => ({
        _id: c._id,
        tenantId: c.tenantId,
        name: tenantName.get(c.tenantId) ?? 'Former resident',
        from: c.from,
        to: c.to,
        reason: c.reason,
        changedAt: c.changedAt,
      })),
    }
  },
})

/** The level history behind one resident, newest first. */
export const historyFor = query({
  args: { tenantId: v.id('tenants') },
  handler: async (ctx, { tenantId }) => {
    const staff = await requireStaff(ctx)
    if (!(await scopedTenant(ctx, staff, tenantId))) return []
    const changes = await ctx.db
      .query('supportLevelChanges')
      .withIndex('by_tenant', (q) => q.eq('tenantId', tenantId))
      .order('desc')
      .take(30)

    const staffIds = [...new Set(changes.map((c) => c.changedBy).filter(Boolean))]
    const changedByUsers = await Promise.all(staffIds.map((id) => ctx.db.get(id!)))
    const staffName = new Map(changedByUsers.filter(Boolean).map((s) => [s!._id as string, s!.name]))

    return changes.map((c) => ({
      _id: c._id,
      from: c.from,
      to: c.to,
      reason: c.reason,
      changedAt: c.changedAt,
      changedBy: c.changedBy ? (staffName.get(c.changedBy) ?? null) : null,
    }))
  },
})

/**
 * Change a resident's support level. The reason is required, and the change is
 * written to the history table in the same transaction as the tenant record —
 * a level that moved with no note attached is not an audit trail.
 */
export const setLevel = mutation({
  args: {
    tenantId: v.id('tenants'),
    supportLevel,
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'care')

    const tenant = scoped(staff, await ctx.db.get(args.tenantId), 'That resident no longer exists.')
    if (tenant.supportLevel === args.supportLevel) {
      throw new Error('That is already this resident’s support level.')
    }
    if (!args.reason.trim()) {
      throw new Error('Say why the level is changing — it is the record care staff rely on.')
    }

    await ctx.db.patch(args.tenantId, { supportLevel: args.supportLevel })
    await ctx.db.insert('supportLevelChanges', {
      tenantId: tenant._id,
      buildingId: tenant.buildingId,
      from: tenant.supportLevel,
      to: args.supportLevel,
      reason: args.reason.trim(),
      changedAt: Date.now(),
      changedBy: staff._id,
    })
    return null
  },
})
