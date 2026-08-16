import { v } from 'convex/values'
import { query } from './_generated/server'
import { CHECK_INTERVAL_MS, requireStaff, resolveBuilding } from './model'

/**
 * Auxiliary reports — the shift handover and the periodic summaries.
 *
 * Everything here is computed live from the operational tables rather than
 * stored: a report that is a snapshot of a moment goes stale, and staff end up
 * trusting a printout over the screen. `now` is passed in by the caller so the
 * query stays cacheable and re-runs when the client says the day has moved on.
 */

export const shift = query({
  args: { buildingId: v.optional(v.id('buildings')), now: v.number() },
  handler: async (ctx, args) => {
    await requireStaff(ctx)
    const building = await resolveBuilding(ctx, args.buildingId)
    if (!building) return null

    const buildingId = building._id
    const now = args.now
    const dayStart = now - 24 * 60 * 60 * 1000
    const monthStart = startOfMonth(now)

    const [tenants, rooms, ledger, checks, needs, orders, deposits] = await Promise.all([
      ctx.db
        .query('tenants')
        .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
        .collect(),
      ctx.db
        .query('rooms')
        .withIndex('by_building_sort', (q) => q.eq('buildingId', buildingId))
        .collect(),
      ctx.db
        .query('rentLedger')
        .withIndex('by_building_posted', (q) =>
          q.eq('buildingId', buildingId).gte('postedAt', monthStart),
        )
        .collect(),
      ctx.db
        .query('roomChecks')
        .withIndex('by_building_completed', (q) =>
          q.eq('buildingId', buildingId).gte('completedAt', dayStart),
        )
        .collect(),
      ctx.db
        .query('criticalNeeds')
        .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
        .collect(),
      ctx.db
        .query('workOrders')
        .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
        .collect(),
      ctx.db
        .query('depositEntries')
        .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
        .order('desc')
        .take(60),
    ])

    const roomById = new Map(rooms.map((r) => [r._id as string, r]))
    const current = tenants.filter((t) => t.status === 'current')
    const roomNumber = (id: string | undefined) =>
      id ? (roomById.get(id)?.number ?? '—') : '—'

    // ---- Money, this calendar month ----
    const collectedCents = ledger
      .filter((e) => e.kind === 'payment')
      .reduce((s, e) => s + e.amountCents, 0)
    const chargedCents = ledger
      .filter((e) => e.kind === 'charge')
      .reduce((s, e) => s + e.amountCents, 0)

    // ---- Rent roll: what the building bills, and what it is owed ----
    const rentRoll = current
      .map((t) => ({
        _id: t._id,
        name: t.name,
        room: roomNumber(t.roomId),
        monthlyRentCents: t.monthlyRentCents,
        balanceCents: t.balanceCents ?? 0,
        depositHeldCents: t.depositHeldCents ?? 0,
        depositRequiredCents: t.depositRequiredCents,
      }))
      .sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }))

    // ---- Occupancy, intake and exits ----
    const thisMonthIso = new Date(monthStart).toISOString().slice(0, 7)
    const intakesThisMonth = tenants.filter((t) => t.intakeDate.startsWith(thisMonthIso))
    const exitsThisMonth = tenants.filter((t) => t.exitDate?.startsWith(thisMonthIso))

    // ---- Birthdays this month, ordered by day ----
    const monthNumber = new Date(monthStart).getUTCMonth() + 1
    const birthdays = current
      .filter((t) => t.dob && Number(t.dob.slice(5, 7)) === monthNumber)
      .map((t) => ({
        _id: t._id,
        name: t.name,
        room: roomNumber(t.roomId),
        dob: t.dob!,
        day: Number(t.dob!.slice(8, 10)),
        turning: new Date(now).getUTCFullYear() - Number(t.dob!.slice(0, 4)),
      }))
      .sort((a, b) => a.day - b.day)

    // ---- What the next shift is walking into ----
    const openNeeds = needs.filter((n) => n.resolvedAt === undefined)
    const openOrders = orders.filter((w) => w.status !== 'closed')
    const roomsDue = rooms.filter(
      (r) =>
        !r.outOfService
        && (r.lastCheckedAt === undefined || now - r.lastCheckedAt > CHECK_INTERVAL_MS),
    )

    return {
      building: { _id: building._id, name: building.name, address: building.address },
      generatedAt: now,
      occupancy: {
        units: building.units,
        rooms: rooms.length,
        occupied: current.length,
        vacant: rooms.filter(
          (r) => !r.outOfService && !current.some((t) => t.roomId === r._id),
        ).length,
        outOfService: rooms.filter((r) => r.outOfService).length,
        prospective: tenants.filter((t) => t.status === 'prospective').length,
        occupancyRate: rooms.length ? current.length / rooms.length : 0,
      },
      money: {
        collectedCents,
        chargedCents,
        owedCents: current.reduce((s, t) => s + Math.max(0, t.balanceCents ?? 0), 0),
        depositHeldCents: current.reduce((s, t) => s + (t.depositHeldCents ?? 0), 0),
        depositShortCents: current.reduce(
          (s, t) => s + Math.max(0, t.depositRequiredCents - (t.depositHeldCents ?? 0)),
          0,
        ),
      },
      lastDay: {
        payments: ledger.filter((e) => e.kind === 'payment' && e.postedAt >= dayStart).length,
        paymentsCents: ledger
          .filter((e) => e.kind === 'payment' && e.postedAt >= dayStart)
          .reduce((s, e) => s + e.amountCents, 0),
        checks: checks.length,
        deficiencies: checks.filter((c) => c.outcome === 'deficiency').length,
        noEntry: checks.filter((c) => c.outcome === 'no-entry').length,
        depositMovements: deposits.filter((d) => d.postedAt >= dayStart).length,
      },
      handover: {
        roomsToCheck: roomsDue.map((r) => r.number),
        openNeeds: openNeeds.map((n) => ({
          _id: n._id,
          summary: n.summary,
          name: tenants.find((t) => t._id === n.tenantId)?.name ?? 'Former resident',
          room: roomNumber(tenants.find((t) => t._id === n.tenantId)?.roomId),
          daysOpen: Math.floor((now - n.openedAt) / 86_400_000),
        })),
        openOrders: openOrders.map((w) => ({
          _id: w._id,
          title: w.title,
          room: roomNumber(w.roomId),
          priority: w.priority,
          status: w.status,
          assignedTo: w.assignedTo,
        })),
        arrears: rentRoll
          .filter((r) => r.balanceCents >= r.monthlyRentCents * 2)
          .map((r) => ({ name: r.name, room: r.room, balanceCents: r.balanceCents })),
      },
      movement: {
        intakes: intakesThisMonth.map((t) => ({
          _id: t._id,
          name: t.name,
          room: roomNumber(t.roomId),
          date: t.intakeDate,
        })),
        exits: exitsThisMonth.map((t) => ({
          _id: t._id,
          name: t.name,
          date: t.exitDate!,
          reason: t.exitReason,
        })),
      },
      birthdays,
      rentRoll,
    }
  },
})

function startOfMonth(ts: number): number {
  const d = new Date(ts)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}
