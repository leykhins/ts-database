import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireCapability, requireStaff, resolveBuilding } from './model'

/**
 * Maintenance — work orders raised at the front desk.
 *
 * Anyone on shift can raise one (that is the point of a front desk) and anyone
 * can assign or close one; this is the one area where holding the ticket back
 * behind a role would just mean it gets written on paper instead.
 */

const status = v.union(v.literal('open'), v.literal('assigned'), v.literal('closed'))
const priority = v.union(v.literal('high'), v.literal('med'), v.literal('low'))

export const list = query({
  args: {
    buildingId: v.optional(v.id('buildings')),
    includeClosed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireStaff(ctx)
    const building = await resolveBuilding(ctx, args.buildingId)
    if (!building) return null

    const buildingId = building._id
    const [orders, rooms] = await Promise.all([
      ctx.db
        .query('workOrders')
        .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
        .collect(),
      ctx.db
        .query('rooms')
        .withIndex('by_building_sort', (q) => q.eq('buildingId', buildingId))
        .collect(),
    ])

    const roomById = new Map(rooms.map((r) => [r._id as string, r]))
    const now = Date.now()
    const RANK = { high: 0, med: 1, low: 2 }

    const rows = orders
      .filter((w) => args.includeClosed || w.status !== 'closed')
      .map((w) => ({
        _id: w._id,
        title: w.title,
        detail: w.detail,
        status: w.status,
        priority: w.priority,
        room: w.roomId ? (roomById.get(w.roomId)?.number ?? '—') : 'Common area',
        roomId: w.roomId ?? null,
        assignedTo: w.assignedTo,
        openedAt: w.openedAt,
        closedAt: w.closedAt,
        ageDays: Math.floor(((w.closedAt ?? now) - w.openedAt) / 86_400_000),
      }))
      .sort((a, b) => {
        if ((a.status === 'closed') !== (b.status === 'closed')) {
          return a.status === 'closed' ? 1 : -1
        }
        return RANK[a.priority] - RANK[b.priority] || a.openedAt - b.openedAt
      })

    const openOrders = orders.filter((w) => w.status !== 'closed')

    return {
      building: { _id: building._id, name: building.name },
      rows,
      counts: {
        open: orders.filter((w) => w.status === 'open').length,
        assigned: orders.filter((w) => w.status === 'assigned').length,
        closed: orders.filter((w) => w.status === 'closed').length,
        high: openOrders.filter((w) => w.priority === 'high').length,
        oldestDays: openOrders.length
          ? Math.floor(
              (now - Math.min(...openOrders.map((w) => w.openedAt))) / 86_400_000,
            )
          : 0,
      },
      rooms: rooms.map((r) => ({ _id: r._id, number: r.number, floor: r.floor })),
    }
  },
})

export const create = mutation({
  args: {
    buildingId: v.id('buildings'),
    roomId: v.optional(v.id('rooms')),
    title: v.string(),
    detail: v.optional(v.string()),
    priority,
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, 'checks')

    const building = await ctx.db.get(args.buildingId)
    if (!building) throw new Error('That building no longer exists.')
    if (!args.title.trim()) throw new Error('Say what needs doing.')

    if (args.roomId) {
      const room = await ctx.db.get(args.roomId)
      if (!room || room.buildingId !== args.buildingId) {
        throw new Error('That room is not in this building.')
      }
    }

    return await ctx.db.insert('workOrders', {
      buildingId: args.buildingId,
      roomId: args.roomId,
      title: args.title.trim(),
      detail: args.detail?.trim() || undefined,
      status: 'open',
      priority: args.priority,
      openedAt: Date.now(),
    })
  },
})

/** Assign to trades, re-prioritise, or close with the time it took recorded. */
export const update = mutation({
  args: {
    workOrderId: v.id('workOrders'),
    status: v.optional(status),
    priority: v.optional(priority),
    assignedTo: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, 'checks')

    const order = await ctx.db.get(args.workOrderId)
    if (!order) throw new Error('That work order no longer exists.')

    const patch: Record<string, unknown> = {}

    if (args.assignedTo !== undefined) {
      const assignedTo = args.assignedTo.trim()
      patch.assignedTo = assignedTo || undefined
      // Naming a trade is the assignment; making staff also flip the status is
      // how work orders end up sitting in "open" with someone already on site.
      if (assignedTo && order.status === 'open' && args.status === undefined) {
        patch.status = 'assigned'
      }
    }
    if (args.detail !== undefined) patch.detail = args.detail.trim() || undefined
    if (args.priority !== undefined) patch.priority = args.priority

    if (args.status !== undefined) {
      patch.status = args.status
      patch.closedAt = args.status === 'closed' ? Date.now() : undefined
    }

    await ctx.db.patch(args.workOrderId, patch)
    return null
  },
})

export const remove = mutation({
  args: { workOrderId: v.id('workOrders') },
  handler: async (ctx, { workOrderId }) => {
    await requireCapability(ctx, 'building-config')
    await ctx.db.delete(workOrderId)
    return null
  },
})
