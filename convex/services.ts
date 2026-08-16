import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { meal, supplyItem, wheeledKind } from './schema'
import {
  localDate,
  photoUrlsFor,
  requireCapability,
  requireStaff,
  resolveBuilding,
} from './model'
import { laundrySlots, settingsFor } from './settings'

/**
 * The services a building runs day to day: meals, the laundry room, harm
 * reduction supplies, the bike room and the pets.
 *
 * They share a shape — a resident, a moment, and a rule about how often — so
 * they share a file. Each rule lives on the server: a daily supply cap that
 * only the form enforces is not a cap, it is a suggestion.
 */

/** Residents currently housed, with room and face, in the order staff walk. */
async function occupants(ctx: Parameters<typeof settingsFor>[0], buildingId: Id<'buildings'>) {
  const [tenants, rooms] = await Promise.all([
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
  ])

  const roomById = new Map(rooms.map((r) => [r._id as string, r]))
  const photos = await photoUrlsFor(ctx, tenants)

  return tenants
    .map((tenant) => ({
      tenantId: tenant._id,
      name: tenant.name,
      room: tenant.roomId ? (roomById.get(tenant.roomId)?.number ?? '—') : '—',
      photoUrl: photos.get(tenant._id) ?? null,
      supportLevel: tenant.supportLevel,
    }))
    .sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }))
}

/* ------------------------------------------------------------------------
   Meals
   ------------------------------------------------------------------------ */

export const meals = query({
  args: {
    buildingId: v.optional(v.id('buildings')),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    await requireStaff(ctx)
    const building = await resolveBuilding(ctx, args.buildingId)
    if (!building) return null

    const settings = await settingsFor(ctx, building._id)
    const residents = await occupants(ctx, building._id)

    const sittings = await Promise.all(
      settings.meals
        .filter((sitting) => sitting.served)
        .map(async (sitting) => {
          const served = await ctx.db
            .query('mealServices')
            .withIndex('by_building_date_meal', (q) =>
              q.eq('buildingId', building._id).eq('date', args.date).eq('meal', sitting.meal),
            )
            .collect()

          const servedIds = new Set(served.map((row) => row.tenantId as string))
          return {
            ...sitting,
            servedCount: servedIds.size,
            servedIds: [...servedIds],
          }
        }),
    )

    return {
      building: { _id: building._id, name: building.name },
      date: args.date,
      sittings,
      residents,
      total: residents.length,
    }
  },
})

/**
 * Tick or untick a resident on a sitting. A toggle rather than two mutations:
 * the checklist is the state, and mis-ticking somebody happens constantly.
 */
export const setMealServed = mutation({
  args: {
    buildingId: v.id('buildings'),
    tenantId: v.id('tenants'),
    date: v.string(),
    meal,
    served: v.boolean(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'wellness')

    const existing = (
      await ctx.db
        .query('mealServices')
        .withIndex('by_building_date_meal', (q) =>
          q.eq('buildingId', args.buildingId).eq('date', args.date).eq('meal', args.meal),
        )
        .collect()
    ).filter((row) => row.tenantId === args.tenantId)

    if (args.served) {
      if (existing.length) return null
      await ctx.db.insert('mealServices', {
        buildingId: args.buildingId,
        tenantId: args.tenantId,
        date: args.date,
        meal: args.meal,
        servedAt: args.now,
        servedBy: staff._id,
      })
    } else {
      for (const row of existing) await ctx.db.delete(row._id)
    }
    return null
  },
})

/* ------------------------------------------------------------------------
   Laundry
   ------------------------------------------------------------------------ */

export const laundry = query({
  args: { buildingId: v.optional(v.id('buildings')), date: v.string() },
  handler: async (ctx, args) => {
    await requireStaff(ctx)
    const building = await resolveBuilding(ctx, args.buildingId)
    if (!building) return null

    const settings = await settingsFor(ctx, building._id)
    const residents = await occupants(ctx, building._id)
    const byTenant = new Map(residents.map((r) => [r.tenantId as string, r]))

    const bookings = await ctx.db
      .query('laundryBookings')
      .withIndex('by_building_date', (q) =>
        q.eq('buildingId', building._id).eq('date', args.date),
      )
      .collect()

    const slots = laundrySlots(settings.laundry).map((slot) => {
      const booking = bookings.find((b) => b.startMinutes === slot.startMinutes)
      const resident = booking ? byTenant.get(booking.tenantId) : undefined
      return {
        ...slot,
        booking: booking
          ? {
              _id: booking._id,
              tenantId: booking.tenantId,
              name: resident?.name ?? 'Former resident',
              room: resident?.room ?? '—',
              photoUrl: resident?.photoUrl ?? null,
              note: booking.note ?? null,
            }
          : null,
      }
    })

    return {
      building: { _id: building._id, name: building.name },
      date: args.date,
      laundry: settings.laundry,
      slots,
      residents,
      booked: bookings.length,
    }
  },
})

export const bookLaundry = mutation({
  args: {
    buildingId: v.id('buildings'),
    tenantId: v.id('tenants'),
    date: v.string(),
    startMinutes: v.number(),
    note: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'wellness')

    const settings = await settingsFor(ctx, args.buildingId)
    const slot = laundrySlots(settings.laundry).find((s) => s.startMinutes === args.startMinutes)
    if (!slot) throw new Error('That is not a slot the laundry room runs.')

    const sameDay = await ctx.db
      .query('laundryBookings')
      .withIndex('by_building_date', (q) =>
        q.eq('buildingId', args.buildingId).eq('date', args.date),
      )
      .collect()

    if (sameDay.some((b) => b.startMinutes === args.startMinutes)) {
      throw new Error('That slot is already taken.')
    }
    if (sameDay.some((b) => b.tenantId === args.tenantId)) {
      throw new Error('That resident already has a slot today.')
    }

    // The weekly cap counts the seven days ending on the booked date.
    const cap = settings.laundry.maxPerResidentPerWeek
    if (cap > 0) {
      const start = new Date(`${args.date}T00:00:00Z`)
      start.setUTCDate(start.getUTCDate() - 6)
      const from = start.toISOString().slice(0, 10)

      const recent = await ctx.db
        .query('laundryBookings')
        .withIndex('by_tenant_date', (q) =>
          q.eq('tenantId', args.tenantId).gte('date', from).lte('date', args.date),
        )
        .collect()

      if (recent.length >= cap) {
        throw new Error(
          `That resident already has ${recent.length} slot${recent.length === 1 ? '' : 's'} this week — the cap is ${cap}.`,
        )
      }
    }

    return await ctx.db.insert('laundryBookings', {
      buildingId: args.buildingId,
      tenantId: args.tenantId,
      date: args.date,
      startMinutes: slot.startMinutes,
      endMinutes: slot.endMinutes,
      note: args.note?.trim() || undefined,
      bookedAt: args.now,
      bookedBy: staff._id,
    })
  },
})

export const cancelLaundry = mutation({
  args: { bookingId: v.id('laundryBookings') },
  handler: async (ctx, { bookingId }) => {
    await requireCapability(ctx, 'wellness')
    await ctx.db.delete(bookingId)
    return null
  },
})

/* ------------------------------------------------------------------------
   Harm-reduction supplies
   ------------------------------------------------------------------------ */

export const SUPPLY_LABEL: Record<string, string> = {
  'bubble-pipe': 'Bubble pipe',
  'stem-pipe': 'Stem pipe',
  foil: 'Foil',
  'needle-kit': 'Needle kit',
  naloxone: 'Naloxone kit',
  other: 'Other',
}

export const supplies = query({
  args: { buildingId: v.optional(v.id('buildings')), date: v.string() },
  handler: async (ctx, args) => {
    await requireStaff(ctx)
    const building = await resolveBuilding(ctx, args.buildingId)
    if (!building) return null

    const settings = await settingsFor(ctx, building._id)
    const residents = await occupants(ctx, building._id)
    const byTenant = new Map(residents.map((r) => [r.tenantId as string, r]))

    const issued = await ctx.db
      .query('supplyIssues')
      .withIndex('by_building_date', (q) =>
        q.eq('buildingId', building._id).eq('date', args.date),
      )
      .collect()

    const staffIds = [...new Set(issued.map((row) => row.issuedBy).filter(Boolean))]
    const people = await Promise.all(staffIds.map((id) => ctx.db.get(id as Id<'users'>)))
    const nameById = new Map(people.filter(Boolean).map((p) => [p!._id as string, p!.name]))

    /** How many of an item a resident has had today. */
    const takenBy = (tenantId: string, item: string) =>
      issued.filter((row) => row.tenantId === tenantId && row.item === item).length

    return {
      building: { _id: building._id, name: building.name },
      date: args.date,
      limits: settings.supplyLimits,
      items: Object.keys(SUPPLY_LABEL).map((item) => ({
        item,
        label: SUPPLY_LABEL[item]!,
        limit: settings.supplyLimits[item] ?? 0,
        issuedToday: issued.filter((row) => row.item === item).length,
      })),
      residents: residents.map((resident) => ({
        ...resident,
        taken: Object.fromEntries(
          Object.keys(SUPPLY_LABEL).map((item) => [item, takenBy(resident.tenantId, item)]),
        ),
      })),
      log: issued
        .sort((a, b) => b.issuedAt - a.issuedAt)
        .slice(0, 40)
        .map((row) => ({
          _id: row._id,
          item: row.item,
          label: SUPPLY_LABEL[row.item] ?? row.item,
          issuedAt: row.issuedAt,
          name: byTenant.get(row.tenantId)?.name ?? 'Former resident',
          room: byTenant.get(row.tenantId)?.room ?? '—',
          by: row.issuedBy ? (nameById.get(row.issuedBy) ?? null) : null,
          note: row.note ?? null,
        })),
    }
  },
})

export const issueSupply = mutation({
  args: {
    buildingId: v.id('buildings'),
    tenantId: v.id('tenants'),
    item: supplyItem,
    date: v.string(),
    note: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'wellness')

    const settings = await settingsFor(ctx, args.buildingId)
    const limit = settings.supplyLimits[args.item] ?? 0

    if (limit > 0) {
      const today = await ctx.db
        .query('supplyIssues')
        .withIndex('by_tenant_date', (q) =>
          q.eq('tenantId', args.tenantId).eq('date', args.date),
        )
        .collect()

      const taken = today.filter((row) => row.item === args.item).length
      if (taken >= limit) {
        throw new Error(
          `${SUPPLY_LABEL[args.item] ?? args.item}: ${taken} already issued today, and the site's limit is ${limit}.`,
        )
      }
    }

    return await ctx.db.insert('supplyIssues', {
      buildingId: args.buildingId,
      tenantId: args.tenantId,
      item: args.item,
      date: args.date,
      issuedAt: args.now,
      issuedBy: staff._id,
      note: args.note?.trim() || undefined,
    })
  },
})

/* ------------------------------------------------------------------------
   The bike room
   ------------------------------------------------------------------------ */

export const wheeled = query({
  args: { buildingId: v.optional(v.id('buildings')) },
  handler: async (ctx, args) => {
    await requireStaff(ctx)
    const building = await resolveBuilding(ctx, args.buildingId)
    if (!building) return null

    const residents = await occupants(ctx, building._id)
    const byTenant = new Map(residents.map((r) => [r.tenantId as string, r]))

    const movements = await ctx.db
      .query('wheeledMovements')
      .withIndex('by_building_in', (q) => q.eq('buildingId', building._id))
      .order('desc')
      .take(60)

    const row = (m: Doc<'wheeledMovements'>) => ({
      _id: m._id,
      tenantId: m.tenantId,
      name: byTenant.get(m.tenantId)?.name ?? 'Former resident',
      room: byTenant.get(m.tenantId)?.room ?? '—',
      photoUrl: byTenant.get(m.tenantId)?.photoUrl ?? null,
      kind: m.kind,
      description: m.description,
      signedInAt: m.signedInAt,
      signedOutAt: m.signedOutAt ?? null,
    })

    return {
      building: { _id: building._id, name: building.name },
      // What is in the building right now is the question staff actually ask.
      inside: movements.filter((m) => !m.signedOutAt).map(row),
      history: movements.filter((m) => m.signedOutAt).map(row),
      residents,
      /** Last machine each resident brought in, to pre-fill the form. */
      known: Object.fromEntries(
        residents.map((r) => {
          const last = movements.find((m) => m.tenantId === r.tenantId)
          return [r.tenantId, last ? { kind: last.kind, description: last.description } : null]
        }),
      ),
    }
  },
})

export const signInWheeled = mutation({
  args: {
    buildingId: v.id('buildings'),
    tenantId: v.id('tenants'),
    kind: wheeledKind,
    description: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'wellness')

    if (!args.description.trim()) {
      throw new Error('Describe the machine — a brand and a colour is enough to tell two apart.')
    }

    return await ctx.db.insert('wheeledMovements', {
      buildingId: args.buildingId,
      tenantId: args.tenantId,
      kind: args.kind,
      description: args.description.trim(),
      signedInAt: args.now,
      signedInBy: staff._id,
    })
  },
})

export const signOutWheeled = mutation({
  args: { movementId: v.id('wheeledMovements'), now: v.number() },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'wellness')

    const movement = await ctx.db.get(args.movementId)
    if (!movement) throw new Error('That entry is no longer on file.')
    if (movement.signedOutAt) throw new Error('That machine has already been signed out.')

    await ctx.db.patch(args.movementId, { signedOutAt: args.now, signedOutBy: staff._id })
    return null
  },
})

/* ------------------------------------------------------------------------
   Pets
   ------------------------------------------------------------------------ */

export const petRoster = query({
  args: { buildingId: v.optional(v.id('buildings')), now: v.number() },
  handler: async (ctx, args) => {
    await requireStaff(ctx)
    const building = await resolveBuilding(ctx, args.buildingId)
    if (!building) return null

    const residents = await occupants(ctx, building._id)
    const byTenant = new Map(residents.map((r) => [r.tenantId as string, r]))

    const animals = (
      await ctx.db
        .query('pets')
        .withIndex('by_building', (q) => q.eq('buildingId', building._id))
        .collect()
    ).filter((pet) => !pet.retiredAt)

    const sightings = await Promise.all(
      animals.map((pet) =>
        ctx.db
          .query('petSightings')
          .withIndex('by_pet_seen', (q) => q.eq('petId', pet._id))
          .order('desc')
          .take(1),
      ),
    )

    const DAY = 86_400_000

    return {
      building: { _id: building._id, name: building.name },
      residents,
      pets: animals
        .map((pet, i) => {
          const last = sightings[i]?.[0] ?? null
          const daysSince = last ? Math.floor((args.now - last.seenAt) / DAY) : null
          return {
            _id: pet._id,
            name: pet.name,
            kind: pet.kind,
            description: pet.description ?? null,
            tenantId: pet.tenantId ?? null,
            owner: pet.tenantId ? (byTenant.get(pet.tenantId)?.name ?? 'Former resident') : null,
            room: pet.tenantId ? (byTenant.get(pet.tenantId)?.room ?? '—') : '—',
            lastSeenAt: last?.seenAt ?? null,
            lastSeenNote: last?.note ?? null,
            daysSince,
            // A pet nobody has laid eyes on for two days is worth a knock.
            overdue: daysSince === null || daysSince >= 2,
          }
        })
        .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.name.localeCompare(b.name)),
    }
  },
})

export const addPet = mutation({
  args: {
    buildingId: v.id('buildings'),
    tenantId: v.optional(v.id('tenants')),
    name: v.string(),
    kind: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, 'wellness')

    if (!args.name.trim()) throw new Error('Give the animal a name.')
    if (!args.kind.trim()) throw new Error('Say what kind of animal it is.')

    return await ctx.db.insert('pets', {
      buildingId: args.buildingId,
      tenantId: args.tenantId,
      name: args.name.trim(),
      kind: args.kind.trim(),
      description: args.description?.trim() || undefined,
    })
  },
})

export const retirePet = mutation({
  args: { petId: v.id('pets'), now: v.number() },
  handler: async (ctx, args) => {
    await requireCapability(ctx, 'wellness')
    await ctx.db.patch(args.petId, { retiredAt: args.now })
    return null
  },
})

export const logPetSighting = mutation({
  args: { petId: v.id('pets'), note: v.optional(v.string()), now: v.number() },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'wellness')

    const pet = await ctx.db.get(args.petId)
    if (!pet) throw new Error('That animal is no longer on the roster.')

    return await ctx.db.insert('petSightings', {
      petId: args.petId,
      buildingId: pet.buildingId,
      seenAt: args.now,
      seenBy: staff._id,
      note: args.note?.trim() || undefined,
    })
  },
})

/** Today, in the building's local time — the default date every screen opens on. */
export const today = query({
  args: { now: v.number(), tzOffsetMinutes: v.number() },
  handler: async (ctx, args) => {
    await requireStaff(ctx)
    return localDate(args.now, args.tzOffsetMinutes)
  },
})
