import { v } from 'convex/values'
import { query } from './_generated/server'
import { requireStaff, resolveBuilding } from './model'

/**
 * Security deposits — money held in trust per tenancy.
 *
 * Shortfalls lead, because a deposit that was never fully collected is the one
 * that causes an argument at move-out. Movements are posted through
 * `rents.adjustDeposit`, which keeps the held figure and the movement rows in
 * the same transaction.
 */

export const overview = query({
  args: { buildingId: v.optional(v.id('buildings')) },
  handler: async (ctx, args) => {
    await requireStaff(ctx)
    const building = await resolveBuilding(ctx, args.buildingId)
    if (!building) return null

    const buildingId = building._id
    const [tenants, rooms, recent] = await Promise.all([
      ctx.db
        .query('tenants')
        .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
        .collect(),
      ctx.db
        .query('rooms')
        .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
        .collect(),
      ctx.db
        .query('depositEntries')
        .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
        .order('desc')
        .take(40),
    ])

    const roomById = new Map(rooms.map((r) => [r._id as string, r]))
    const tenantById = new Map(tenants.map((t) => [t._id as string, t]))

    const rows = tenants
      .filter((t) => t.status !== 'prospective')
      .map((t) => {
        const heldCents = t.depositHeldCents ?? 0
        return {
          _id: t._id,
          name: t.name,
          room: t.roomId ? (roomById.get(t.roomId)?.number ?? '—') : '—',
          status: t.status,
          heldCents,
          requiredCents: t.depositRequiredCents,
          shortCents: Math.max(0, t.depositRequiredCents - heldCents),
          refundableCents: t.status === 'prior' ? heldCents : 0,
        }
      })
      .sort(
        (a, b) =>
          b.shortCents - a.shortCents
          || b.refundableCents - a.refundableCents
          || a.room.localeCompare(b.room, undefined, { numeric: true }),
      )

    const totals = rows.reduce(
      (acc, r) => {
        acc.heldCents += r.heldCents
        acc.requiredCents += r.status === 'current' ? r.requiredCents : 0
        acc.shortCents += r.status === 'current' ? r.shortCents : 0
        acc.refundableCents += r.refundableCents
        return acc
      },
      { heldCents: 0, requiredCents: 0, shortCents: 0, refundableCents: 0 },
    )

    return {
      building: { _id: building._id, name: building.name },
      rows,
      totals: {
        ...totals,
        shortCount: rows.filter((r) => r.status === 'current' && r.shortCents > 0).length,
        refundCount: rows.filter((r) => r.refundableCents > 0).length,
      },
      recent: recent.map((e) => ({
        _id: e._id,
        tenantId: e.tenantId,
        name: tenantById.get(e.tenantId)?.name ?? 'Former resident',
        amountCents: e.amountCents,
        reason: e.reason,
        postedAt: e.postedAt,
      })),
    }
  },
})

/** Every movement behind one tenancy's held figure, newest first. */
export const historyFor = query({
  args: { tenantId: v.id('tenants') },
  handler: async (ctx, { tenantId }) => {
    await requireStaff(ctx)
    const entries = await ctx.db
      .query('depositEntries')
      .withIndex('by_tenant', (q) => q.eq('tenantId', tenantId))
      .order('desc')
      .take(50)

    return entries.map((e) => ({
      _id: e._id,
      amountCents: e.amountCents,
      reason: e.reason,
      postedAt: e.postedAt,
    }))
  },
})
