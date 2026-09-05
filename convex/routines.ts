import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { routineKey } from './schema'
import { requireCapability, requireStaff, resolveBuilding } from './model'

/**
 * The rounds a shift repeats on the clock: building rounds, the perimeter,
 * medication.
 *
 * Nothing here schedules anything. A round is due because the interval has
 * elapsed since it was last walked, and that is worked out when someone looks.
 * The alternative — a cron writing "rounds due at 21:00" rows — creates a queue
 * of expectations that has to be cleaned up whenever a site changes its
 * frequency, whenever a building closes, whenever the power goes out. This way
 * the only durable fact is the one worth keeping: somebody walked it, at this
 * time.
 */

export type RoutineKey = 'rounds' | 'perimeter' | 'meds'

export const ROUTINES: {
  key: RoutineKey
  label: string
  /** What the round actually covers — shown under the name, not in a manual. */
  detail: string
  icon: string
  everyMinutes: number
}[] = [
  {
    key: 'rounds',
    label: 'Building rounds',
    detail: 'Every floor, stairwells and common areas.',
    icon: 'clipboard-check',
    everyMinutes: 60,
  },
  {
    key: 'perimeter',
    label: 'Perimeter check',
    detail: 'Doors, alley, loading bay and the lane.',
    icon: 'shield-check',
    everyMinutes: 120,
  },
  {
    key: 'meds',
    label: 'Medication dispensation',
    detail: 'Residents on a dispensing schedule.',
    icon: 'heart-pulse',
    everyMinutes: 240,
  },
]

const BY_KEY = new Map(ROUTINES.map((r) => [r.key, r]))

export type RoutineSetting = { routine: RoutineKey; everyMinutes: number; enabled: boolean }

/** A site's frequencies, with the defaults filled in for anything unset. */
export async function routinesFor(
  ctx: QueryCtx | MutationCtx,
  buildingId: Id<'buildings'>,
): Promise<RoutineSetting[]> {
  const row = await ctx.db
    .query('siteSettings')
    .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
    .unique()

  return ROUTINES.map((def) => {
    const set = row?.routines?.find((r) => r.routine === def.key)
    return {
      routine: def.key,
      everyMinutes: set?.everyMinutes ?? def.everyMinutes,
      enabled: set?.enabled ?? true,
    }
  })
}

export type DueState = 'ok' | 'due' | 'overdue'

/**
 * Where a round stands right now.
 *
 * Three states rather than two because "due" and "late" are different
 * instructions. A round that came due four minutes ago is the next thing to do;
 * one that came due forty minutes ago is a thing that was missed, and a board
 * that shows both in the same red teaches people to ignore the red.
 *
 * A round that has never been logged is `due`, not `overdue` — a site's first
 * morning on the system has not missed anything.
 */
export function dueState(
  everyMinutes: number,
  lastAt: number | null,
  now: number,
): { status: DueState; dueAt: number; minutesLate: number } {
  if (lastAt === null) return { status: 'due', dueAt: now, minutesLate: 0 }

  const dueAt = lastAt + everyMinutes * 60_000
  const minutesLate = Math.max(0, Math.floor((now - dueAt) / 60_000))
  // A quarter of the interval, so an hourly round tolerates 15 minutes and a
  // four-hourly one an hour — the same lateness means different things.
  const grace = Math.max(5, Math.round(everyMinutes / 4))

  if (now < dueAt) return { status: 'ok', dueAt, minutesLate: 0 }
  if (minutesLate < grace) return { status: 'due', dueAt, minutesLate }
  return { status: 'overdue', dueAt, minutesLate }
}

async function lastCompletion(
  ctx: QueryCtx | MutationCtx,
  buildingId: Id<'buildings'>,
  routine: RoutineKey,
): Promise<Doc<'routineCompletions'> | null> {
  return await ctx.db
    .query('routineCompletions')
    .withIndex('by_building_routine', (q) =>
      q.eq('buildingId', buildingId).eq('routine', routine),
    )
    .order('desc')
    .first()
}

/**
 * Every round this site runs, worst first.
 *
 * `now` comes from the client so the board moves while somebody is looking at
 * it — a Convex query is reactive to data, not to the passing of time, and a
 * board of due times that only updates when a row changes is a board that says
 * "on time" for an hour after it stopped being true.
 */
export const board = query({
  args: { buildingId: v.optional(v.id('buildings')), now: v.number() },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx)
    const building = await resolveBuilding(ctx, staff, args.buildingId)
    if (!building) return null

    const settings = await routinesFor(ctx, building._id)
    const rows = await Promise.all(
      settings
        .filter((s) => s.enabled)
        .map(async (s) => {
          const def = BY_KEY.get(s.routine)!
          const last = await lastCompletion(ctx, building._id, s.routine)
          const by = last?.completedBy ? await ctx.db.get(last.completedBy) : null
          return {
            routine: s.routine,
            label: def.label,
            detail: def.detail,
            icon: def.icon,
            everyMinutes: s.everyMinutes,
            lastAt: last?.completedAt ?? null,
            lastBy: by?.name ?? null,
            ...dueState(s.everyMinutes, last?.completedAt ?? null, args.now),
          }
        }),
    )

    const rank: Record<DueState, number> = { overdue: 0, due: 1, ok: 2 }
    return {
      building: { _id: building._id, name: building.name },
      rows: rows.sort((a, b) => rank[a.status] - rank[b.status] || a.dueAt - b.dueAt),
    }
  },
})

/** The last day of rounds, for a shift report or a manager reading back. */
export const history = query({
  args: {
    buildingId: v.optional(v.id('buildings')),
    since: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx)
    const building = await resolveBuilding(ctx, staff, args.buildingId)
    if (!building) return null

    const rows = await ctx.db
      .query('routineCompletions')
      .withIndex('by_building_completed', (q) =>
        q.eq('buildingId', building._id).gte('completedAt', args.since),
      )
      .order('desc')
      .take(200)

    const names = new Map<string, string>()
    for (const row of rows) {
      if (!row.completedBy || names.has(row.completedBy)) continue
      const user = await ctx.db.get(row.completedBy)
      if (user?.name) names.set(row.completedBy, user.name)
    }

    return rows.map((row) => ({
      _id: row._id,
      routine: row.routine,
      label: BY_KEY.get(row.routine as RoutineKey)?.label ?? row.routine,
      completedAt: row.completedAt,
      completedBy: row.completedBy ? (names.get(row.completedBy) ?? null) : null,
      minutesLate: row.minutesLate ?? 0,
      note: row.note ?? null,
    }))
  },
})

/**
 * Log a round as walked.
 *
 * How late it was is stored on the row rather than recomputed later, because
 * later the frequency may have changed and the answer would quietly become a
 * different one. A record of what happened has to keep meaning what it meant.
 */
export const complete = mutation({
  args: {
    buildingId: v.optional(v.id('buildings')),
    routine: routineKey,
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'checks')
    const building = await resolveBuilding(ctx, staff, args.buildingId)
    if (!building) throw new Error('No building to log a round against.')

    const settings = await routinesFor(ctx, building._id)
    const setting = settings.find((s) => s.routine === args.routine)
    if (!setting?.enabled) {
      throw new Error(`${BY_KEY.get(args.routine)?.label ?? 'That round'} is turned off at this site.`)
    }

    const now = Date.now()
    const last = await lastCompletion(ctx, building._id, args.routine)
    const { minutesLate } = dueState(setting.everyMinutes, last?.completedAt ?? null, now)

    await ctx.db.insert('routineCompletions', {
      buildingId: building._id,
      routine: args.routine,
      completedAt: now,
      completedBy: staff._id,
      ...(minutesLate > 0 ? { minutesLate } : {}),
      ...(args.note?.trim() ? { note: args.note.trim() } : {}),
    })

    return { label: BY_KEY.get(args.routine)?.label ?? 'Round', minutesLate }
  },
})

/** How often each round comes due here. Site managers set this, not the desk. */
export const setRoutines = mutation({
  args: {
    buildingId: v.id('buildings'),
    routines: v.array(
      v.object({ routine: routineKey, everyMinutes: v.number(), enabled: v.boolean() }),
    ),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'site-config')
    const building = await resolveBuilding(ctx, staff, args.buildingId)
    if (!building) throw new Error('That building no longer exists.')

    for (const r of args.routines) {
      if (!Number.isInteger(r.everyMinutes) || r.everyMinutes < 15) {
        throw new Error('A round cannot come due more often than every 15 minutes.')
      }
      if (r.everyMinutes > 24 * 60) {
        throw new Error('A round that comes due less than once a day is not a round.')
      }
    }

    const row = await ctx.db
      .query('siteSettings')
      .withIndex('by_building', (q) => q.eq('buildingId', args.buildingId))
      .unique()

    if (row) await ctx.db.patch(row._id, { routines: args.routines })
    else await ctx.db.insert('siteSettings', { buildingId: args.buildingId, routines: args.routines })
    return null
  },
})
