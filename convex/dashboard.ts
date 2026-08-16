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
 */
export const overview = query({
  args: { buildingId: v.optional(v.id('buildings')) },
  handler: async (ctx, args) => {
    await requireStaff(ctx)
    const building = await resolveBuilding(ctx, args.buildingId)
    if (!building) return null

    const now = Date.now()
    const buildingId = building._id

    const [rooms, tenants, ledger, deposits, needs, checks, workOrders] =
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
          .take(400),
        ctx.db
          .query('workOrders')
          .withIndex('by_building_status', (q) =>
            q.eq('buildingId', buildingId).eq('status', 'open'),
          )
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
      },
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}
