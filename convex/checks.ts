import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { CHECK_INTERVAL_MS, requireCapability, requireStaff, resolveBuilding } from './model'

const outcome = v.union(
  v.literal('all-clear'),
  v.literal('deficiency'),
  v.literal('no-entry'),
)

/** Room Checks screen: every room with when it was last checked and by whom. */
export const list = query({
  args: { buildingId: v.optional(v.id('buildings')) },
  handler: async (ctx, args) => {
    await requireStaff(ctx)
    const building = await resolveBuilding(ctx, args.buildingId)
    if (!building) return null

    const buildingId = building._id
    const now = Date.now()

    const [rooms, tenants, recent] = await Promise.all([
      ctx.db
        .query('rooms')
        .withIndex('by_building_sort', (q) => q.eq('buildingId', buildingId))
        .collect(),
      ctx.db
        .query('tenants')
        .withIndex('by_building_status', (q) =>
          q.eq('buildingId', buildingId).eq('status', 'current'),
        )
        .collect(),
      ctx.db
        .query('roomChecks')
        .withIndex('by_building_completed', (q) => q.eq('buildingId', buildingId))
        .order('desc')
        .take(200),
    ])

    const tenantByRoom = new Map<string, (typeof tenants)[number]>()
    for (const t of tenants) if (t.roomId) tenantByRoom.set(t.roomId, t)

    const staffIds = [
      ...new Set(recent.map((c) => c.completedBy).filter(Boolean)),
    ] as NonNullable<(typeof recent)[number]['completedBy']>[]
    const staff = await Promise.all(staffIds.map((id) => ctx.db.get(id)))
    const staffName = new Map(
      staff.filter(Boolean).map((u) => [u!._id as string, u!.name ?? u!.email ?? 'Staff']),
    )

    const lastByRoom = new Map<string, (typeof recent)[number]>()
    for (const c of recent) {
      if (c.roomId && !lastByRoom.has(c.roomId)) lastByRoom.set(c.roomId, c)
    }

    const rows = rooms.map((room) => {
      const last = lastByRoom.get(room._id)
      const lastAt = last?.completedAt ?? room.lastCheckedAt
      const due = lastAt === undefined || now - lastAt > CHECK_INTERVAL_MS
      const tenant = tenantByRoom.get(room._id)
      return {
        roomId: room._id,
        number: room.number,
        floor: room.floor,
        tenantName: tenant?.name ?? null,
        tenantId: tenant?._id ?? null,
        vacant: !tenant,
        lastCheckedAt: lastAt ?? null,
        lastOutcome: last?.outcome ?? null,
        lastCheckedBy: last?.completedBy ? (staffName.get(last.completedBy) ?? null) : null,
        due,
        daysSince:
          lastAt === undefined ? null : Math.floor((now - lastAt) / 86_400_000),
      }
    })

    const lastBuildingCheck = recent.find((c) => c.kind === 'building')

    return {
      building: { _id: building._id, name: building.name },
      rows,
      summary: {
        total: rows.length,
        due: rows.filter((r) => r.due).length,
        lastBuildingCheckAt: lastBuildingCheck?.completedAt ?? null,
        lastBuildingCheckBy: lastBuildingCheck?.completedBy
          ? (staffName.get(lastBuildingCheck.completedBy) ?? null)
          : null,
        buildingCheckDue:
          lastBuildingCheck === undefined ||
          now - lastBuildingCheck.completedAt > CHECK_INTERVAL_MS,
      },
    }
  },
})

/** Sign off a single room check. */
export const completeRoomCheck = mutation({
  args: {
    roomId: v.id('rooms'),
    outcome,
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'checks')
    const room = await ctx.db.get(args.roomId)
    if (!room) throw new Error('Room not found.')

    const completedAt = Date.now()
    await ctx.db.insert('roomChecks', {
      buildingId: room.buildingId,
      roomId: room._id,
      kind: 'room',
      completedAt,
      outcome: args.outcome,
      notes: args.notes,
      completedBy: staff._id,
    })
    // Denormalised onto the room so the home-screen grid doesn't have to scan
    // the check history for all 48 rooms on every render.
    await ctx.db.patch(room._id, { lastCheckedAt: completedAt })
    return { completedAt }
  },
})

/** Sign off the whole-building check (fire route, common areas). */
export const completeBuildingCheck = mutation({
  args: {
    buildingId: v.id('buildings'),
    outcome,
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'checks')
    return await ctx.db.insert('roomChecks', {
      buildingId: args.buildingId,
      kind: 'building',
      completedAt: Date.now(),
      outcome: args.outcome,
      notes: args.notes,
      completedBy: staff._id,
    })
  },
})
