import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { supportLevel, tenancyStatus } from './schema'
import {
  assertBuildingAccess,
  billingBuildingId,
  photoUrlsFor,
  recomputeTenantRollups,
  recordPlacement,
  requireCapability,
  requireStaff,
  resolveBuilding,
  scoped,
  scopedTenant,
} from './model'

/** Roster for the Tenants screen: one row per tenant with money rolled up. */
export const list = query({
  args: {
    buildingId: v.optional(v.id('buildings')),
    status: v.optional(tenancyStatus),
    supportLevel: v.optional(supportLevel),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx)
    const building = await resolveBuilding(ctx, staff, args.buildingId)
    if (!building) return { building: null, tenants: [], counts: { current: 0, prospective: 0, prior: 0 } }

    const buildingId = building._id
    const all = await ctx.db
      .query('tenants')
      .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
      .collect()

    const [needs, rooms] = await Promise.all([
      ctx.db
        .query('criticalNeeds')
        .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
        .collect(),
      ctx.db
        .query('rooms')
        .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
        .collect(),
    ])

    const openNeedIds = new Set(
      needs.filter((n) => n.resolvedAt === undefined).map((n) => n.tenantId),
    )
    const photos = await photoUrlsFor(ctx, all)
    const roomById = new Map(rooms.map((r) => [r._id as string, r]))

    const counts = {
      current: all.filter((t) => t.status === 'current').length,
      prospective: all.filter((t) => t.status === 'prospective').length,
      prior: all.filter((t) => t.status === 'prior').length,
    }

    const filtered = all
      .filter((t) => (args.status ? t.status === args.status : true))
      .filter((t) => (args.supportLevel ? t.supportLevel === args.supportLevel : true))

    const tenants = filtered
      .map((t) => {
        const balanceCents = t.balanceCents ?? 0
        const heldCents = t.depositHeldCents ?? 0
        return {
          _id: t._id,
          name: t.name,
          room: t.roomId ? (roomById.get(t.roomId)?.number ?? '—') : '—',
          photoUrl: photos.get(t._id) ?? null,
          status: t.status,
          supportLevel: t.supportLevel,
          monthlyRentCents: t.monthlyRentCents,
          balanceCents,
          depositHeldCents: heldCents,
          depositRequiredCents: t.depositRequiredCents,
          critical: openNeedIds.has(t._id),
        }
      })
      .sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }))

    return {
      building: { _id: building._id, name: building.name, units: building.units },
      tenants,
      counts,
    }
  },
})

/** Full resident record for the Tenant Profile screen. */
export const get = query({
  args: { tenantId: v.id('tenants') },
  handler: async (ctx, { tenantId }) => {
    const staff = await requireStaff(ctx)
    const tenant = await scopedTenant(ctx, staff, tenantId)
    if (!tenant) return null

    const [building, room, ledger, deposits, needs] = await Promise.all([
      ctx.db.get(tenant.buildingId),
      tenant.roomId ? ctx.db.get(tenant.roomId) : Promise.resolve(null),
      ctx.db
        .query('rentLedger')
        .withIndex('by_tenant', (q) => q.eq('tenantId', tenantId))
        .order('desc')
        .take(60),
      ctx.db
        .query('depositEntries')
        .withIndex('by_tenant', (q) => q.eq('tenantId', tenantId))
        .order('desc')
        .take(40),
      ctx.db
        .query('criticalNeeds')
        .withIndex('by_tenant', (q) => q.eq('tenantId', tenantId))
        .collect(),
    ])

    const openNeeds = needs.filter((n) => n.resolvedAt === undefined)

    return {
      _id: tenant._id,
      name: tenant.name,
      dob: tenant.dob,
      intakeDate: tenant.intakeDate,
      exitDate: tenant.exitDate,
      status: tenant.status,
      supportLevel: tenant.supportLevel,
      monthlyRentCents: tenant.monthlyRentCents,
      depositRequiredCents: tenant.depositRequiredCents,
      depositHeldCents: tenant.depositHeldCents ?? 0,
      balanceCents: tenant.balanceCents ?? 0,
      notes: tenant.notes,
      roomId: tenant.roomId ?? null,
      buildingId: tenant.buildingId,
      room: room?.number ?? '—',
      buildingName: building?.name ?? '—',
      exitReason: tenant.exitReason,
      critical: openNeeds.length > 0,
      criticalNeeds: openNeeds
        .sort((a, b) => b.openedAt - a.openedAt)
        .map((n) => ({
          _id: n._id,
          summary: n.summary,
          detail: n.detail,
          openedAt: n.openedAt,
          caseManager: n.caseManager,
        })),
      ledger: ledger
        .sort((a, b) => b.postedAt - a.postedAt)
        .slice(0, 24)
        .map((e) => ({
          _id: e._id,
          kind: e.kind,
          amountCents: e.amountCents,
          postedAt: e.postedAt,
          method: e.method,
          reference: e.reference,
          periodLabel: e.periodLabel,
        })),
      depositEntries: deposits
        .sort((a, b) => b.postedAt - a.postedAt)
        .map((e) => ({
          _id: e._id,
          amountCents: e.amountCents,
          postedAt: e.postedAt,
          reason: e.reason,
        })),
    }
  },
})

/**
 * Rooms available to house someone: in service, and with nobody currently
 * housed in them. Used by the intake form so a room cannot be double-booked.
 */
export const vacancies = query({
  args: { buildingId: v.optional(v.id('buildings')) },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx)
    const building = await resolveBuilding(ctx, staff, args.buildingId)
    if (!building) return []

    const buildingId = building._id
    const [rooms, current] = await Promise.all([
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

    /*
       A room is taken if someone lives in it — or if it is being held for
       someone who is temporarily at another site. The hold is the whole point
       of a temporary transfer: offering their room to the next intake is how
       a resident comes back to find they no longer have one.
    */
    const held = await ctx.db
      .query('tenants')
      .withIndex('by_home_building', (q) => q.eq('homeBuildingId', buildingId))
      .filter((q) => q.eq(q.field('status'), 'current'))
      .collect()

    const taken = new Set(
      [
        ...current.map((t) => t.roomId),
        ...held.map((t) => t.heldRoomId),
      ].filter(Boolean),
    )

    return rooms
      .filter((r) => !r.outOfService && !taken.has(r._id))
      .map((r) => ({
        _id: r._id,
        number: r.number,
        floor: r.floor,
        monthlyRentCents: r.monthlyRentCents,
      }))
  },
})

/**
 * Intake: create a tenancy record.
 *
 * Front-desk work, not administration — but the room check is not optional.
 * Two people housed in one room is the kind of error that only surfaces at
 * rent time, so the write refuses instead of trusting the form.
 */
export const create = mutation({
  args: {
    buildingId: v.id('buildings'),
    roomId: v.optional(v.id('rooms')),
    name: v.string(),
    dob: v.optional(v.string()),
    intakeDate: v.string(),
    status: tenancyStatus,
    supportLevel,
    monthlyRentCents: v.number(),
    depositRequiredCents: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'tenancy')

    assertBuildingAccess(staff, args.buildingId)
    const building = await ctx.db.get(args.buildingId)
    if (!building) throw new Error('That building no longer exists.')

    const name = args.name.trim()
    if (!name) throw new Error('Enter the resident’s name.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.intakeDate)) {
      throw new Error('Intake date must be a calendar date.')
    }
    if (args.dob && !/^\d{4}-\d{2}-\d{2}$/.test(args.dob)) {
      throw new Error('Date of birth must be a calendar date.')
    }
    for (const cents of [args.monthlyRentCents, args.depositRequiredCents]) {
      if (!Number.isInteger(cents) || cents < 0) {
        throw new Error('Amounts must be whole numbers of cents.')
      }
    }

    if (args.roomId) {
      const room = await ctx.db.get(args.roomId)
      if (!room || room.buildingId !== args.buildingId) {
        throw new Error('That room is not in this building.')
      }
      if (room.outOfService) {
        throw new Error(`Room ${room.number} is out of service.`)
      }
      if (args.status === 'current') {
        const occupant = await ctx.db
          .query('tenants')
          .withIndex('by_room', (q) => q.eq('roomId', args.roomId))
          .filter((q) => q.eq(q.field('status'), 'current'))
          .first()
        if (occupant) {
          throw new Error(`Room ${room.number} is already housing ${occupant.name}.`)
        }
      }
    }

    const tenantId = await ctx.db.insert('tenants', {
      buildingId: args.buildingId,
      roomId: args.roomId,
      name,
      dob: args.dob || undefined,
      intakeDate: args.intakeDate,
      status: args.status,
      supportLevel: args.supportLevel,
      monthlyRentCents: args.monthlyRentCents,
      depositRequiredCents: args.depositRequiredCents,
      notes: args.notes?.trim() || undefined,
      // A new tenancy starts owing nothing and holding nothing; the rollups
      // move from here on with every ledger and deposit write.
      balanceCents: 0,
      depositHeldCents: 0,
    })

    // The record of where someone has lived starts at the door.
    const tenant = await ctx.db.get(tenantId)
    if (tenant) {
      await recordPlacement(ctx, tenant, {
        buildingId: args.buildingId,
        roomId: args.roomId,
        kind: 'intake',
        reason: 'Intake',
        recordedBy: staff._id,
      })
    }

    return tenantId
  },
})

/**
 * Edit a resident's record. Rent and deposit-required are the figures a
 * tenancy is billed against, so they are here and not on the room.
 */
export const update = mutation({
  args: {
    tenantId: v.id('tenants'),
    name: v.optional(v.string()),
    dob: v.optional(v.string()),
    intakeDate: v.optional(v.string()),
    monthlyRentCents: v.optional(v.number()),
    depositRequiredCents: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'tenancy')

    const tenant = scoped(staff, await ctx.db.get(args.tenantId), 'That resident no longer exists.')

    const patch: Record<string, unknown> = {}

    if (args.name !== undefined) {
      if (!args.name.trim()) throw new Error('Enter the resident’s name.')
      patch.name = args.name.trim()
    }
    if (args.dob !== undefined) {
      if (args.dob && !/^\d{4}-\d{2}-\d{2}$/.test(args.dob)) {
        throw new Error('Date of birth must be a calendar date.')
      }
      patch.dob = args.dob || undefined
    }
    if (args.intakeDate !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.intakeDate)) {
        throw new Error('Intake date must be a calendar date.')
      }
      patch.intakeDate = args.intakeDate
    }
    for (const [key, value] of [
      ['monthlyRentCents', args.monthlyRentCents],
      ['depositRequiredCents', args.depositRequiredCents],
    ] as const) {
      if (value === undefined) continue
      if (!Number.isInteger(value) || value < 0) {
        throw new Error('Amounts must be whole numbers of cents.')
      }
      patch[key] = value
    }
    if (args.notes !== undefined) patch.notes = args.notes.trim() || undefined

    await ctx.db.patch(args.tenantId, patch)
    return null
  },
})

/** Move a resident into another room, or out of one. */
export const transferRoom = mutation({
  args: {
    tenantId: v.id('tenants'),
    roomId: v.union(v.id('rooms'), v.null()),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'tenancy')

    const tenant = scoped(staff, await ctx.db.get(args.tenantId), 'That resident no longer exists.')

    const roomId = args.roomId
    if (roomId) {
      const room = await ctx.db.get(roomId)
      if (!room || room.buildingId !== tenant.buildingId) {
        throw new Error('That room is not in this building.')
      }
      if (room.outOfService) throw new Error(`Room ${room.number} is out of service.`)

      const occupant = await ctx.db
        .query('tenants')
        .withIndex('by_room', (q) => q.eq('roomId', roomId))
        .filter((q) => q.eq(q.field('status'), 'current'))
        .first()
      if (occupant && occupant._id !== tenant._id) {
        throw new Error(`Room ${room.number} is already housing ${occupant.name}.`)
      }
    }

    await ctx.db.patch(args.tenantId, { roomId: args.roomId ?? undefined })
    return null
  },
})

/**
 * End a tenancy.
 *
 * The room is released, the record becomes `prior`, and the balance and
 * deposit stay exactly as they are — an exit does not settle what is owed, and
 * pretending otherwise loses money. The refund, if any, is a deposit movement
 * posted from the Security Deposits screen.
 */
export const exit = mutation({
  args: {
    tenantId: v.id('tenants'),
    exitDate: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'tenancy')

    const tenant = scoped(staff, await ctx.db.get(args.tenantId), 'That resident no longer exists.')
    if (tenant.status === 'prior') throw new Error('That tenancy has already ended.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.exitDate)) {
      throw new Error('Exit date must be a calendar date.')
    }
    if (!args.reason.trim()) throw new Error('Record why the tenancy ended.')

    await ctx.db.patch(args.tenantId, {
      status: 'prior',
      exitDate: args.exitDate,
      exitReason: args.reason.trim(),
      roomId: undefined,
    })

    return {
      balanceCents: tenant.balanceCents ?? 0,
      depositHeldCents: tenant.depositHeldCents ?? 0,
    }
  },
})

/** Bring a prospective resident into a room, or reopen a prior tenancy. */
export const setStatus = mutation({
  args: { tenantId: v.id('tenants'), status: tenancyStatus },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'tenancy')

    const tenant = scoped(staff, await ctx.db.get(args.tenantId), 'That resident no longer exists.')

    if (args.status === 'current' && tenant.roomId) {
      const occupant = await ctx.db
        .query('tenants')
        .withIndex('by_room', (q) => q.eq('roomId', tenant.roomId))
        .filter((q) => q.eq(q.field('status'), 'current'))
        .first()
      if (occupant && occupant._id !== tenant._id) {
        throw new Error(`That room is already housing ${occupant.name}.`)
      }
    }

    await ctx.db.patch(args.tenantId, {
      status: args.status,
      ...(args.status === 'current' ? { exitDate: undefined, exitReason: undefined } : {}),
    })
    return null
  },
})

/**
 * Repair path for the rollup fields, and the backfill for deployments whose
 * tenants predate them:
 *
 *     npx convex run tenants:backfillRollups
 */
export const backfillRollups = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tenants = await ctx.db.query('tenants').collect()
    for (const tenant of tenants) {
      await recomputeTenantRollups(ctx, tenant._id)
    }
    return { tenants: tenants.length }
  },
})

/* ------------------------------------------------------------------------
   Moving between sites

   A resident can be sent to another site for a while so their behaviour can be
   assessed somewhere different, moved permanently, or evicted. Each of those
   is a placement, not an edit: overwriting `buildingId` would lose the fact
   that they were ever anywhere else, and a site has to be able to answer for
   who it housed and when.
   ------------------------------------------------------------------------ */

/**
 * Send a resident to another site.
 *
 * Temporary keeps their room and their rent at the home site — the room stays
 * empty for them, and nobody is asked to pay two sites of one organisation for
 * one tenancy. Permanent hands the whole tenancy over, room and billing with it.
 */
export const transferSite = mutation({
  args: {
    tenantId: v.id('tenants'),
    toBuildingId: v.id('buildings'),
    roomId: v.optional(v.id('rooms')),
    temporary: v.boolean(),
    expectedReturn: v.optional(v.number()),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'tenancy')
    const tenant = scoped(staff, await ctx.db.get(args.tenantId), 'That resident no longer exists.')

    if (!args.reason.trim()) throw new Error('Say why this resident is moving.')
    if (args.toBuildingId === tenant.buildingId) {
      throw new Error('That resident is already at this site.')
    }
    // The receiving site must be one the mover actually covers, or a transfer
    // becomes a way to push a resident somewhere nobody agreed to take them.
    assertBuildingAccess(staff, args.toBuildingId)

    const destination = await ctx.db.get(args.toBuildingId)
    if (!destination) throw new Error('That building no longer exists.')

    if (args.roomId) {
      const room = await ctx.db.get(args.roomId)
      if (!room || room.buildingId !== args.toBuildingId) {
        throw new Error('That room is not in the receiving building.')
      }
      if (room.outOfService) throw new Error(`Room ${room.number} is out of service.`)
      const occupant = await ctx.db
        .query('tenants')
        .withIndex('by_room', (q) => q.eq('roomId', args.roomId!))
        .filter((q) => q.eq(q.field('status'), 'current'))
        .first()
      if (occupant && occupant._id !== tenant._id) {
        throw new Error(`Room ${room.number} is already housing someone.`)
      }
    }

    const home = billingBuildingId(tenant)

    await ctx.db.patch(tenant._id, {
      buildingId: args.toBuildingId,
      roomId: args.roomId,
      ...(args.temporary
        ? {
            // Hold the room and the billing where they were.
            homeBuildingId: home,
            heldRoomId: tenant.roomId,
            awayUntil: args.expectedReturn,
          }
        : {
            // A permanent move takes everything with it; nothing is held.
            homeBuildingId: undefined,
            heldRoomId: undefined,
            awayUntil: undefined,
          }),
    })

    await recordPlacement(ctx, tenant, {
      buildingId: args.toBuildingId,
      roomId: args.roomId,
      kind: args.temporary ? 'transfer-temporary' : 'transfer-permanent',
      reason: args.reason.trim(),
      expectedReturn: args.expectedReturn,
      recordedBy: staff._id,
    })
    return null
  },
})

/** Bring a temporarily transferred resident back to the room held for them. */
export const returnHome = mutation({
  args: { tenantId: v.id('tenants'), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'tenancy')
    const tenant = scoped(staff, await ctx.db.get(args.tenantId), 'That resident no longer exists.')

    const home = tenant.homeBuildingId
    if (!home) throw new Error('That resident is not away from their home site.')

    await ctx.db.patch(tenant._id, {
      buildingId: home,
      roomId: tenant.heldRoomId,
      homeBuildingId: undefined,
      heldRoomId: undefined,
      awayUntil: undefined,
    })

    await recordPlacement(ctx, tenant, {
      buildingId: home,
      roomId: tenant.heldRoomId,
      kind: 'return',
      reason: args.reason?.trim() || 'Returned from temporary transfer',
      recordedBy: staff._id,
    })
    return null
  },
})

/**
 * Evict a resident.
 *
 * Ends the tenancy and frees the room, but keeps the person's record and their
 * whole history — an eviction can be revoked, and someone who comes back should
 * not arrive as a stranger.
 */
export const evict = mutation({
  args: { tenantId: v.id('tenants'), reason: v.string(), exitDate: v.string() },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'tenancy')
    const tenant = scoped(staff, await ctx.db.get(args.tenantId), 'That resident no longer exists.')
    if (!args.reason.trim()) throw new Error('An eviction has to say why.')

    await ctx.db.patch(tenant._id, {
      status: 'prior',
      exitDate: args.exitDate,
      exitReason: `Evicted — ${args.reason.trim()}`,
      roomId: undefined,
      homeBuildingId: undefined,
      heldRoomId: undefined,
      awayUntil: undefined,
    })

    await recordPlacement(ctx, tenant, {
      buildingId: billingBuildingId(tenant),
      kind: 'eviction',
      reason: args.reason.trim(),
      recordedBy: staff._id,
    })
    return null
  },
})

/**
 * Revoke an eviction and house the resident again, at any site.
 *
 * Deliberately a new placement rather than an undo: the record should show
 * that they were evicted and then brought back, not that it never happened.
 */
export const reinstate = mutation({
  args: {
    tenantId: v.id('tenants'),
    buildingId: v.id('buildings'),
    roomId: v.optional(v.id('rooms')),
    reason: v.string(),
    intakeDate: v.string(),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'tenancy')
    const tenant = scoped(staff, await ctx.db.get(args.tenantId), 'That resident no longer exists.')
    if (tenant.status === 'current') throw new Error('That resident is already housed.')
    if (!args.reason.trim()) throw new Error('Say why the eviction is being revoked.')
    assertBuildingAccess(staff, args.buildingId)

    if (args.roomId) {
      const room = await ctx.db.get(args.roomId)
      if (!room || room.buildingId !== args.buildingId) {
        throw new Error('That room is not in this building.')
      }
      const occupant = await ctx.db
        .query('tenants')
        .withIndex('by_room', (q) => q.eq('roomId', args.roomId!))
        .filter((q) => q.eq(q.field('status'), 'current'))
        .first()
      if (occupant) throw new Error(`Room ${room.number} is already housing someone.`)
    }

    await ctx.db.patch(tenant._id, {
      status: 'current',
      buildingId: args.buildingId,
      roomId: args.roomId,
      intakeDate: args.intakeDate,
      exitDate: undefined,
      exitReason: undefined,
    })

    await recordPlacement(ctx, tenant, {
      buildingId: args.buildingId,
      roomId: args.roomId,
      kind: 'return',
      reason: `Eviction revoked — ${args.reason.trim()}`,
      recordedBy: staff._id,
    })
    return null
  },
})

/** Everywhere this resident has lived, newest first. */
export const placementHistory = query({
  args: { tenantId: v.id('tenants') },
  handler: async (ctx, { tenantId }) => {
    const staff = await requireStaff(ctx)
    if (!(await scopedTenant(ctx, staff, tenantId))) return []

    const placements = await ctx.db
      .query('placements')
      .withIndex('by_tenant', (q) => q.eq('tenantId', tenantId))
      .collect()

    const buildings = new Map<string, string>()
    const rooms = new Map<string, string>()
    for (const p of placements) {
      if (!buildings.has(p.buildingId)) {
        buildings.set(p.buildingId, (await ctx.db.get(p.buildingId))?.name ?? '—')
      }
      if (p.roomId && !rooms.has(p.roomId)) {
        rooms.set(p.roomId, (await ctx.db.get(p.roomId))?.number ?? '—')
      }
    }

    return placements
      // `_creationTime` breaks ties: two placements written in the same
      // millisecond (close one, open the next) would otherwise sort arbitrarily.
      .sort((a, b) => b.startedAt - a.startedAt || b._creationTime - a._creationTime)
      .map((p) => ({
        _id: p._id,
        kind: p.kind,
        building: buildings.get(p.buildingId) ?? '—',
        room: p.roomId ? rooms.get(p.roomId) ?? '—' : null,
        startedAt: p.startedAt,
        endedAt: p.endedAt ?? null,
        expectedReturn: p.expectedReturn ?? null,
        reason: p.reason ?? null,
      }))
  },
})

/** Who has lived in this room, newest first. */
export const roomHistory = query({
  args: { roomId: v.id('rooms') },
  handler: async (ctx, { roomId }) => {
    const staff = await requireStaff(ctx)
    const room = scoped(staff, await ctx.db.get(roomId), 'That room no longer exists.')

    const placements = await ctx.db
      .query('placements')
      .withIndex('by_room', (q) => q.eq('roomId', roomId))
      .collect()

    const names = new Map<string, string>()
    for (const p of placements) {
      if (names.has(p.tenantId)) continue
      names.set(p.tenantId, (await ctx.db.get(p.tenantId))?.name ?? '—')
    }

    return {
      room: { _id: room._id, number: room.number, floor: room.floor },
      history: placements
        .sort((a, b) => b.startedAt - a.startedAt || b._creationTime - a._creationTime)
        .map((p) => ({
          _id: p._id,
          tenantId: p.tenantId,
          name: names.get(p.tenantId) ?? '—',
          kind: p.kind,
          startedAt: p.startedAt,
          endedAt: p.endedAt ?? null,
        })),
    }
  },
})
