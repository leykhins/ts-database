import { v } from 'convex/values'
import { query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import {
  CHECK_INTERVAL_MS,
  balanceFromLedger,
  depositHeld,
  deriveRoomStatus,
  groupBy,
  money,
  requireStaff,
  resolveBuilding,
} from './model'

/**
 * Everything the Home screen renders, in one subscription.
 *
 * The home screen leads with the building itself — a cell per room, colored by
 * what that room needs — and then names the next action. Splitting that across
 * six queries would make the grid and the queue disagree mid-shift, so it is
 * deliberately one snapshot.
 *
 * Scale note: this reads the building's whole rent ledger. At ~1–2 rows per
 * tenant per month that is low thousands of rows per year for a 48-unit
 * building. If a building's ledger outgrows that, move balance to a
 * per-tenant rollup updated in `rents.receivePayment`.
 *
 * Scale note: it also reads the building's whole placement history, to draw
 * occupancy month by month. Placements are written only when someone arrives,
 * moves site or is evicted — a handful per resident, tens per year for a
 * 48-unit building. If that outgrows a subscription, keep a monthly occupancy
 * snapshot written by a cron instead of replaying history on every render.
 */
export const overview = query({
  args: { buildingId: v.optional(v.id('buildings')) },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx)
    const building = await resolveBuilding(ctx, staff, args.buildingId)
    if (!building) return null

    const now = Date.now()
    const buildingId = building._id

    const [rooms, tenants, ledger, deposits, needs, checks, workOrders, placements] =
      await Promise.all([
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
          .query('rentLedger')
          .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
          .collect(),
        ctx.db
          .query('depositEntries')
          .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
          .collect(),
        ctx.db
          .query('criticalNeeds')
          .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
          .collect(),
        ctx.db
          .query('roomChecks')
          .withIndex('by_building_completed', (q) => q.eq('buildingId', buildingId))
          .order('desc')
          .take(RECENT_CHECKS),
        ctx.db
          .query('workOrders')
          .withIndex('by_building_status', (q) =>
            q.eq('buildingId', buildingId).eq('status', 'open'),
          )
          .collect(),
        ctx.db
          .query('placements')
          .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
          .collect(),
      ])

    const ledgerByTenant = groupBy(ledger, (e) => e.tenantId)
    const depositsByTenant = groupBy(deposits, (e) => e.tenantId)
    const openNeeds = needs.filter((n) => n.resolvedAt === undefined)
    const openNeedTenantIds = new Set(openNeeds.map((n) => n.tenantId))
    const tenantByRoom = new Map<string, Doc<'tenants'>>()
    for (const t of tenants) if (t.roomId) tenantByRoom.set(t.roomId, t)

    // ---- Room grid, floor by floor, the way staff walk the building ----
    const roomState = rooms.map((room) => {
      const tenant = tenantByRoom.get(room._id)
      const balanceCents = tenant
        ? balanceFromLedger(ledgerByTenant[tenant._id] ?? [])
        : 0
      const heldCents = tenant ? depositHeld(depositsByTenant[tenant._id] ?? []) : 0
      const { status, note } = deriveRoomStatus({
        tenant,
        balanceCents,
        depositHeldCents: heldCents,
        hasOpenCriticalNeed: tenant ? openNeedTenantIds.has(tenant._id) : false,
        lastCheckedAt: room.lastCheckedAt,
        now,
      })
      return { room, tenant, balanceCents, heldCents, status, note }
    })

    const floors: { label: string; cells: RoomCell[] }[] = []
    for (const s of roomState) {
      let floor = floors.find((f) => f.label === s.room.floor)
      if (!floor) {
        floor = { label: s.room.floor, cells: [] }
        floors.push(floor)
      }
      floor.cells.push({
        roomId: s.room._id,
        number: s.room.number,
        status: s.status,
        note: s.note,
        tenantId: s.tenant?._id ?? null,
      })
    }

    // ---- The queue: what stands between this building and All Clear ----
    const actions: ActionItem[] = []

    const lastBuildingCheck = checks.find((c) => c.kind === 'building')
    const buildingCheckAge = lastBuildingCheck
      ? now - lastBuildingCheck.completedAt
      : Infinity
    if (buildingCheckAge > CHECK_INTERVAL_MS) {
      const daysOver = Number.isFinite(buildingCheckAge)
        ? Math.floor((buildingCheckAge - CHECK_INTERVAL_MS) / 86_400_000)
        : null
      actions.push({
        id: 'building-check',
        kind: 'check',
        priority: 'high',
        room: '—',
        tenantId: null,
        title:
          daysOver === null
            ? 'No building check on record'
            : `Building check is ${daysOver} ${daysOver === 1 ? 'day' : 'days'} overdue`,
        detail: lastBuildingCheck
          ? `Last completed ${formatDate(lastBuildingCheck.completedAt)}. Fire route and common areas outstanding.`
          : 'Fire route and common areas have never been signed off in TS Database.',
        cta: 'Start building check',
        href: '/checks',
      })
    }

    for (const wo of workOrders.filter((w) => w.priority === 'high').slice(0, 3)) {
      const room = wo.roomId ? rooms.find((r) => r._id === wo.roomId) : undefined
      const days = Math.floor((now - wo.openedAt) / 86_400_000)
      actions.push({
        id: `wo-${wo._id}`,
        kind: 'maintenance',
        priority: 'high',
        room: room?.number ?? '—',
        tenantId: null,
        title: `${wo.title}${days > 0 ? ` — ${days}d open` : ''}`,
        detail: wo.detail ?? 'No trades assigned yet.',
        cta: 'Assign work order',
        href: '/maintenance',
      })
    }

    // Two months behind is the threshold at which a tenancy is genuinely at risk.
    for (const s of roomState) {
      if (!s.tenant) continue
      if (s.balanceCents >= s.tenant.monthlyRentCents * 2) {
        const lastPayment = (ledgerByTenant[s.tenant._id] ?? [])
          .filter((e) => e.kind === 'payment')
          .sort((a, b) => b.postedAt - a.postedAt)[0]
        actions.push({
          id: `rent-${s.tenant._id}`,
          kind: 'rent',
          priority: 'high',
          room: s.room.number,
          tenantId: s.tenant._id,
          title: `Room ${s.room.number} is two months behind`,
          detail: `${s.tenant.name} owes ${money(s.balanceCents)}.${
            lastPayment ? ` Last payment ${formatDate(lastPayment.postedAt)}.` : ''
          }`,
          cta: 'Receive Rent',
          href: `/tenants/${s.tenant._id}`,
        })
      }
    }

    const roomsDue = roomState.filter((s) => s.status === 'check')
    const staleRooms = roomState.filter(
      (s) =>
        s.tenant &&
        (s.room.lastCheckedAt === undefined ||
          now - s.room.lastCheckedAt > CHECK_INTERVAL_MS),
    )
    if (staleRooms.length > 0) {
      actions.push({
        id: 'room-checks',
        kind: 'check',
        priority: 'med',
        room: '—',
        tenantId: null,
        title: `${staleRooms.length} rooms not checked this week`,
        detail: `Rooms ${staleRooms
          .slice(0, 8)
          .map((s) => s.room.number)
          .join(', ')}${staleRooms.length > 8 ? '…' : '.'}`,
        cta: 'Start room checks',
        href: '/checks',
      })
    }

    for (const s of roomState) {
      if (!s.tenant) continue
      const short = s.tenant.depositRequiredCents - s.heldCents
      if (short > 0) {
        actions.push({
          id: `deposit-${s.tenant._id}`,
          kind: 'deposit',
          priority: 'med',
          room: s.room.number,
          tenantId: s.tenant._id,
          title: `Deposit short by ${money(short)} in Room ${s.room.number}`,
          detail: `${s.tenant.name} has ${money(s.heldCents)} of ${money(
            s.tenant.depositRequiredCents,
          )} held since intake.`,
          cta: 'Adjust funds',
          href: '/deposits',
        })
      }
    }

    // ---- KPI strip ----
    const monthStart = startOfMonth(now)
    const thisMonth = ledger.filter((e) => e.postedAt >= monthStart)
    const collectedCents = thisMonth
      .filter((e) => e.kind === 'payment')
      .reduce((s, e) => s + e.amountCents, 0)
    const chargedCents = thisMonth
      .filter((e) => e.kind === 'charge')
      .reduce((s, e) => s + e.amountCents, 0)

    const criticalResidents = roomState
      .filter((s) => s.tenant && openNeedTenantIds.has(s.tenant._id))
      .map((s) => ({
        tenantId: s.tenant!._id,
        name: s.tenant!.name,
        room: s.room.number,
        supportLevel: s.tenant!.supportLevel,
      }))

    const occupied = roomState.filter((s) => s.tenant).length
    const clearRooms = roomState.filter((s) => s.status === 'ok').length

    // `deriveRoomStatus` has no out-of-service state: an empty room that has
    // been taken out of service comes back `vacant`. Counting every vacant
    // room as available would offer staff a room they cannot house anyone in,
    // so the room's own `outOfService` flag decides — the same rule intake and
    // the shift report use.
    const outOfServiceRooms = roomState.filter((s) => s.room.outOfService).length
    const availableRooms = roomState.filter(
      (s) => s.status === 'vacant' && !s.room.outOfService,
    ).length

    // ---- Sparklines ----
    const housedIds = new Set(roomState.flatMap((s) => (s.tenant ? [s.tenant._id] : [])))

    // `exit`, `setStatus` and `transferRoom` change a tenancy without writing a
    // placement, so a resident who left that way still has an open one here.
    // Counting it as open would keep them in every month since they left; their
    // exit date is on their own record, so fetch just those residents.
    const leaverIds = [
      ...new Set(
        placements
          .filter((p) => p.roomId && p.endedAt === undefined && !housedIds.has(p.tenantId))
          .map((p) => p.tenantId),
      ),
    ]

    // The newest-first `take` feeds the streak. A building checking every room
    // daily fills it in about a week, and a sparkline that silently drops the
    // older half of its window reads as checks that never happened — so when
    // the take ends inside the window, read the rest of the window by index.
    const checkWindowStart = startOfDay(now) - 13 * DAY_MS
    const oldestCheck = checks[checks.length - 1]
    const checksTruncated =
      checks.length === RECENT_CHECKS &&
      oldestCheck !== undefined &&
      oldestCheck.completedAt >= checkWindowStart

    const [leavers, olderChecks] = await Promise.all([
      Promise.all(leaverIds.map((id) => ctx.db.get('tenants', id))),
      checksTruncated
        ? ctx.db
            .query('roomChecks')
            .withIndex('by_building_completed', (q) =>
              q
                .eq('buildingId', buildingId)
                .gte('completedAt', checkWindowStart)
                // Inclusive, and deduplicated below: the take may have stopped
                // partway through checks sharing that same millisecond.
                .lte('completedAt', oldestCheck.completedAt),
            )
            .collect()
        : Promise.resolve([]),
    ])

    const seenChecks = new Set(checks.map((c) => c._id))
    const windowChecks = checks.concat(olderChecks.filter((c) => !seenChecks.has(c._id)))

    const series = {
      rent: rentSeries(ledger, now),
      checks: checkSeries(windowChecks, now),
      occupancy: occupancySeries({
        placements,
        housed: roomState.flatMap((s) => (s.tenant ? [s.tenant] : [])),
        leavers: leavers.flatMap((t) => (t ? [t] : [])),
        units: building.units,
        now,
      }),
    }

    return {
      building: {
        _id: building._id,
        name: building.name,
        units: building.units,
        occupied,
      },
      floors,
      actions,
      stats: {
        currentTenants: tenants.length,
        collectedCents,
        chargedCents,
        criticalCount: criticalResidents.length,
        roomsToCheck: roomsDue.length,
        clearRooms,
        totalRooms: rooms.length,
        availableRooms,
        outOfServiceRooms,
        // Status `open` only, as read above — `assigned` orders already have
        // someone on them and are not what this count is asking staff to act on.
        openWorkOrders: workOrders.length,
      },
      series,
      criticalResidents,
      streak: checkStreak(checks, now),
      counts: {
        tenants: tenants.length,
        rentWarnings: roomState.filter((s) => s.balanceCents > 0).length,
        criticalNeeds: criticalResidents.length,
      },
    }
  },
})

type RoomCell = {
  roomId: Id<'rooms'>
  number: string
  status: string
  note: string
  tenantId: Id<'tenants'> | null
}

type ActionItem = {
  id: string
  kind: 'check' | 'maintenance' | 'rent' | 'deposit'
  priority: 'high' | 'med' | 'low'
  room: string
  tenantId: Id<'tenants'> | null
  title: string
  detail: string
  cta: string
  href: string
}

/** Consecutive days, ending today, on which at least one check was completed. */
function checkStreak(checks: Doc<'roomChecks'>[], now: number): number {
  const days = new Set(checks.map((c) => dayKey(c.completedAt)))
  let streak = 0
  for (let i = 0; i < 400; i++) {
    if (!days.has(dayKey(now - i * 86_400_000))) {
      // Today not being logged yet shouldn't reset a real streak.
      if (i === 0) continue
      break
    }
    streak++
  }
  return streak
}

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

function startOfMonth(ts: number): number {
  const d = new Date(ts)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

/** Enough recent checks for the streak; see `overview` for the sparkline window. */
const RECENT_CHECKS = 400

const DAY_MS = 86_400_000

/** How many months each monthly sparkline covers, the current one included. */
const SERIES_MONTHS = 6

/** UTC midnight, matching `dayKey` so the sparkline and the streak agree on days. */
function startOfDay(ts: number): number {
  const d = new Date(ts)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** Start of the month `offset` months from the one containing `ts`. */
function monthStartOffset(ts: number, offset: number): number {
  const d = new Date(ts)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)
}

/**
 * Collected and charged per month, oldest first.
 *
 * Same kinds and the same open-ended current month as the KPI strip, so the
 * last point is the KPI to the cent. A bounded current month would drop any
 * posting dated ahead of `now` and the sparkline would disagree with the
 * number printed beside it.
 */
function rentSeries(ledger: Doc<'rentLedger'>[], now: number) {
  const points: { label: string; collectedCents: number; chargedCents: number }[] = []
  for (let i = SERIES_MONTHS - 1; i >= 0; i--) {
    const from = monthStartOffset(now, -i)
    const to = i === 0 ? Infinity : monthStartOffset(now, -i + 1)
    let collectedCents = 0
    let chargedCents = 0
    for (const e of ledger) {
      if (e.postedAt < from || e.postedAt >= to) continue
      if (e.kind === 'payment') collectedCents += e.amountCents
      else if (e.kind === 'charge') chargedCents += e.amountCents
    }
    points.push({ label: MONTHS[new Date(from).getUTCMonth()]!, collectedCents, chargedCents })
  }
  return points
}

/**
 * Room checks completed per UTC day for the last 14 days, oldest first.
 *
 * Only a count of what was done. How many rooms were due on a past day was
 * never recorded, and a reconstructed "due" figure would put an invented
 * denominator into a care record.
 */
function checkSeries(checks: Doc<'roomChecks'>[], now: number) {
  const perDay = new Map<string, number>()
  for (const c of checks) {
    if (c.kind !== 'room') continue
    const key = dayKey(c.completedAt)
    perDay.set(key, (perDay.get(key) ?? 0) + 1)
  }
  const points: { label: string; done: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const day = startOfDay(now) - i * DAY_MS
    points.push({ label: formatDate(day), done: perDay.get(dayKey(day)) ?? 0 })
  }
  return points
}

/**
 * Residents housed in a room here at each month's end (for this month, now),
 * oldest first.
 *
 * Counted by resident rather than by room: `transferRoom` moves someone
 * without writing a placement, so their open placement can name a room they
 * have left, and counting rooms would lose them the moment someone else moved
 * into it.
 *
 * Placements are the history, but not a complete one, so the resident records
 * already in hand fill the two gaps that would otherwise make the line lie:
 *
 * - Someone housed now with no open placement here (every seeded resident,
 *   anyone moved in before placements existed) counts from their intake date,
 *   or from the end of their last placement here if that is later. Dropping
 *   them would draw a building that filled up this month.
 * - Someone not housed now whose placement was never closed counts until their
 *   recorded exit date. Without one there is no date to end it on, so they are
 *   left out rather than kept in the building indefinitely — this is also what
 *   keeps a prospective resident's intake placement from counting.
 *
 * By construction the last point equals the grid's `occupied`: every housed
 * resident has an open stay, and every other stay has ended by `now`.
 */
function occupancySeries(args: {
  placements: Doc<'placements'>[]
  housed: Doc<'tenants'>[]
  leavers: Doc<'tenants'>[]
  units: number
  now: number
}) {
  const { placements, housed, leavers, units, now } = args
  const housedIds = new Set(housed.map((t) => t._id))
  const exitAt = new Map(leavers.map((t) => [t._id, t.exitDate ? Date.parse(t.exitDate) : NaN]))
  const stays: { tenantId: Id<'tenants'>; from: number; to: number }[] = []

  for (const p of placements) {
    if (!p.roomId) continue
    if (p.endedAt !== undefined) {
      stays.push({ tenantId: p.tenantId, from: p.startedAt, to: p.endedAt })
    } else if (housedIds.has(p.tenantId)) {
      stays.push({ tenantId: p.tenantId, from: p.startedAt, to: Infinity })
    } else {
      const exit = exitAt.get(p.tenantId) ?? NaN
      if (exit > p.startedAt) {
        stays.push({ tenantId: p.tenantId, from: p.startedAt, to: Math.min(exit, now) })
      }
    }
  }

  const openStay = new Set(stays.filter((s) => s.to === Infinity).map((s) => s.tenantId))
  for (const t of housed) {
    if (openStay.has(t._id)) continue
    const intake = Date.parse(t.intakeDate)
    let from = Number.isNaN(intake) ? now : intake
    for (const p of placements) {
      if (p.tenantId === t._id) from = Math.max(from, p.endedAt ?? p.startedAt)
    }
    stays.push({ tenantId: t._id, from: Math.min(from, now), to: Infinity })
  }

  const points: { label: string; occupied: number; units: number }[] = []
  for (let i = SERIES_MONTHS - 1; i >= 0; i--) {
    const at = i === 0 ? now : monthStartOffset(now, -i + 1) - 1
    const present = new Set<Id<'tenants'>>()
    for (const s of stays) if (s.from <= at && s.to > at) present.add(s.tenantId)
    points.push({
      label: MONTHS[new Date(at).getUTCMonth()]!,
      occupied: present.size,
      units,
    })
  }
  return points
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}
