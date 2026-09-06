import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { QueryCtx } from './_generated/server'
import {
  CHECK_INTERVAL_MS,
  SHIFTS,
  can,
  money,
  requireStaff,
  resolveBuilding,
  shiftAt,
} from './model'
import { atLocal, graceMinutes, routinesFor, slotsWithStatus, ROUTINES } from './routines'

/**
 * The bell.
 *
 * Nothing writes a notification. Every item here is derived from the thing it
 * is about — a round that came due, a need nobody has closed, a guest who never
 * signed out — and it disappears the moment that thing is dealt with. A stored
 * feed would need a writer at every one of those call sites and a sweeper to
 * retract items when the situation resolved; miss one and the bell is telling
 * people to chase something that was handled an hour ago. A worker who learns
 * the bell lies stops reading it, and then it is worse than not having it.
 *
 * What *is* stored is far smaller: which keys a person has already looked at.
 * A key is derived deterministically and changes when the situation renews, so
 * a round marked read at 9pm comes back unread when it next falls due.
 */

export type Severity = 'high' | 'med' | 'low'

export type Notification = {
  key: string
  kind: 'routine' | 'need' | 'maintenance' | 'rent' | 'visitor' | 'check' | 'pet'
  severity: Severity
  title: string
  detail: string
  /** When this became true — what the feed is ordered by. */
  at: number
  href: string
}

const DAY = 86_400_000
const RANK: Record<Severity, number> = { high: 0, med: 1, low: 2 }

/**
 * Everything worth interrupting someone about, newest and worst first.
 *
 * `now` is passed in rather than read from the clock: a Convex query re-runs
 * when its data changes, not when time passes, so a feed that measured lateness
 * against its own `Date.now()` would freeze at whatever it said when it last
 * loaded. The client ticks it.
 */
export const feed = query({
  args: {
    buildingId: v.optional(v.id('buildings')),
    now: v.number(),
    /**
     * The browser's `getTimezoneOffset()`. Rounds are answered in slots on the
     * building's own clock, so "the 9pm round" has to mean 9pm there.
     */
    tzOffsetMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx)
    const building = await resolveBuilding(ctx, staff, args.buildingId)
    if (!building) return null

    const buildingId = building._id
    const now = args.now
    const items: Notification[] = []

    if (can(staff, 'checks')) {
      items.push(...(await overdueRoutines(ctx, buildingId, now, args.tzOffsetMinutes)))
      items.push(...(await staleRoomChecks(ctx, buildingId, now)))
    }

    if (can(staff, 'care')) {
      items.push(...(await openNeeds(ctx, buildingId)))
      items.push(...(await urgentWorkOrders(ctx, buildingId, now)))
      items.push(...(await guestsStillIn(ctx, buildingId, now)))
      items.push(...(await unseenPets(ctx, buildingId, now)))
    }

    // Rent is not care information. A worker on the desk has no business being
    // told who is behind, and being told anyway is how it ends up repeated.
    if (can(staff, 'money')) {
      items.push(...(await rentAtRisk(ctx, buildingId)))
    }

    const reads = await ctx.db
      .query('notificationReads')
      .withIndex('by_user_key', (q) => q.eq('userId', staff._id))
      .collect()
    const readKeys = new Set(reads.map((r) => r.key))

    const rows = items
      .map((item) => ({ ...item, read: readKeys.has(item.key) }))
      .sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.at - a.at)

    return {
      building: { _id: building._id, name: building.name },
      rows,
      unread: rows.filter((r) => !r.read).length,
    }
  },
})

/* -------------------------------------------------------------------------
   Sources. Each returns items for one kind of thing, and each key encodes the
   situation rather than a row id wherever the same row can come back — an
   hourly round is a new notification every hour, not one that never returns.
   ------------------------------------------------------------------------- */

/**
 * Rounds, in the same slots the Care Console shows.
 *
 * This deliberately does not measure from the last completion. A rolling
 * interval has no memory of a skipped round: walk the 9pm one at 9:55 and the
 * 10pm slot can pass unwalked while the interval still reads "due in 50
 * minutes", so the card would show a gap the bell stayed quiet about. The bell
 * has to be at least as alarmed as the screen it summarises.
 *
 * At most one item per routine, because three routines producing a line per
 * missed hour is a bell nobody finishes reading.
 */
async function overdueRoutines(
  ctx: QueryCtx,
  buildingId: Id<'buildings'>,
  now: number,
  tzOffsetMinutes: number,
): Promise<Notification[]> {
  const settings = await routinesFor(ctx, buildingId)
  const { key: shiftKey, shiftDate } = shiftAt(now, tzOffsetMinutes)
  const shift = SHIFTS.find((s) => s.key === shiftKey)!
  const shiftStart = atLocal(shiftDate, shift.from * 60, tzOffsetMinutes)

  const completions = await ctx.db
    .query('routineCompletions')
    .withIndex('by_building_completed', (q) =>
      q.eq('buildingId', buildingId).gte('completedAt', shiftStart),
    )
    .collect()

  const out: Notification[] = []

  for (const setting of settings) {
    if (!setting.enabled) continue
    const def = ROUTINES.find((r) => r.key === setting.routine)!

    const slots = slotsWithStatus(
      setting.everyMinutes,
      shift,
      shiftDate,
      tzOffsetMinutes,
      completions.filter((c) => c.routine === setting.routine).map((c) => c.completedAt),
      now,
    )

    const missed = slots.filter((s) => s.status === 'missed')
    const current = slots.find((s) => s.status === 'now')

    // A missed round outranks one merely running, and only one of the two is
    // reported: the gap is the thing to act on, and the current slot is
    // visible on the console anyway.
    if (missed.length > 0) {
      const latest = missed[missed.length - 1]!
      out.push({
        key: `routine:${setting.routine}:missed:${latest.startsAt}`,
        kind: 'routine',
        severity: 'high',
        title:
          missed.length === 1
            ? `${def.label} missed at ${clock(latest.startsAt)}`
            : `${def.label} missed ${missed.length} times this shift`,
        detail: `Every ${minutes(setting.everyMinutes)} on this site. Latest gap ${clock(latest.startsAt)}–${clock(latest.endsAt)}.`,
        at: latest.endsAt,
        href: '/care',
      })
      continue
    }

    // Only once it is genuinely running late inside its own slot — announcing
    // a round the second its hour begins is a notification for every hour of
    // every shift, which is the fastest way to make the bell worthless.
    if (current) {
      const grace = graceMinutes(setting.everyMinutes)
      if (now >= current.startsAt + grace * 60_000) {
        out.push({
          key: `routine:${setting.routine}:${current.startsAt}`,
          kind: 'routine',
          severity: 'med',
          title: `${def.label} due this hour`,
          detail: `The ${clock(current.startsAt)}–${clock(current.endsAt)} round has not been logged.`,
          at: current.startsAt,
          href: '/care',
        })
      }
    }
  }

  return out
}

async function staleRoomChecks(
  ctx: QueryCtx,
  buildingId: Id<'buildings'>,
  now: number,
): Promise<Notification[]> {
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

  const occupied = new Set(tenants.map((t) => t.roomId).filter(Boolean) as string[])
  const stale = rooms.filter(
    (r) =>
      occupied.has(r._id) &&
      (r.lastCheckedAt === undefined || now - r.lastCheckedAt > CHECK_INTERVAL_MS),
  )
  if (stale.length === 0) return []

  // One item for the lot of them, renewed weekly. Twenty separate lines saying
  // the same thing is not twenty times the information.
  const week = Math.floor(now / (7 * DAY))
  return [
    {
      key: `room-checks:${buildingId}:${week}`,
      kind: 'check',
      severity: 'med',
      title: `${stale.length} ${stale.length === 1 ? 'room has' : 'rooms have'} not been checked this week`,
      detail: `Rooms ${stale.slice(0, 8).map((r) => r.number).join(', ')}${stale.length > 8 ? '…' : '.'}`,
      at: now,
      href: '/checks',
    },
  ]
}

async function openNeeds(
  ctx: QueryCtx,
  buildingId: Id<'buildings'>,
): Promise<Notification[]> {
  const needs = await ctx.db
    .query('criticalNeeds')
    .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
    .collect()

  const open = needs.filter((n) => n.resolvedAt === undefined)
  const out: Notification[] = []

  for (const need of open) {
    const tenant = await ctx.db.get(need.tenantId)
    out.push({
      key: `need:${need._id}`,
      kind: 'need',
      severity: 'high',
      title: `${tenant?.name ?? 'A resident'} — ${need.summary}`,
      detail: need.detail ?? (need.caseManager ? `Case manager: ${need.caseManager}.` : 'Open critical need.'),
      at: need.openedAt,
      href: tenant ? `/tenants/${tenant._id}` : '/critical',
    })
  }

  return out
}

async function urgentWorkOrders(
  ctx: QueryCtx,
  buildingId: Id<'buildings'>,
  now: number,
): Promise<Notification[]> {
  const open = await ctx.db
    .query('workOrders')
    .withIndex('by_building_status', (q) =>
      q.eq('buildingId', buildingId).eq('status', 'open'),
    )
    .collect()

  return open
    .filter((wo) => wo.priority === 'high')
    .map((wo) => {
      const days = Math.floor((now - wo.openedAt) / DAY)
      return {
        key: `wo:${wo._id}`,
        kind: 'maintenance' as const,
        severity: 'med' as const,
        title: wo.title,
        detail:
          days > 0
            ? `Urgent, open ${days} ${days === 1 ? 'day' : 'days'}. ${wo.detail ?? 'No trades assigned yet.'}`
            : `Urgent. ${wo.detail ?? 'No trades assigned yet.'}`,
        at: wo.openedAt,
        href: '/maintenance',
      }
    })
}

async function rentAtRisk(
  ctx: QueryCtx,
  buildingId: Id<'buildings'>,
): Promise<Notification[]> {
  const tenants = await ctx.db
    .query('tenants')
    .withIndex('by_building_status', (q) =>
      q.eq('buildingId', buildingId).eq('status', 'current'),
    )
    .collect()

  return tenants
    .filter((t) => t.monthlyRentCents > 0 && (t.balanceCents ?? 0) >= t.monthlyRentCents * 2)
    .map((t) => ({
      key: `rent:${t._id}`,
      kind: 'rent' as const,
      severity: 'med' as const,
      title: `${t.name} is two months behind`,
      detail: `${money(t.balanceCents ?? 0)} outstanding${
        t.lastPaymentAt ? `. Last payment ${date(t.lastPaymentAt)}.` : ' and no payment on record.'
      }`,
      at: t.lastPaymentAt ?? 0,
      href: `/tenants/${t._id}`,
    }))
}

async function guestsStillIn(
  ctx: QueryCtx,
  buildingId: Id<'buildings'>,
  now: number,
): Promise<Notification[]> {
  const recent = await ctx.db
    .query('visits')
    .withIndex('by_building_in', (q) =>
      q.eq('buildingId', buildingId).gte('signedInAt', now - 7 * DAY),
    )
    .collect()

  const out: Notification[] = []
  for (const visit of recent) {
    if (visit.signedOutAt !== undefined) continue

    // Two different problems, and they are not equally urgent: somebody staying
    // the night without approval is a policy matter for the morning; somebody
    // signed in twelve hours ago who nobody has seen leave is a headcount the
    // desk cannot answer, which matters at 3am if the alarm goes.
    const unauthorizedOvernight = visit.overnight && visit.authorized === false
    const hours = Math.floor((now - visit.signedInAt) / 3_600_000)
    if (!unauthorizedOvernight && hours < 12) continue

    const [visitor, tenant] = await Promise.all([
      ctx.db.get(visit.visitorId),
      ctx.db.get(visit.tenantId),
    ])

    out.push({
      key: `visit:${visit._id}${unauthorizedOvernight ? ':overnight' : ':long'}`,
      kind: 'visitor',
      severity: unauthorizedOvernight ? 'high' : 'med',
      title: unauthorizedOvernight
        ? `${visitor?.name ?? 'A guest'} stayed overnight without authorization`
        : `${visitor?.name ?? 'A guest'} has not signed out`,
      detail: `Visiting ${tenant?.name ?? 'a resident'}, signed in ${clock(visit.signedInAt)}${
        hours >= 24 ? ` — ${Math.floor(hours / 24)}d ago` : ''
      }.`,
      at: visit.signedInAt,
      href: '/visitors',
    })
  }

  return out
}

async function unseenPets(
  ctx: QueryCtx,
  buildingId: Id<'buildings'>,
  now: number,
): Promise<Notification[]> {
  const pets = await ctx.db
    .query('pets')
    .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
    .collect()

  const out: Notification[] = []
  for (const pet of pets.filter((p) => p.retiredAt === undefined)) {
    const last = await ctx.db
      .query('petSightings')
      .withIndex('by_pet_seen', (q) => q.eq('petId', pet._id))
      .order('desc')
      .first()

    const days = last ? Math.floor((now - last.seenAt) / DAY) : null
    if (days !== null && days < 2) continue

    const tenant = pet.tenantId ? await ctx.db.get(pet.tenantId) : null
    out.push({
      // Renewed daily: an animal nobody has seen is worth asking about again
      // tomorrow, but not every time the page loads today.
      key: `pet:${pet._id}:${Math.floor(now / DAY)}`,
      kind: 'pet',
      severity: 'low',
      title: `${pet.name} has not been seen${days === null ? '' : ` in ${days} days`}`,
      detail: tenant ? `${pet.kind}, with ${tenant.name}.` : `${pet.kind}, no resident on file.`,
      at: last?.seenAt ?? 0,
      href: '/services',
    })
  }

  return out
}

/* ------------------------------- read state ------------------------------ */

/**
 * Mark keys as seen.
 *
 * Takes whatever the client is showing rather than "everything", because the
 * feed is computed and the two could disagree — marking all read on the server
 * would silently swallow an item that arrived between the render and the click.
 */
export const markRead = mutation({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx)
    const now = Date.now()

    for (const key of args.keys.slice(0, 200)) {
      const existing = await ctx.db
        .query('notificationReads')
        .withIndex('by_user_key', (q) => q.eq('userId', staff._id).eq('key', key))
        .unique()
      if (existing) continue
      await ctx.db.insert('notificationReads', { userId: staff._id, key, readAt: now })
    }

    return null
  },
})

/* -------------------------------- format --------------------------------- */

function minutes(total: number): string {
  if (total < 60) return `${total} min`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function clock(ts: number): string {
  const d = new Date(ts)
  const hh = d.getHours()
  const mm = d.getMinutes().toString().padStart(2, '0')
  const suffix = hh >= 12 ? 'pm' : 'am'
  return `${((hh + 11) % 12) + 1}:${mm}${suffix}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function date(ts: number): string {
  const d = new Date(ts)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}
