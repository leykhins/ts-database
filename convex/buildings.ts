import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import {
  assertBuildingAccess,
  assignedBuildings,
  requireAdmin,
  requireBuildingConfig,
  requireCapability,
  requireStaff,
} from './model'

/** The buildings this person covers. Drives the switcher and every picker. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const staff = await requireStaff(ctx)
    const buildings = await assignedBuildings(ctx, staff)

    return await Promise.all(
      buildings.map(async (b) => {
        const occupied = await ctx.db
          .query('tenants')
          .withIndex('by_building_status', (q) =>
            q.eq('buildingId', b._id).eq('status', 'current'),
          )
          .collect()
        return {
          _id: b._id,
          name: b.name,
          slug: b.slug,
          address: b.address,
          units: b.units,
          occupied: occupied.length,
        }
      }),
    )
  },
})

export const get = query({
  args: { buildingId: v.id('buildings') },
  handler: async (ctx, { buildingId }) => {
    const staff = await requireStaff(ctx)
    assertBuildingAccess(staff, buildingId)
    return await ctx.db.get(buildingId)
  },
})

/**
 * Admin view of the portfolio: one row per building with the counts an
 * administrator needs to decide whether it is safe to rename or remove it.
 */
export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    // A building manager sees the sites they run; an administrator sees the
    // portfolio. Same screen, scoped list.
    const staff = await requireCapability(ctx, 'building-config')
    const buildings = await assignedBuildings(ctx, staff)

    return await Promise.all(
      buildings.map(async (b) => {
        const [rooms, tenants] = await Promise.all([
          ctx.db
            .query('rooms')
            .withIndex('by_building', (q) => q.eq('buildingId', b._id))
            .collect(),
          ctx.db
            .query('tenants')
            .withIndex('by_building', (q) => q.eq('buildingId', b._id))
            .collect(),
        ])
        return {
          ...b,
          roomCount: rooms.length,
          outOfService: rooms.filter((r) => r.outOfService).length,
          tenantCount: tenants.length,
          currentTenants: tenants.filter((t) => t.status === 'current').length,
        }
      }),
    )
  },
})

/** URL-safe identifier derived from the name, kept unique across buildings. */
async function uniqueSlug(
  ctx: MutationCtx,
  name: string,
  ignore?: Id<'buildings'>,
): Promise<string> {
  const base
    = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'building'

  for (let attempt = 0; ; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
    const clash = await ctx.db
      .query('buildings')
      .withIndex('by_slug', (q) => q.eq('slug', candidate))
      .unique()
    if (!clash || clash._id === ignore) return candidate
  }
}

export const create = mutation({
  args: {
    name: v.string(),
    address: v.optional(v.string()),
    units: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx)

    const name = args.name.trim()
    if (!name) throw new Error('Give the building a name.')
    if (!Number.isInteger(args.units) || args.units < 0) {
      throw new Error('Unit count must be a whole number.')
    }

    return await ctx.db.insert('buildings', {
      name,
      slug: await uniqueSlug(ctx, name),
      address: args.address?.trim() || undefined,
      units: args.units,
    })
  },
})

export const update = mutation({
  args: {
    buildingId: v.id('buildings'),
    name: v.string(),
    address: v.optional(v.string()),
    units: v.number(),
  },
  handler: async (ctx, args) => {
    // Editing a building's own details is building fabric, not portfolio
    // configuration — a manager may rename the site they run, and only that
    // one. Creating and removing buildings below stays with the administrator.
    await requireBuildingConfig(ctx, args.buildingId)

    const building = await ctx.db.get(args.buildingId)
    if (!building) throw new Error('That building no longer exists.')

    const name = args.name.trim()
    if (!name) throw new Error('Give the building a name.')
    if (!Number.isInteger(args.units) || args.units < 0) {
      throw new Error('Unit count must be a whole number.')
    }

    await ctx.db.patch(args.buildingId, {
      name,
      slug:
        name === building.name
          ? building.slug
          : await uniqueSlug(ctx, name, args.buildingId),
      address: args.address?.trim() || undefined,
      units: args.units,
    })
    return null
  },
})

/**
 * Removing a building is only allowed while it is empty. Cascading the delete
 * would take the rent ledger and the check history with it — records this
 * building is required to keep — so the server refuses and says what is in the
 * way instead.
 */
export const remove = mutation({
  args: { buildingId: v.id('buildings') },
  handler: async (ctx, { buildingId }) => {
    await requireAdmin(ctx)

    const building = await ctx.db.get(buildingId)
    if (!building) throw new Error('That building no longer exists.')

    const tenants = await ctx.db
      .query('tenants')
      .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
      .take(1)
    if (tenants.length > 0) {
      throw new Error(
        'This building still has tenant records. Move or exit them before removing it.',
      )
    }

    const rooms = await ctx.db
      .query('rooms')
      .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
      .collect()
    for (const room of rooms) await ctx.db.delete(room._id)

    // Strip the building from every staff assignment. A dangling id is a
    // permission nobody can see in the UI and nobody can revoke.
    for (const user of await ctx.db.query('users').collect()) {
      if (!user.assignedBuildingIds?.includes(buildingId)) continue
      await ctx.db.patch(user._id, {
        assignedBuildingIds: user.assignedBuildingIds.filter((id) => id !== buildingId),
      })
    }

    await ctx.db.delete(buildingId)
    return null
  },
})
