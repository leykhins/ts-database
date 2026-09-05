import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { meal } from './schema'
import { requireCapability, requireStaff, resolveBuilding } from './model'
import { ROUTINES, routinesFor } from './routines'

/**
 * How one building runs: meal sittings, laundry hours, supply limits.
 *
 * Every site does this differently — one serves dinner at 4:30 because the
 * kitchen closes, another runs laundry until 10pm. Hard-coding any of it means
 * the second site quietly stops using the screen.
 *
 * Times are minutes from midnight. Comparable without parsing, and there is
 * exactly one place (`formatMinutes`, on the client) that turns them into
 * something a person reads.
 */

/** What a site gets before anyone configures it. */
export const DEFAULTS: {
  meals: {
    meal: 'breakfast' | 'lunch' | 'dinner'
    menu: string
    fromMinutes: number
    toMinutes: number
    served: boolean
  }[]
  laundry: {
    fromMinutes: number
    toMinutes: number
    slotMinutes: number
    maxPerResidentPerWeek: number
  }
  supplyLimits: Record<string, number>
} = {
  meals: [
    { meal: 'breakfast', menu: '', fromMinutes: 7 * 60 + 30, toMinutes: 9 * 60, served: true },
    { meal: 'lunch', menu: '', fromMinutes: 12 * 60, toMinutes: 13 * 60 + 30, served: true },
    { meal: 'dinner', menu: '', fromMinutes: 17 * 60, toMinutes: 18 * 60 + 30, served: true },
  ],
  laundry: {
    fromMinutes: 8 * 60,
    toMinutes: 20 * 60,
    slotMinutes: 120,
    maxPerResidentPerWeek: 2,
  },
  supplyLimits: {
    'bubble-pipe': 1,
    'stem-pipe': 1,
    foil: 0,
    'needle-kit': 0,
    naloxone: 0,
    other: 0,
  },
}

export type MealSitting = {
  meal: 'breakfast' | 'lunch' | 'dinner'
  menu?: string
  fromMinutes: number
  toMinutes: number
  served: boolean
}

export type SiteSettings = {
  meals: MealSitting[]
  laundry: typeof DEFAULTS.laundry
  supplyLimits: Record<string, number>
}

/** Settings for a building, with the defaults filled in for anything unset. */
export async function settingsFor(
  ctx: QueryCtx | MutationCtx,
  buildingId: Id<'buildings'>,
): Promise<SiteSettings> {
  const row = await ctx.db
    .query('siteSettings')
    .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
    .unique()

  return {
    meals: row?.meals?.length ? row.meals : DEFAULTS.meals,
    laundry: row?.laundry ?? DEFAULTS.laundry,
    supplyLimits: { ...DEFAULTS.supplyLimits, ...(row?.supplyLimits ?? {}) },
  }
}

/** The slots a laundry day is divided into, from the site's own hours. */
export function laundrySlots(laundry: SiteSettings['laundry']) {
  const slots: { startMinutes: number; endMinutes: number }[] = []
  const span = Math.max(15, laundry.slotMinutes)

  for (let start = laundry.fromMinutes; start + span <= laundry.toMinutes; start += span) {
    slots.push({ startMinutes: start, endMinutes: start + span })
  }
  return slots
}

export const get = query({
  args: { buildingId: v.optional(v.id('buildings')) },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx)
    const building = await resolveBuilding(ctx, staff, args.buildingId)
    if (!building) return null

    const settings = await settingsFor(ctx, building._id)
    return {
      building: { _id: building._id, name: building.name },
      ...settings,
      slots: laundrySlots(settings.laundry),
      // Every round, including the ones this site has switched off — the board
      // shows only what is running, but the settings screen has to be able to
      // turn one back on.
      routines: (await routinesFor(ctx, building._id)).map((r) => ({
        ...r,
        label: ROUTINES.find((def) => def.key === r.routine)!.label,
        detail: ROUTINES.find((def) => def.key === r.routine)!.detail,
        icon: ROUTINES.find((def) => def.key === r.routine)!.icon,
      })),
    }
  },
})

async function rowFor(ctx: MutationCtx, buildingId: Id<'buildings'>): Promise<Doc<'siteSettings'> | null> {
  return await ctx.db
    .query('siteSettings')
    .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
    .unique()
}

export const setMeals = mutation({
  args: {
    buildingId: v.id('buildings'),
    meals: v.array(
      v.object({
        meal,
        menu: v.optional(v.string()),
        fromMinutes: v.number(),
        toMinutes: v.number(),
        served: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'site-config')

    for (const sitting of args.meals) {
      if (sitting.toMinutes <= sitting.fromMinutes) {
        throw new Error(`${sitting.meal} has to end after it starts.`)
      }
    }

    const row = await rowFor(ctx, args.buildingId)
    const meals = args.meals.map((m) => ({ ...m, menu: m.menu?.trim() || undefined }))

    if (row) await ctx.db.patch(row._id, { meals })
    else await ctx.db.insert('siteSettings', { buildingId: args.buildingId, meals })
    return null
  },
})

export const setLaundry = mutation({
  args: {
    buildingId: v.id('buildings'),
    fromMinutes: v.number(),
    toMinutes: v.number(),
    slotMinutes: v.number(),
    maxPerResidentPerWeek: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'site-config')

    if (args.toMinutes <= args.fromMinutes) {
      throw new Error('The laundry room has to close after it opens.')
    }
    if (args.slotMinutes < 15) throw new Error('A slot has to be at least 15 minutes.')
    if (args.slotMinutes > args.toMinutes - args.fromMinutes) {
      throw new Error('A slot cannot be longer than the day the laundry room is open.')
    }
    if (args.maxPerResidentPerWeek < 0) throw new Error('The weekly cap cannot be negative.')

    const laundry = {
      fromMinutes: args.fromMinutes,
      toMinutes: args.toMinutes,
      slotMinutes: args.slotMinutes,
      maxPerResidentPerWeek: args.maxPerResidentPerWeek,
    }

    const row = await rowFor(ctx, args.buildingId)
    if (row) await ctx.db.patch(row._id, { laundry })
    else await ctx.db.insert('siteSettings', { buildingId: args.buildingId, laundry })
    return null
  },
})

export const setSupplyLimits = mutation({
  args: {
    buildingId: v.id('buildings'),
    supplyLimits: v.record(v.string(), v.number()),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'site-config')

    for (const [item, limit] of Object.entries(args.supplyLimits)) {
      if (!Number.isInteger(limit) || limit < 0) {
        throw new Error(`The daily limit for ${item} must be a whole number, or 0 for no cap.`)
      }
    }

    const row = await rowFor(ctx, args.buildingId)
    if (row) await ctx.db.patch(row._id, { supplyLimits: args.supplyLimits })
    else await ctx.db.insert('siteSettings', { buildingId: args.buildingId, supplyLimits: args.supplyLimits })
    return null
  },
})
