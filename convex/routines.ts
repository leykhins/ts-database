import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { routineKey } from './schema'
import { SHIFTS, requireCapability, requireStaff, resolveBuilding, shiftAt } from './model'

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

/**
 * How far into its own slot a round may be before the bell mentions it.
 *
 * A quarter of the interval, so an hourly round tolerates fifteen minutes and a
 * four-hourly one an hour — the same number of minutes means different things
 * at different frequencies. Announcing a round the second its hour opens would
 * produce a notification every hour of every shift, which is the fastest way to
 * make the bell worth ignoring.
 */
export function graceMinutes(everyMinutes: number): number {
  return Math.max(5, Math.round(everyMinutes / 4))
}

/* ------------------------------------------------------------------------
   Slots

   The same frequency, read as a clock rather than a stopwatch.

   "Due in 24 minutes" is the honest answer to a rolling interval, but it is
   not the question staff ask each other. They ask "did the nine o'clock round
   happen" — because a round is a thing that belongs to an hour, and a shift is
   handed over by saying which hours are accounted for. Slots make the whole
   shift legible at a glance and make a gap visible after the fact, which a
   countdown never can: once the next round is walked, a rolling interval has
   no memory that the one before it was skipped.

   Anchored to local midnight, not to the last completion, so 9pm means 9pm on
   every shift and across every site running the same frequency.
   ------------------------------------------------------------------------ */

export type SlotStatus = 'done' | 'missed' | 'now' | 'upcoming'

/**
 * The slots one shift is divided into at a given frequency.
 *
 * A trailing part-slot is dropped, the same rule the laundry room uses: 40
 * minutes is not a round, and offering it as one invites a half-walked
 * building to be signed off as complete.
 */
export function shiftSlots(
  everyMinutes: number,
  fromHour: number,
  toHour: number,
): { startMinutes: number; endMinutes: number }[] {
  const step = Math.max(15, everyMinutes)
  const slots: { startMinutes: number; endMinutes: number }[] = []
  for (let m = fromHour * 60; m + step <= toHour * 60; m += step) {
    slots.push({ startMinutes: m, endMinutes: m + step })
  }
  return slots
}

/**
 * Absolute ms for a minutes-from-local-midnight offset on a local date.
 *
 * Exported because the notification feed needs the identical arithmetic to
 * bound its query, and re-deriving it there got the month wrong — `Date.UTC`
 * takes a zero-based month, so a `YYYY-MM-DD` split straight into it lands a
 * month in the future and silently returns no completions at all.
 */
export function atLocal(shiftDate: string, minutes: number, tzOffsetMinutes: number): number {
  const [y, m, d] = shiftDate.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!, 0, minutes) + tzOffsetMinutes * 60_000
}

/**
 * A shift's slots with what happened in each.
 *
 * `missed` is only ever claimed about a slot that has already ended. A slot
 * still running is `now` however late it is inside it — the round can still be
 * walked, and calling it missed while somebody is on their way to walk it is
 * how a board starts lying.
 */
export function slotsWithStatus(
  everyMinutes: number,
  shift: { from: number; to: number },
  shiftDate: string,
  tzOffsetMinutes: number,
  completions: number[],
  now: number,
) {
  return shiftSlots(everyMinutes, shift.from, shift.to).map((slot) => {
    const startsAt = atLocal(shiftDate, slot.startMinutes, tzOffsetMinutes)
    const endsAt = atLocal(shiftDate, slot.endMinutes, tzOffsetMinutes)
    const doneAt = completions.find((ts) => ts >= startsAt && ts < endsAt) ?? null

    const status: SlotStatus = doneAt !== null
      ? 'done'
      : now >= endsAt
        ? 'missed'
        : now >= startsAt
          ? 'now'
          : 'upcoming'

    return { startMinutes: slot.startMinutes, endMinutes: slot.endMinutes, startsAt, endsAt, status, doneAt }
  })
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
  args: {
    buildingId: v.optional(v.id('buildings')),
    now: v.number(),
    tzOffsetMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx)
    const building = await resolveBuilding(ctx, staff, args.buildingId)
    if (!building) return null

    // The shift the slots belong to, in the building's local time — the same
    // segment the rest of the Care Console is built around.
    const { key: shiftKey, shiftDate } = shiftAt(args.now, args.tzOffsetMinutes)
    const shift = SHIFTS.find((s) => s.key === shiftKey)!
    const shiftStart = atLocal(shiftDate, shift.from * 60, args.tzOffsetMinutes)

    // One read for the shift, sliced per routine below, rather than a query per
    // round — three routines is three round-trips for the same rows.
    const shiftCompletions = await ctx.db
      .query('routineCompletions')
      .withIndex('by_building_completed', (q) =>
        q.eq('buildingId', building._id).gte('completedAt', shiftStart),
      )
      .collect()

    const settings = await routinesFor(ctx, building._id)
    const rows = await Promise.all(
      settings
        .filter((s) => s.enabled)
        .map(async (s) => {
          const def = BY_KEY.get(s.routine)!
          const last = await lastCompletion(ctx, building._id, s.routine)
          const by = last?.completedBy ? await ctx.db.get(last.completedBy) : null

          const slots = slotsWithStatus(
            s.everyMinutes,
            shift,
            shiftDate,
            args.tzOffsetMinutes,
            shiftCompletions
              .filter((c) => c.routine === s.routine)
              .map((c) => c.completedAt),
            args.now,
          )

          return {
            routine: s.routine,
            label: def.label,
            detail: def.detail,
            icon: def.icon,
            everyMinutes: s.everyMinutes,
            lastAt: last?.completedAt ?? null,
            lastBy: by?.name ?? null,
            slots,
            done: slots.filter((x) => x.status === 'done').length,
            missed: slots.filter((x) => x.status === 'missed').length,
            total: slots.length,
            // No rolling due-state here. The slots carry it, and shipping both
            // invites two answers to "is this late" that can disagree.
          }
        }),
    )

    /*
       Declaration order, never urgency.

       Sorting worst-first re-ordered the card every time somebody logged a
       round, so the row you had just touched jumped somewhere else and the
       next one slid under the cursor. Three fixed rounds are learned by
       position within a shift or two; the colours already carry the urgency,
       and they carry it better from a list that holds still.
    */
    const order = ROUTINES.map((r) => r.key)
    return {
      building: { _id: building._id, name: building.name },
      shift: { key: shift.key, label: shift.label, hours: shift.hours },
      rows: rows.sort((a, b) => order.indexOf(a.routine) - order.indexOf(b.routine)),
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
 * Lateness is measured against the slot being filled, not against the previous
 * completion. Those give wildly different answers and only one of them is
 * useful: a site that logged nothing all weekend would be told its Monday
 * morning round is "51 hours past due", which is true of the stopwatch and
 * says nothing about the round just walked. Inside its own hour it is on time.
 *
 * The figure is stored on the row rather than recomputed later, because later
 * the frequency may have changed and the answer would quietly become a
 * different one. A record of what happened has to keep meaning what it meant.
 */
export const complete = mutation({
  args: {
    buildingId: v.optional(v.id('buildings')),
    routine: routineKey,
    tzOffsetMinutes: v.number(),
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
    const { key: shiftKey, shiftDate } = shiftAt(now, args.tzOffsetMinutes)
    const shift = SHIFTS.find((s) => s.key === shiftKey)!

    // Which slot this walk lands in, and how far into it. A round walked at
    // 9:05 for the nine o'clock hour is on time; one walked at 9:55 is not
    // late either — it is still that hour — but the minutes are worth keeping.
    const slot = shiftSlots(setting.everyMinutes, shift.from, shift.to).find((s) => {
      const startsAt = atLocal(shiftDate, s.startMinutes, args.tzOffsetMinutes)
      const endsAt = atLocal(shiftDate, s.endMinutes, args.tzOffsetMinutes)
      return now >= startsAt && now < endsAt
    })

    const minutesIntoSlot = slot
      ? Math.floor((now - atLocal(shiftDate, slot.startMinutes, args.tzOffsetMinutes)) / 60_000)
      : 0

    await ctx.db.insert('routineCompletions', {
      buildingId: building._id,
      routine: args.routine,
      completedAt: now,
      completedBy: staff._id,
      ...(minutesIntoSlot > 0 ? { minutesLate: minutesIntoSlot } : {}),
      ...(args.note?.trim() ? { note: args.note.trim() } : {}),
    })

    return {
      label: BY_KEY.get(args.routine)?.label ?? 'Round',
      /** Null when walked outside any slot — off-shift, or a part-hour tail. */
      slotStartMinutes: slot?.startMinutes ?? null,
      minutesIntoSlot,
    }
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
