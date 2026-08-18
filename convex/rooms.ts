import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { assertBuildingAccess, requireCapability, requireStaff, scoped } from './model'

/**
 * Rooms are building configuration, so everything that changes them is
 * administrator-only. Reading them is not: every screen that lists tenancies
 * needs the room list.
 */

/** Rooms sort the way staff walk the building: by floor, then room number. */
function naturalKey(number: string): number {
  const digits = number.replace(/[^0-9]/g, '')
  return digits ? Number.parseInt(digits, 10) : Number.MAX_SAFE_INTEGER
}

/**
 * Rewrite `sortKey` for a whole building after rooms are added or removed.
 * Sort keys are positions, not room numbers, so a building seeded with 0…47
 * and a building numbered 101…312 order identically.
 */
async function resequence(ctx: MutationCtx, buildingId: Id<'buildings'>) {
  const rooms = await ctx.db
    .query('rooms')
    .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
    .collect()

  rooms.sort(
    (a, b) =>
      a.floor.localeCompare(b.floor, undefined, { numeric: true })
      || naturalKey(a.number) - naturalKey(b.number)
      || a.number.localeCompare(b.number),
  )

  for (const [index, room] of rooms.entries()) {
    if (room.sortKey !== index) await ctx.db.patch(room._id, { sortKey: index })
  }

  // `units` is what the occupancy figures divide by, so it follows the rooms
  // that actually exist rather than a number somebody typed once.
  const building = await ctx.db.get(buildingId)
  if (building && building.units !== rooms.length) {
    await ctx.db.patch(buildingId, { units: rooms.length })
  }

  return rooms.length
}

export const list = query({
  args: { buildingId: v.id('buildings') },
  handler: async (ctx, { buildingId }) => {
    await requireStaff(ctx)

    const [rooms, tenants] = await Promise.all([
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
    ])

    const occupantByRoom = new Map(
      tenants.filter((t) => t.roomId).map((t) => [t.roomId!, t]),
    )

    return rooms.map((room) => {
      const occupant = occupantByRoom.get(room._id)
      return {
        _id: room._id,
        number: room.number,
        floor: room.floor,
        monthlyRentCents: room.monthlyRentCents,
        outOfService: room.outOfService ?? false,
        lastCheckedAt: room.lastCheckedAt,
        occupant: occupant ? { _id: occupant._id, name: occupant.name } : null,
      }
    })
  },
})

export const create = mutation({
  args: {
    buildingId: v.id('buildings'),
    number: v.string(),
    floor: v.string(),
    monthlyRentCents: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'building-config')

    assertBuildingAccess(staff, args.buildingId)
    const building = await ctx.db.get(args.buildingId)
    if (!building) throw new Error('That building no longer exists.')

    const number = args.number.trim()
    const floor = args.floor.trim()
    if (!number) throw new Error('Give the room a number.')
    if (!floor) throw new Error('Give the room a floor.')
    if (!Number.isInteger(args.monthlyRentCents) || args.monthlyRentCents < 0) {
      throw new Error('Rent must be a whole number of cents.')
    }

    const clash = await ctx.db
      .query('rooms')
      .withIndex('by_building_number', (q) =>
        q.eq('buildingId', args.buildingId).eq('number', number),
      )
      .unique()
    if (clash) throw new Error(`Room ${number} already exists in this building.`)

    const roomId = await ctx.db.insert('rooms', {
      buildingId: args.buildingId,
      number,
      floor,
      sortKey: 0, // set by `resequence` below
      monthlyRentCents: args.monthlyRentCents,
    })
    await resequence(ctx, args.buildingId)
    return roomId
  },
})

/**
 * Add a floor's worth of rooms in one go — a 20-room floor is 20 identical
 * forms otherwise, which is how buildings end up half-entered.
 * Numbers that already exist are skipped rather than failing the whole run.
 */
export const createRange = mutation({
  args: {
    buildingId: v.id('buildings'),
    floor: v.string(),
    from: v.number(),
    to: v.number(),
    monthlyRentCents: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'building-config')

    assertBuildingAccess(staff, args.buildingId)
    const building = await ctx.db.get(args.buildingId)
    if (!building) throw new Error('That building no longer exists.')

    const floor = args.floor.trim()
    if (!floor) throw new Error('Give the floor a label.')
    if (!Number.isInteger(args.from) || !Number.isInteger(args.to)) {
      throw new Error('Room numbers must be whole numbers.')
    }
    if (args.to < args.from) {
      throw new Error('The last room number must not be below the first.')
    }
    if (args.to - args.from + 1 > 200) {
      throw new Error('That is more than 200 rooms — add them a floor at a time.')
    }
    if (!Number.isInteger(args.monthlyRentCents) || args.monthlyRentCents < 0) {
      throw new Error('Rent must be a whole number of cents.')
    }

    const existing = await ctx.db
      .query('rooms')
      .withIndex('by_building', (q) => q.eq('buildingId', args.buildingId))
      .collect()
    const taken = new Set(existing.map((r) => r.number))

    let created = 0
    let skipped = 0
    for (let n = args.from; n <= args.to; n++) {
      const number = String(n)
      if (taken.has(number)) {
        skipped++
        continue
      }
      await ctx.db.insert('rooms', {
        buildingId: args.buildingId,
        number,
        floor,
        sortKey: 0,
        monthlyRentCents: args.monthlyRentCents,
      })
      created++
    }

    const total = await resequence(ctx, args.buildingId)
    return { created, skipped, total }
  },
})

export const update = mutation({
  args: {
    roomId: v.id('rooms'),
    number: v.optional(v.string()),
    floor: v.optional(v.string()),
    monthlyRentCents: v.optional(v.number()),
    outOfService: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'building-config')

    const room = scoped(staff, await ctx.db.get(args.roomId), 'That room no longer exists.')

    const patch: {
      number?: string
      floor?: string
      monthlyRentCents?: number
      outOfService?: boolean
    } = {}

    if (args.number !== undefined) {
      const number = args.number.trim()
      if (!number) throw new Error('Give the room a number.')
      if (number !== room.number) {
        const clash = await ctx.db
          .query('rooms')
          .withIndex('by_building_number', (q) =>
            q.eq('buildingId', room.buildingId).eq('number', number),
          )
          .unique()
        if (clash) throw new Error(`Room ${number} already exists in this building.`)
      }
      patch.number = number
    }

    if (args.floor !== undefined) {
      const floor = args.floor.trim()
      if (!floor) throw new Error('Give the room a floor.')
      patch.floor = floor
    }

    if (args.monthlyRentCents !== undefined) {
      if (!Number.isInteger(args.monthlyRentCents) || args.monthlyRentCents < 0) {
        throw new Error('Rent must be a whole number of cents.')
      }
      patch.monthlyRentCents = args.monthlyRentCents
    }

    if (args.outOfService !== undefined) {
      if (args.outOfService) {
        const occupant = await ctx.db
          .query('tenants')
          .withIndex('by_room', (q) => q.eq('roomId', args.roomId))
          .filter((q) => q.eq(q.field('status'), 'current'))
          .first()
        if (occupant) {
          throw new Error(
            `${occupant.name} is housed in this room — move them before taking it out of service.`,
          )
        }
      }
      patch.outOfService = args.outOfService
    }

    await ctx.db.patch(args.roomId, patch)
    if (patch.number !== undefined || patch.floor !== undefined) {
      await resequence(ctx, room.buildingId)
    }
    return null
  },
})

export const remove = mutation({
  args: { roomId: v.id('rooms') },
  handler: async (ctx, { roomId }) => {
    const staff = await requireCapability(ctx, 'building-config')

    const room = await ctx.db.get(roomId)
    if (!room) throw new Error('That room no longer exists.')

    // Any tenancy — current or prior — points at this room, and a prior
    // tenancy with a dangling room id is a hole in the record.
    const tenancy = await ctx.db
      .query('tenants')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .first()
    if (tenancy) {
      throw new Error(
        `Room ${room.number} has tenancy history (${tenancy.name}). Take it out of service instead.`,
      )
    }

    await ctx.db.delete(roomId)
    await resequence(ctx, room.buildingId)
    return null
  },
})
