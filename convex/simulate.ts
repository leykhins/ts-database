import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { SHIFTS, localDate, shiftAt } from './model'
import { atLocal, routinesFor, shiftSlots } from './routines'

/**
 * Demo activity.
 *
 * A building nobody has checked looks identical to a building nobody is
 * responsible for: every resident flagged, every round red, the wellness index
 * pinned at its floor. That state is honest about the fixtures and useless for
 * judging the screens, because every list degenerates into the whole roster.
 * This writes the shift activity a staffed building would produce.
 *
 * ---------------------------------------------------------------------------
 * TWO THINGS HOLD THIS SAFE, AND BOTH MATTER
 *
 * **It is off unless a deployment opts in.** `DEMO_SIMULATION` must be exactly
 * `1`. These are fabricated care records — a note saying somebody laid eyes on
 * a resident at 9pm when nobody did. In a deployment holding real tenancies
 * that is not test data, it is a false entry in a care record, so the default
 * everywhere is off and turning it on is a deliberate per-deployment act.
 *
 * **It is deterministic.** Whether a resident is skipped on a shift comes from
 * a hash of their id and that shift, never from `Math.random()`. The tick runs
 * every fifteen minutes; with real randomness the same resident would flip
 * between seen and missed on consecutive ticks and the flagged list would
 * reshuffle itself in front of anyone watching. A hash gives arbitrary but
 * *stable* gaps — which is also what genuine absence looks like, because the
 * resident who is hard to catch is hard to catch all week.
 * ---------------------------------------------------------------------------
 */

/** Roughly how much of a shift's roster gets seen. Nine in ten, not ten. */
const COVERAGE = 0.88

/** How much likelier a critical resident is to be caught. Not certainty. */
const CRITICAL_LIFT = 0.09

/** Shifts of history the backfill writes: two days. */
const BACKFILL_SEGMENTS = 6

function enabled(): boolean {
  return process.env.DEMO_SIMULATION === '1'
}

/**
 * FNV-1a over a string, to [0, 1).
 *
 * Any stable hash would do. The property being bought is that
 * `chance(tenant, shift)` answers the same way every time it is asked, so a
 * cron may re-run without the past changing shape underneath it.
 */
function chance(...parts: string[]): number {
  let h = 0x811c9dc5
  const s = parts.join('|')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h / 0x100000000
}

/** Outcomes staff actually record, weighted the way a real shift falls out. */
function outcomeFor(roll: number): Doc<'wellnessChecks'>['outcome'] {
  if (roll < 0.78) return 'seen'
  if (roll < 0.86) return 'asleep'
  if (roll < 0.92) return 'no-answer'
  if (roll < 0.96) return 'declined'
  return 'refused'
}

/** The demo staff whose names go on the synthetic records. */
async function demoStaff(ctx: MutationCtx): Promise<Id<'users'>[]> {
  const wanted = ['test.rsw', 'test.wellness', 'test.support']
  const found: Id<'users'>[] = []
  for (const username of wanted) {
    const user = await ctx.db
      .query('users')
      .withIndex('by_username', (q) => q.eq('username', username))
      .unique()
      .catch(() => null)
    if (user) found.push(user._id)
  }
  return found
}

/** The segment `n` shifts back from the live one, as {date, key, from, to}. */
function segmentBack(now: number, tz: number, n: number) {
  const live = shiftAt(now, tz)
  const liveIndex = SHIFTS.findIndex((s) => s.key === live.key)
  const absolute = liveIndex - n
  const dayOffset = Math.floor(absolute / SHIFTS.length)
  const shift = SHIFTS[((absolute % SHIFTS.length) + SHIFTS.length) % SHIFTS.length]!
  const date = localDate(now + dayOffset * 86_400_000, tz)
  return { date, shift }
}

/**
 * Write one segment's worth of checks.
 *
 * Idempotent per (tenant, shift): a row already there is left alone, so the
 * tick may run over the live segment repeatedly without stacking duplicates.
 */
async function fillSegment(
  ctx: MutationCtx,
  building: Doc<'buildings'>,
  date: string,
  shift: (typeof SHIFTS)[number],
  tz: number,
  staff: Id<'users'>[],
  criticalIds: Set<string>,
  /** 0–1: how far through the segment to pretend we are. */
  progress: number,
): Promise<number> {
  const tenants = await ctx.db
    .query('tenants')
    .withIndex('by_building_status', (q) =>
      q.eq('buildingId', building._id).eq('status', 'current'),
    )
    .collect()

  const existing = await ctx.db
    .query('wellnessChecks')
    .withIndex('by_building_shift', (q) =>
      q.eq('buildingId', building._id).eq('shiftDate', date).eq('shiftKey', shift.key),
    )
    .collect()
  const already = new Set(existing.map((c) => c.tenantId as string))

  let written = 0
  for (const tenant of tenants) {
    if (already.has(tenant._id)) continue

    const critical = criticalIds.has(tenant._id)
    const roll = chance(tenant._id, date, shift.key)
    const threshold = COVERAGE + (critical ? CRITICAL_LIFT : 0)
    if (roll > threshold) continue // deliberately missed, and stays missed

    // Spread the checks across the segment so a shift looks worked rather than
    // logged in one burst, and only up to how far through it we are.
    const position = chance('when', tenant._id, date, shift.key)
    if (position > progress) continue

    const minutes = shift.from * 60 + Math.floor(position * (shift.to - shift.from) * 60)
    await ctx.db.insert('wellnessChecks', {
      buildingId: building._id,
      tenantId: tenant._id,
      ...(tenant.roomId ? { roomId: tenant.roomId } : {}),
      shiftDate: date,
      shiftKey: shift.key,
      outcome: outcomeFor(chance('outcome', tenant._id, date, shift.key)),
      completedAt: atLocal(date, minutes, tz),
      ...(staff.length
        ? { completedBy: staff[Math.floor(chance('who', tenant._id, date) * staff.length)]! }
        : {}),
    })
    written++
  }

  return written
}

/** Walk the rounds a staffed shift would have walked, missing the odd one. */
async function fillRoutines(
  ctx: MutationCtx,
  building: Doc<'buildings'>,
  date: string,
  shift: (typeof SHIFTS)[number],
  tz: number,
  staff: Id<'users'>[],
  progress: number,
): Promise<number> {
  const settings = await routinesFor(ctx, building._id)
  const from = atLocal(date, shift.from * 60, tz)
  const to = atLocal(date, shift.to * 60, tz)

  const existing = await ctx.db
    .query('routineCompletions')
    .withIndex('by_building_completed', (q) =>
      q.eq('buildingId', building._id).gte('completedAt', from),
    )
    .collect()

  let written = 0
  for (const setting of settings) {
    if (!setting.enabled) continue

    for (const slot of shiftSlots(setting.everyMinutes, shift.from, shift.to)) {
      const startsAt = atLocal(date, slot.startMinutes, tz)
      const endsAt = atLocal(date, slot.endMinutes, tz)
      if (endsAt > to) continue
      // Only slots whose time has come, on this segment's pretend clock.
      if ((startsAt - from) / (to - from) > progress) continue

      const filled = existing.some(
        (c) => c.routine === setting.routine && c.completedAt >= startsAt && c.completedAt < endsAt,
      )
      if (filled) continue

      // Roughly one round in twelve gets away from a shift.
      const roll = chance('routine', setting.routine, date, String(slot.startMinutes))
      if (roll > 0.92) continue

      const offset = Math.floor(roll * setting.everyMinutes * 0.8)
      await ctx.db.insert('routineCompletions', {
        buildingId: building._id,
        routine: setting.routine,
        completedAt: startsAt + offset * 60_000,
        ...(staff.length
          ? { completedBy: staff[Math.floor(roll * staff.length) % staff.length]! }
          : {}),
        ...(offset > 0 ? { minutesLate: offset } : {}),
      })
      written++
    }
  }

  return written
}

async function criticalTenantIds(
  ctx: MutationCtx,
  buildingId: Id<'buildings'>,
): Promise<Set<string>> {
  const needs = await ctx.db
    .query('criticalNeeds')
    .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
    .collect()
  return new Set(needs.filter((n) => n.resolvedAt === undefined).map((n) => n.tenantId as string))
}

/**
 * Fill in the last two days, so history looks lived-in:
 *
 *     npx convex run simulate:backfill '{"tzOffsetMinutes":420}'
 *
 * Safe to run twice — every write is idempotent per resident per shift.
 */
export const backfill = internalMutation({
  args: { tzOffsetMinutes: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (!enabled()) {
      throw new Error(
        'Refusing to write demo care records: set DEMO_SIMULATION=1 on this deployment first.',
      )
    }

    const tz = args.tzOffsetMinutes ?? 0
    const now = Date.now()
    const staff = await demoStaff(ctx)
    const buildings = await ctx.db.query('buildings').collect()

    let checks = 0
    let rounds = 0
    for (const building of buildings) {
      const criticalIds = await criticalTenantIds(ctx, building._id)

      // Past segments are complete; the live one only as far as the clock.
      for (let back = BACKFILL_SEGMENTS; back >= 1; back--) {
        const { date, shift } = segmentBack(now, tz, back)
        checks += await fillSegment(ctx, building, date, shift, tz, staff, criticalIds, 1)
        rounds += await fillRoutines(ctx, building, date, shift, tz, staff, 1)
      }
    }

    return { buildings: buildings.length, checks, rounds }
  },
})

/**
 * Keep the live shift moving. Cron, every fifteen minutes.
 *
 * Writes only up to where the clock actually is, so a shift fills in as it goes
 * rather than arriving complete the moment it starts.
 */
export const tick = internalMutation({
  args: { tzOffsetMinutes: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (!enabled()) return { skipped: 'DEMO_SIMULATION is not set' as const }

    const tz = args.tzOffsetMinutes ?? 0
    const now = Date.now()
    const { key, shiftDate } = shiftAt(now, tz)
    const shift = SHIFTS.find((s) => s.key === key)!
    const from = atLocal(shiftDate, shift.from * 60, tz)
    const to = atLocal(shiftDate, shift.to * 60, tz)
    const progress = Math.min(1, Math.max(0, (now - from) / (to - from)))

    const staff = await demoStaff(ctx)
    const buildings = await ctx.db.query('buildings').collect()

    let checks = 0
    let rounds = 0
    for (const building of buildings) {
      const criticalIds = await criticalTenantIds(ctx, building._id)
      checks += await fillSegment(ctx, building, shiftDate, shift, tz, staff, criticalIds, progress)
      rounds += await fillRoutines(ctx, building, shiftDate, shift, tz, staff, progress)
    }

    return {
      shiftDate,
      shift: shift.key,
      progress: Math.round(progress * 100),
      checks,
      rounds,
    }
  },
})
