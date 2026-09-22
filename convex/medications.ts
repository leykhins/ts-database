import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { doseOutcome, medicationRoute } from './schema'
import {
  SHIFTS,
  localDate,
  localMinutes,
  photoUrlsFor,
  requireCapability,
  requireStaff,
  resolveBuilding,
  scoped,
  scopedTenant,
  shiftAt,
} from './model'

/**
 * The medication administration record.
 *
 * Two tables: `medications` are the orders — what a resident is dispensed,
 * how much, when — and `medicationAdministrations` is what actually happened
 * to each dose. The second is append-only and corrected by voiding, which is
 * the property that makes it a record rather than a checklist: the sheet
 * always shows what was charted, when, by whom, and what replaced it.
 *
 * Every order carries its own times, so two residents on the same drug can be
 * due at different hours, and one resident's 8am and another's 9am are simply
 * different slots. Nothing here writes an expectation. A dose is due because
 * an order says so and the clock says so, worked out when somebody looks, and
 * "overdue" is a slot past its window with nothing charted against it. The same
 * rule the rounds use, for the same reason — a queue of "dose due at 8pm" rows
 * would have to be rewritten every time an order changed.
 */

/** A dose may be given this far either side of its time and still be on time. */
export const DOSE_WINDOW_MINUTES = 60

/** Charted this long after it was given, the entry is marked as written up late. */
const BACK_CHARTED_MINUTES = 30

const MINUTE = 60_000
const DAY = 86_400_000

export type SlotStatus = 'upcoming' | 'due' | 'overdue' | 'charted' | 'not-charted'
export type Timing = 'early' | 'on-time' | 'late'

export const OUTCOME_LABEL: Record<Doc<'medicationAdministrations'>['outcome'], string> = {
  given: 'Given',
  refused: 'Refused',
  held: 'Held',
  absent: 'Absent',
  'not-given': 'Not given',
}

/* ------------------------------------------------------------------------
   Time
   ------------------------------------------------------------------------ */

/** Absolute ms for a minutes-from-local-midnight offset on a local date. */
export function atLocal(date: string, minutes: number, tzOffsetMinutes: number): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!, 0, minutes) + tzOffsetMinutes * MINUTE
}

/**
 * Where a scheduled dose stands, given the clock.
 *
 * `overdue` is only ever claimed once the window has closed. Inside it the
 * dose is `due` however late in the window it is — the cupboard is open and
 * somebody may be on their way, and calling it overdue while they are is how
 * a board starts lying. A past day with nothing charted is `not-charted`, a
 * gap in the record rather than something anyone can still act on.
 */
export function slotStatus(args: {
  date: string
  scheduledMinutes: number
  charted: boolean
  today: string
  nowMinutes: number
}): SlotStatus {
  if (args.charted) return 'charted'
  if (args.date < args.today) return 'not-charted'
  if (args.date > args.today) return 'upcoming'
  if (args.nowMinutes < args.scheduledMinutes - DOSE_WINDOW_MINUTES) return 'upcoming'
  if (args.nowMinutes <= args.scheduledMinutes + DOSE_WINDOW_MINUTES) return 'due'
  return 'overdue'
}

/** Given early, on time or late, measured against the slot it was charted for. */
export function doseTiming(scheduledAt: number, givenAt: number): Timing {
  const diff = (givenAt - scheduledAt) / MINUTE
  if (diff > DOSE_WINDOW_MINUTES) return 'late'
  if (diff < -DOSE_WINDOW_MINUTES) return 'early'
  return 'on-time'
}

/* ------------------------------------------------------------------------
   Which doses an order owes
   ------------------------------------------------------------------------ */

/** Could this order have any dose on a local date — started, not ended, not stopped before it. */
function liveOnDate(order: Doc<'medications'>, date: string, tzOffsetMinutes: number): boolean {
  if (order.startDate > date) return false
  if (order.endDate !== undefined && order.endDate < date) return false
  if (order.discontinuedAt !== undefined && localDate(order.discontinuedAt, tzOffsetMinutes) < date) {
    return false
  }
  return true
}

/**
 * Whether an order owes a particular scheduled dose.
 *
 * Two cutovers, both about the day an order changes:
 *
 * - A stopped order owes nothing after the moment it was stopped. Its earlier
 *   doses that day stay on the board — given, or overdue if nobody charted
 *   them — because they were owed when they fell due.
 * - A new order owes nothing that had already come and gone by the time it
 *   was written. An order transcribed at 3pm with an 8am time has not missed
 *   its 8am dose; it did not exist yet. A dose still inside its window when the
 *   order is written is owed — somebody is probably standing at the cupboard.
 *
 * Together those let a prescription change at 11am read as it should: the old
 * order's 8am dose given, its 6pm dose never owed, the new order's 2pm and 8pm
 * doses due, and nothing duplicated.
 */
export function slotApplies(
  order: Doc<'medications'>,
  date: string,
  minutes: number,
  tzOffsetMinutes: number,
): boolean {
  if (!liveOnDate(order, date, tzOffsetMinutes)) return false
  const at = atLocal(date, minutes, tzOffsetMinutes)
  if (order.discontinuedAt !== undefined && at >= order.discontinuedAt) return false
  if (
    order.startDate === date &&
    localDate(order._creationTime, tzOffsetMinutes) === date &&
    at + DOSE_WINDOW_MINUTES * MINUTE < order._creationTime
  ) {
    return false
  }
  return true
}

/** Is this order current today — on the list, not in the history. */
export function activeOn(order: Doc<'medications'>, date: string): boolean {
  if (order.discontinuedAt !== undefined) return false
  if (order.startDate > date) return false
  if (order.endDate !== undefined && order.endDate < date) return false
  return true
}

/** Orders for one building that could owe a dose on a date. */
async function ordersOnDate(
  ctx: QueryCtx | MutationCtx,
  buildingId: Id<'buildings'>,
  date: string,
  tzOffsetMinutes: number,
): Promise<Doc<'medications'>[]> {
  const all = await ctx.db
    .query('medications')
    .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
    .collect()
  return all.filter((m) => liveOnDate(m, date, tzOffsetMinutes))
}

function slotKey(medicationId: Id<'medications'>, minutes: number): string {
  return `${medicationId}:${minutes}`
}

/* ------------------------------------------------------------------------
   The day's doses, computed once and read three ways
   ------------------------------------------------------------------------ */

type Administration = {
  _id: Id<'medicationAdministrations'>
  outcome: Doc<'medicationAdministrations'>['outcome']
  reason: string | null
  note: string | null
  givenAt: number
  recordedAt: number
  recordedBy: string | null
  /** Scheduled doses only. */
  timing: Timing | null
  /** Written up well after it happened. Shown, never hidden. */
  backCharted: boolean
}

type DoseSlot = {
  order: Doc<'medications'>
  minutes: number
  scheduledAt: number
  status: SlotStatus
  administration: Administration | null
}

/**
 * Every scheduled dose a building owes on a date, with what was charted against
 * it, plus the day's PRN doses. The board, the Care Console tracker, the round
 * count and the bell all read this — four screens computing "is it overdue"
 * four ways is how they come to disagree.
 */
async function dayOfDoses(
  ctx: QueryCtx | MutationCtx,
  buildingId: Id<'buildings'>,
  date: string,
  now: number,
  tzOffsetMinutes: number,
) {
  const today = localDate(now, tzOffsetMinutes)
  const nowMinutes = localMinutes(now, tzOffsetMinutes)

  const [orders, rows] = await Promise.all([
    ordersOnDate(ctx, buildingId, date, tzOffsetMinutes),
    ctx.db
      .query('medicationAdministrations')
      .withIndex('by_building_date', (q) => q.eq('buildingId', buildingId).eq('date', date))
      .collect(),
  ])

  const live = rows.filter((r) => r.voidedAt === undefined)
  const staffIds = new Set(live.map((a) => a.recordedBy).filter(Boolean) as Id<'users'>[])
  const staff = await Promise.all([...staffIds].map((id) => ctx.db.get(id)))
  const nameOf = new Map(staff.map((u) => [u?._id as string, u?.name ?? null]))

  const shape = (row: Doc<'medicationAdministrations'>, scheduledAt: number | null): Administration => {
    const givenAt = row.givenAt ?? row.recordedAt
    return {
      _id: row._id,
      outcome: row.outcome,
      reason: row.reason ?? null,
      note: row.note ?? null,
      givenAt,
      recordedAt: row.recordedAt,
      recordedBy: row.recordedBy ? (nameOf.get(row.recordedBy) ?? null) : null,
      timing: scheduledAt === null ? null : doseTiming(scheduledAt, givenAt),
      backCharted: row.recordedAt - givenAt > BACK_CHARTED_MINUTES * MINUTE,
    }
  }

  const bySlot = new Map(
    live
      .filter((a) => a.scheduledMinutes !== undefined)
      .map((a) => [slotKey(a.medicationId, a.scheduledMinutes!), a] as const),
  )

  const slots: DoseSlot[] = []
  for (const order of orders) {
    for (const minutes of [...order.times].sort((a, b) => a - b)) {
      const row = bySlot.get(slotKey(order._id, minutes))
      // A charted dose always shows, even on a slot the order no longer owes —
      // it happened, and the board is the record of what happened.
      if (!row && !slotApplies(order, date, minutes, tzOffsetMinutes)) continue
      const scheduledAt = atLocal(date, minutes, tzOffsetMinutes)
      slots.push({
        order,
        minutes,
        scheduledAt,
        status: slotStatus({ date, scheduledMinutes: minutes, charted: row !== undefined, today, nowMinutes }),
        administration: row ? shape(row, scheduledAt) : null,
      })
    }
  }

  const prn = new Map<string, Administration[]>()
  for (const row of live) {
    if (row.scheduledMinutes !== undefined) continue
    const list = prn.get(row.medicationId) ?? []
    list.push(shape(row, null))
    prn.set(row.medicationId, list)
  }
  for (const list of prn.values()) list.sort((a, b) => a.givenAt - b.givenAt)

  return { orders, slots, prn, today }
}

/**
 * How many scheduled doses fall inside a stretch of the day, for the
 * medication round on the Care Console. Doses, not residents: a round that
 * covers eleven people on one tablet each and one person on four is a round
 * of fifteen.
 */
export async function scheduledDosesBetween(
  ctx: QueryCtx | MutationCtx,
  buildingId: Id<'buildings'>,
  date: string,
  fromMinutes: number,
  toMinutes: number,
  tzOffsetMinutes: number,
): Promise<number> {
  const orders = await ordersOnDate(ctx, buildingId, date, tzOffsetMinutes)
  let count = 0
  for (const order of orders) {
    for (const t of order.times) {
      if (t >= fromMinutes && t < toMinutes && slotApplies(order, date, t, tzOffsetMinutes)) count++
    }
  }
  return count
}

/**
 * The medication round, read as the times residents are actually due.
 *
 * The other two rounds are the building — a frequency is the whole truth about
 * them, because every hour of the shift is the same job. Medication is not: it
 * is due when the orders say it is due, and a four-hourly strip drawn from
 * local midnight put the round at 8 and 12 on a shift whose doses fell at 8, 9
 * and 2. A worker reading that strip is reading a schedule nobody is on.
 *
 * So the slots are the distinct times the shift's doses fall at, and a slot is
 * walked when every dose in it is charted. There is nothing separate to log —
 * the MAR is the record, and a checkbox beside it would be a second place to
 * claim the same work.
 */
export async function medicationRoundSlots(
  ctx: QueryCtx | MutationCtx,
  buildingId: Id<'buildings'>,
  shiftDate: string,
  shift: { from: number; to: number },
  tzOffsetMinutes: number,
  now: number,
) {
  const { slots } = await dayOfDoses(ctx, buildingId, shiftDate, now, tzOffsetMinutes)

  const byTime = new Map<number, { due: number; charted: number }>()
  for (const slot of slots) {
    if (slot.minutes < shift.from * 60 || slot.minutes >= shift.to * 60) continue
    const entry = byTime.get(slot.minutes) ?? { due: 0, charted: 0 }
    entry.due++
    if (slot.administration) entry.charted++
    byTime.set(slot.minutes, entry)
  }

  return [...byTime.entries()]
    .sort(([a], [b]) => a - b)
    .map(([minutes, counts]) => {
      const scheduledAt = atLocal(shiftDate, minutes, tzOffsetMinutes)
      // The same window the MAR charts against, so the strip and the board
      // cannot disagree about whether a dose is still in time.
      const startsAt = scheduledAt - DOSE_WINDOW_MINUTES * MINUTE
      const endsAt = scheduledAt + DOSE_WINDOW_MINUTES * MINUTE

      const status =
        counts.charted >= counts.due
          ? 'done'
          : now >= endsAt
            ? 'missed'
            : now >= startsAt
              ? 'now'
              : 'upcoming'

      return {
        startMinutes: minutes,
        endMinutes: minutes + DOSE_WINDOW_MINUTES,
        startsAt,
        endsAt,
        status: status as 'done' | 'missed' | 'now' | 'upcoming',
        doneAt: null,
        due: counts.due,
        charted: counts.charted,
      }
    })
}

/**
 * Residents with doses past their window and nothing charted, for the bell.
 * One entry per resident, so a person on four medications is one line and not
 * four — the bell has to be finishable.
 */
export async function overdueByResident(
  ctx: QueryCtx,
  buildingId: Id<'buildings'>,
  now: number,
  tzOffsetMinutes: number,
): Promise<{ tenantId: Id<'tenants'>; count: number; earliestMinutes: number; date: string }[]> {
  const date = localDate(now, tzOffsetMinutes)
  const { slots } = await dayOfDoses(ctx, buildingId, date, now, tzOffsetMinutes)

  const byTenant = new Map<string, { count: number; earliestMinutes: number }>()
  for (const slot of slots) {
    if (slot.status !== 'overdue') continue
    const entry = byTenant.get(slot.order.tenantId) ?? { count: 0, earliestMinutes: slot.minutes }
    entry.count++
    entry.earliestMinutes = Math.min(entry.earliestMinutes, slot.minutes)
    byTenant.set(slot.order.tenantId, entry)
  }

  return [...byTenant.entries()].map(([tenantId, e]) => ({
    tenantId: tenantId as Id<'tenants'>,
    ...e,
    date,
  }))
}

function orderSummary(order: Doc<'medications'>) {
  return {
    _id: order._id,
    name: order.name,
    strength: order.strength ?? null,
    dose: order.dose,
    route: order.route,
    instructions: order.instructions ?? null,
    times: [...order.times].sort((a, b) => a - b),
    prn: order.prn,
    prnIndication: order.prnIndication ?? null,
    prnMaxPerDay: order.prnMaxPerDay ?? null,
    prescriber: order.prescriber ?? null,
    startDate: order.startDate,
    endDate: order.endDate ?? null,
    discontinuedAt: order.discontinuedAt ?? null,
  }
}

/* ------------------------------------------------------------------------
   Reading the record
   ------------------------------------------------------------------------ */

/**
 * The board: every programme resident, every order, one cell per dose.
 *
 * A resident is on the programme when `health.careRxProgram` says so. One with
 * a live order and the flag cleared stays on the board with a warning rather
 * than disappearing — a dose falling off a screen is the failure this record
 * exists to prevent.
 */
export const board = query({
  args: {
    buildingId: v.optional(v.id('buildings')),
    date: v.string(),
    now: v.number(),
    tzOffsetMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx)
    const building = await resolveBuilding(ctx, staff, args.buildingId)
    if (!building) return null

    const [tenants, rooms, day] = await Promise.all([
      ctx.db
        .query('tenants')
        .withIndex('by_building_status', (q) =>
          q.eq('buildingId', building._id).eq('status', 'current'),
        )
        .collect(),
      ctx.db
        .query('rooms')
        .withIndex('by_building', (q) => q.eq('buildingId', building._id))
        .collect(),
      dayOfDoses(ctx, building._id, args.date, args.now, args.tzOffsetMinutes),
    ])

    const roomById = new Map(rooms.map((r) => [r._id as string, r]))
    const slotsByOrder = new Map<string, DoseSlot[]>()
    for (const slot of day.slots) {
      const list = slotsByOrder.get(slot.order._id) ?? []
      list.push(slot)
      slotsByOrder.set(slot.order._id, list)
    }

    // An order is on the board for this date if it owes or has a dose on it,
    // or it is a live PRN order. A stopped order with nothing left to show is
    // history, and lives on the resident's record.
    const shown = day.orders.filter((o) =>
      o.prn
        ? o.discontinuedAt === undefined || day.prn.has(o._id)
        : slotsByOrder.has(o._id),
    )
    const ordersByTenant = new Map<string, Doc<'medications'>[]>()
    for (const order of shown) {
      const list = ordersByTenant.get(order.tenantId) ?? []
      list.push(order)
      ordersByTenant.set(order.tenantId, list)
    }

    const onBoard = tenants.filter(
      (t) => t.health?.careRxProgram === true || ordersByTenant.has(t._id),
    )
    const photos = await photoUrlsFor(ctx, onBoard)

    const counts = { due: 0, overdue: 0, given: 0, notGiven: 0, prn: 0, doses: 0, late: 0 }
    for (const slot of day.slots) {
      counts.doses++
      if (slot.status === 'due') counts.due++
      if (slot.status === 'overdue') counts.overdue++
      if (slot.administration?.outcome === 'given') counts.given++
      if (slot.administration && slot.administration.outcome !== 'given') counts.notGiven++
      if (slot.administration?.outcome === 'given' && slot.administration.timing !== 'on-time') counts.late++
    }
    for (const list of day.prn.values()) counts.prn += list.length

    const residents = onBoard
      .map((tenant) => {
        const own = (ordersByTenant.get(tenant._id) ?? []).sort((a, b) => {
          if (a.prn !== b.prn) return a.prn ? 1 : -1
          return (a.times[0] ?? 0) - (b.times[0] ?? 0) || a.name.localeCompare(b.name)
        })

        const medications = own.map((order) => ({
          ...orderSummary(order),
          slots: (slotsByOrder.get(order._id) ?? []).map((s) => ({
            minutes: s.minutes,
            status: s.status,
            administration: s.administration,
          })),
          prnToday: day.prn.get(order._id) ?? [],
        }))

        const mine = medications.flatMap((m) => m.slots)
        return {
          tenantId: tenant._id,
          name: tenant.name,
          room: tenant.roomId ? (roomById.get(tenant.roomId)?.number ?? '—') : '—',
          photoUrl: photos.get(tenant._id) ?? null,
          supportLevel: tenant.supportLevel,
          onProgramme: tenant.health?.careRxProgram === true,
          allergies: tenant.health?.allergies ?? null,
          medications,
          overdue: mine.filter((s) => s.status === 'overdue').length,
          due: mine.filter((s) => s.status === 'due').length,
        }
      })
      .sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }))

    return {
      building: { _id: building._id, name: building.name },
      date: args.date,
      isToday: args.date === day.today,
      residents,
      counts,
    }
  },
})

/**
 * This shift's doses, for the tracker on the Care Console.
 *
 * The same slots as the board, cut to the live shift and flattened into the
 * order a worker walks them: by time, then by room. Worst first would re-order
 * the list every time somebody charted, and a worker glancing back from the
 * cupboard should find the next dose where they left it.
 */
export const shift = query({
  args: {
    buildingId: v.optional(v.id('buildings')),
    now: v.number(),
    tzOffsetMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx)
    const building = await resolveBuilding(ctx, staff, args.buildingId)
    if (!building) return null

    const { key, shiftDate } = shiftAt(args.now, args.tzOffsetMinutes)
    const segment = SHIFTS.find((s) => s.key === key)!
    const from = segment.from * 60
    const to = segment.to * 60

    const [day, tenants, rooms] = await Promise.all([
      dayOfDoses(ctx, building._id, shiftDate, args.now, args.tzOffsetMinutes),
      ctx.db
        .query('tenants')
        .withIndex('by_building_status', (q) =>
          q.eq('buildingId', building._id).eq('status', 'current'),
        )
        .collect(),
      ctx.db
        .query('rooms')
        .withIndex('by_building', (q) => q.eq('buildingId', building._id))
        .collect(),
    ])

    const tenantById = new Map(tenants.map((t) => [t._id as string, t]))
    const roomById = new Map(rooms.map((r) => [r._id as string, r]))
    const inShift = day.slots.filter((s) => s.minutes >= from && s.minutes < to)
    const photos = await photoUrlsFor(
      ctx,
      [...new Set(inShift.map((s) => s.order.tenantId as string))]
        .map((id) => tenantById.get(id))
        .filter((t): t is Doc<'tenants'> => t !== undefined),
    )

    const doses = inShift
      .map((s) => {
        const tenant = tenantById.get(s.order.tenantId)
        return {
          tenantId: s.order.tenantId,
          name: tenant?.name ?? 'Former resident',
          room: tenant?.roomId ? (roomById.get(tenant.roomId)?.number ?? '—') : '—',
          photoUrl: photos.get(s.order.tenantId) ?? null,
          allergies: tenant?.health?.allergies ?? null,
          order: orderSummary(s.order),
          minutes: s.minutes,
          status: s.status,
          administration: s.administration,
        }
      })
      .sort(
        (a, b) =>
          a.minutes - b.minutes ||
          a.room.localeCompare(b.room, undefined, { numeric: true }) ||
          a.order.name.localeCompare(b.order.name),
      )

    return {
      building: { _id: building._id, name: building.name },
      shift: { key: segment.key, label: segment.label, hours: segment.hours },
      date: shiftDate,
      doses,
      counts: {
        total: doses.length,
        given: doses.filter((d) => d.administration?.outcome === 'given').length,
        notGiven: doses.filter((d) => d.administration && d.administration.outcome !== 'given').length,
        due: doses.filter((d) => d.status === 'due').length,
        overdue: doses.filter((d) => d.status === 'overdue').length,
        upcoming: doses.filter((d) => d.status === 'upcoming').length,
        late: doses.filter((d) => d.administration?.outcome === 'given' && d.administration.timing !== 'on-time').length,
      },
    }
  },
})

/**
 * One resident's record: every order they have ever had, and the last
 * fortnight of doses — voided rows included, struck through on the client.
 */
export const forResident = query({
  args: { tenantId: v.id('tenants'), now: v.number(), tzOffsetMinutes: v.number() },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx)
    const tenant = await scopedTenant(ctx, staff, args.tenantId)
    if (!tenant) return null

    const today = localDate(args.now, args.tzOffsetMinutes)
    const since = args.now - 14 * DAY

    const [orders, rows, room] = await Promise.all([
      ctx.db
        .query('medications')
        .withIndex('by_tenant', (q) => q.eq('tenantId', tenant._id))
        .collect(),
      ctx.db
        .query('medicationAdministrations')
        .withIndex('by_tenant_recorded', (q) => q.eq('tenantId', tenant._id).gte('recordedAt', since))
        .order('desc')
        .collect(),
      tenant.roomId ? ctx.db.get(tenant.roomId) : Promise.resolve(null),
    ])

    const userIds = new Set<Id<'users'>>()
    for (const r of rows) {
      if (r.recordedBy) userIds.add(r.recordedBy)
      if (r.voidedBy) userIds.add(r.voidedBy)
    }
    for (const o of orders) if (o.discontinuedBy) userIds.add(o.discontinuedBy)
    const users = await Promise.all([...userIds].map((id) => ctx.db.get(id)))
    const nameOf = new Map(users.map((u) => [u?._id as string, u?.name ?? null]))
    const orderById = new Map(orders.map((o) => [o._id as string, o]))

    const shape = (o: Doc<'medications'>) => {
      const replaced = o.replaces ? orderById.get(o.replaces) : undefined
      const replacedBy = orders.find((x) => x.replaces === o._id)
      return {
        ...orderSummary(o),
        discontinuedBy: o.discontinuedBy ? (nameOf.get(o.discontinuedBy) ?? null) : null,
        discontinuedReason: o.discontinuedReason ?? null,
        replaces: replaced ? `${replaced.name}${replaced.strength ? ` ${replaced.strength}` : ''} · ${replaced.dose}` : null,
        replacedBy: replacedBy ? `${replacedBy.name}${replacedBy.strength ? ` ${replacedBy.strength}` : ''} · ${replacedBy.dose}` : null,
        active: activeOn(o, today),
      }
    }

    return {
      tenant: {
        _id: tenant._id,
        name: tenant.name,
        room: room?.number ?? '—',
        dob: tenant.dob ?? null,
        onProgramme: tenant.health?.careRxProgram === true,
        allergies: tenant.health?.allergies ?? null,
        photoUrl: tenant.photoId ? await ctx.storage.getUrl(tenant.photoId) : null,
      },
      building: { _id: tenant.buildingId },
      active: orders.filter((o) => activeOn(o, today)).map(shape),
      inactive: orders
        .filter((o) => !activeOn(o, today))
        .sort((a, b) => (b.discontinuedAt ?? 0) - (a.discontinuedAt ?? 0))
        .map(shape),
      history: rows.map((r) => {
        const order = orderById.get(r.medicationId)
        const givenAt = r.givenAt ?? r.recordedAt
        const scheduledAt =
          r.scheduledMinutes !== undefined ? atLocal(r.date, r.scheduledMinutes, args.tzOffsetMinutes) : null
        return {
          _id: r._id,
          medication: order ? `${order.name}${order.strength ? ` ${order.strength}` : ''}` : 'Order removed',
          dose: order?.dose ?? null,
          date: r.date,
          scheduledMinutes: r.scheduledMinutes ?? null,
          outcome: r.outcome,
          reason: r.reason ?? null,
          note: r.note ?? null,
          givenAt,
          timing: scheduledAt === null ? null : doseTiming(scheduledAt, givenAt),
          backCharted: r.recordedAt - givenAt > BACK_CHARTED_MINUTES * MINUTE,
          recordedAt: r.recordedAt,
          recordedBy: r.recordedBy ? (nameOf.get(r.recordedBy) ?? null) : null,
          voidedAt: r.voidedAt ?? null,
          voidedBy: r.voidedBy ? (nameOf.get(r.voidedBy) ?? null) : null,
          voidReason: r.voidReason ?? null,
        }
      }),
    }
  },
})

/**
 * The month's sheet, laid out the way a paper MAR is: one row per order and
 * time, one column per day, an outcome code and the charter's initials in each
 * cell. PRN doses go in a log beneath. Voided rows are left off the grid —
 * they are on the resident's record, but a printed sheet with strike-throughs
 * in half the cells is a sheet nobody can read at the cupboard.
 */
export const sheet = query({
  args: {
    tenantId: v.id('tenants'),
    month: v.string(), // YYYY-MM
    tzOffsetMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx)
    const tenant = await scopedTenant(ctx, staff, args.tenantId)
    if (!tenant) return null

    const tz = args.tzOffsetMinutes ?? 0
    if (!/^\d{4}-\d{2}$/.test(args.month)) throw new Error('Month must be YYYY-MM.')
    const [y, m] = args.month.split('-').map(Number)
    const days = new Date(Date.UTC(y!, m!, 0)).getUTCDate()
    const first = `${args.month}-01`
    const last = `${args.month}-${String(days).padStart(2, '0')}`
    const dateOf = (i: number) => `${args.month}-${String(i + 1).padStart(2, '0')}`

    const [orders, building, room] = await Promise.all([
      ctx.db
        .query('medications')
        .withIndex('by_tenant', (q) => q.eq('tenantId', tenant._id))
        .collect(),
      ctx.db.get(tenant.buildingId),
      tenant.roomId ? ctx.db.get(tenant.roomId) : Promise.resolve(null),
    ])

    // Orders live on any day of the month, discontinued ones included: what
    // was given on the 3rd still belongs on the sheet after it was stopped on
    // the 20th.
    const inMonth = orders.filter((o) => {
      if (o.startDate > last) return false
      if (o.endDate !== undefined && o.endDate < first) return false
      if (o.discontinuedAt !== undefined && localDate(o.discontinuedAt, tz) < first) return false
      return true
    })

    const rows = (
      await Promise.all(
        inMonth.map((o) =>
          ctx.db
            .query('medicationAdministrations')
            .withIndex('by_medication_date', (q) =>
              q.eq('medicationId', o._id).gte('date', first).lte('date', last),
            )
            .collect(),
        ),
      )
    )
      .flat()
      .filter((r) => r.voidedAt === undefined)

    const userIds = new Set(rows.map((r) => r.recordedBy).filter(Boolean) as Id<'users'>[])
    const users = await Promise.all([...userIds].map((id) => ctx.db.get(id)))
    const initialsOf = new Map(users.map((u) => [u?._id as string, initials(u?.name)]))

    const cell = (r: Doc<'medicationAdministrations'>) => {
      const givenAt = r.givenAt ?? r.recordedAt
      return {
        outcome: r.outcome,
        initials: r.recordedBy ? (initialsOf.get(r.recordedBy) ?? '—') : '—',
        givenAt,
        timing:
          r.scheduledMinutes !== undefined
            ? doseTiming(atLocal(r.date, r.scheduledMinutes, tz), givenAt)
            : null,
      }
    }

    const grid = inMonth
      .filter((o) => !o.prn)
      .flatMap((o) =>
        [...o.times]
          .sort((a, b) => a - b)
          .map((minutes) => ({
            medicationId: o._id,
            name: o.name,
            strength: o.strength ?? null,
            dose: o.dose,
            route: o.route,
            instructions: o.instructions ?? null,
            minutes,
            startDate: o.startDate,
            endDate: o.endDate ?? null,
            discontinuedAt: o.discontinuedAt ?? null,
            days: Array.from({ length: days }, (_, i) => {
              const date = dateOf(i)
              const row = rows.find(
                (r) => r.medicationId === o._id && r.date === date && r.scheduledMinutes === minutes,
              )
              if (row) return cell(row)
              return slotApplies(o, date, minutes, tz) ? null : 'inactive'
            }),
          })),
      )
      .sort((a, b) => a.minutes - b.minutes || a.name.localeCompare(b.name))

    const prn = rows
      .filter((r) => r.scheduledMinutes === undefined)
      .sort((a, b) => (a.givenAt ?? a.recordedAt) - (b.givenAt ?? b.recordedAt))
      .map((r) => {
        const o = inMonth.find((x) => x._id === r.medicationId)
        return {
          date: r.date,
          medication: o ? `${o.name}${o.strength ? ` ${o.strength}` : ''} · ${o.dose}` : 'Order removed',
          reason: r.reason ?? null,
          note: r.note ?? null,
          ...cell(r),
        }
      })

    return {
      tenant: {
        name: tenant.name,
        dob: tenant.dob ?? null,
        room: room?.number ?? '—',
        allergies: tenant.health?.allergies ?? null,
      },
      building: { name: building?.name ?? '' },
      month: args.month,
      days,
      grid,
      prnOrders: inMonth
        .filter((o) => o.prn)
        .map((o) => ({
          name: o.name,
          strength: o.strength ?? null,
          dose: o.dose,
          indication: o.prnIndication ?? null,
          maxPerDay: o.prnMaxPerDay ?? null,
        })),
      prn,
    }
  },
})

function initials(name: string | undefined | null): string {
  if (!name) return '—'
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

/* ------------------------------------------------------------------------
   Orders
   ------------------------------------------------------------------------ */

const orderFields = {
  name: v.string(),
  strength: v.optional(v.string()),
  dose: v.string(),
  route: medicationRoute,
  instructions: v.optional(v.string()),
  times: v.array(v.number()),
  prn: v.boolean(),
  prnIndication: v.optional(v.string()),
  prnMaxPerDay: v.optional(v.number()),
  prescriber: v.optional(v.string()),
  startDate: v.string(),
  endDate: v.optional(v.string()),
}

type OrderFields = {
  name: string
  strength?: string
  dose: string
  route: Doc<'medications'>['route']
  instructions?: string
  times: number[]
  prn: boolean
  prnIndication?: string
  prnMaxPerDay?: number
  prescriber?: string
  startDate: string
  endDate?: string
}

/** The rules an order has to satisfy, whichever mutation is writing it. */
function validateOrder(args: OrderFields) {
  if (!args.name.trim()) throw new Error('Name the medication as it appears on the label.')
  if (!args.dose.trim()) throw new Error('Give the dose — "1 tablet", "5 ml", "2 puffs".')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.startDate)) throw new Error('Start date must be YYYY-MM-DD.')
  if (args.endDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(args.endDate)) {
    throw new Error('End date must be YYYY-MM-DD.')
  }
  if (args.endDate !== undefined && args.endDate < args.startDate) {
    throw new Error('The end date is before the start date.')
  }

  if (args.prn) {
    if (args.times.length) throw new Error('An as-needed order has no scheduled times.')
    if (!args.prnIndication?.trim()) throw new Error('Say what an as-needed dose is for.')
    if (args.prnMaxPerDay !== undefined && (!Number.isInteger(args.prnMaxPerDay) || args.prnMaxPerDay < 1)) {
      throw new Error('The daily cap must be a whole number of doses.')
    }
  } else {
    if (!args.times.length) throw new Error('Give at least one time of day, or mark the order as needed.')
    if (args.times.length > 12) throw new Error('An order has at most twelve times a day.')
    for (const t of args.times) {
      if (!Number.isInteger(t) || t < 0 || t >= 24 * 60) throw new Error('Times must fall inside the day.')
    }
    if (new Set(args.times).size !== args.times.length) throw new Error('A time is listed twice.')
  }
}

/** The stored shape of an order's own fields: trimmed, blanks absent, times sorted. */
function orderDoc(fields: OrderFields) {
  const text = (s: string | undefined) => (s?.trim() ? s.trim() : undefined)
  const doc = {
    name: fields.name.trim(),
    strength: text(fields.strength),
    dose: fields.dose.trim(),
    route: fields.route,
    instructions: text(fields.instructions),
    times: fields.prn ? [] : [...fields.times].sort((a, b) => a - b),
    prn: fields.prn,
    prnIndication: fields.prn ? text(fields.prnIndication) : undefined,
    prnMaxPerDay: fields.prn ? fields.prnMaxPerDay : undefined,
    prescriber: text(fields.prescriber),
    startDate: fields.startDate,
    endDate: fields.endDate || undefined,
  }
  return Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined)) as typeof doc
}

/**
 * Transcribe an order. The resident must be on the programme: the flag is the
 * decision that staff dispense for this person, and an order slipped onto a
 * record without it is an order nobody agreed to hand over.
 */
export const add = mutation({
  args: { tenantId: v.id('tenants'), ...orderFields },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'medications')
    const tenant = scoped(staff, await ctx.db.get(args.tenantId), 'That resident no longer exists.')

    if (tenant.health?.careRxProgram !== true) {
      throw new Error(
        'This resident is not on the medication programme. Mark them as on it in their health record first.',
      )
    }
    if (tenant.status !== 'current') throw new Error('Orders can only be added for current residents.')

    const { tenantId: _tenantId, ...fields } = args
    validateOrder(fields)

    return await ctx.db.insert('medications', {
      tenantId: tenant._id,
      buildingId: tenant.buildingId,
      ...orderDoc(fields),
      createdBy: staff._id,
    })
  },
})

/**
 * Correct a transcription — a typo in the name, the wrong strength copied off
 * the label. Doses already charted stay as charted: the record is of what
 * happened, and what happened is not changed by fixing a typo.
 *
 * A change in what is actually prescribed is not a correction. It is `change`.
 */
export const update = mutation({
  args: { medicationId: v.id('medications'), ...orderFields },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'medications')
    const order = scoped(staff, await ctx.db.get(args.medicationId), 'That order is no longer on file.')
    if (order.discontinuedAt !== undefined) throw new Error('A discontinued order cannot be edited.')

    const { medicationId: _id, ...fields } = args
    validateOrder(fields)

    await ctx.db.replace(order._id, {
      tenantId: order.tenantId,
      buildingId: order.buildingId,
      ...orderDoc(fields),
      ...(order.replaces ? { replaces: order.replaces } : {}),
      ...(order.createdBy ? { createdBy: order.createdBy } : {}),
    })
    return null
  },
})

/**
 * The prescription changed: a new dose, new times, a new strength.
 *
 * The old order is discontinued and a new one written in the same
 * transaction, linked by `replaces`. Editing in place would rewrite history —
 * last Tuesday's sheet would suddenly say she was on 20 mg when she was on 10 —
 * so the change is a cutover at this moment instead. Doses the old order owed
 * before now stay owed; doses after now belong to the new order. See
 * `slotApplies` for how the day of the change reads.
 */
export const change = mutation({
  args: {
    medicationId: v.id('medications'),
    reason: v.string(),
    tzOffsetMinutes: v.number(),
    ...orderFields,
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'medications')
    const order = scoped(staff, await ctx.db.get(args.medicationId), 'That order is no longer on file.')
    if (order.discontinuedAt !== undefined) throw new Error('That order is already discontinued.')
    if (!args.reason.trim()) throw new Error('Say what changed and who ordered it.')

    const { medicationId: _id, reason, tzOffsetMinutes, ...fields } = args
    const now = Date.now()
    const today = localDate(now, tzOffsetMinutes)
    // A change takes effect now. Backdating one would re-open doses that were
    // already charted against the old order.
    const next = { ...fields, startDate: fields.startDate < today ? today : fields.startDate }
    validateOrder(next)

    await ctx.db.patch(order._id, {
      discontinuedAt: now,
      discontinuedBy: staff._id,
      discontinuedReason: `Changed: ${reason.trim()}`,
    })

    return await ctx.db.insert('medications', {
      tenantId: order.tenantId,
      buildingId: order.buildingId,
      ...orderDoc(next),
      replaces: order._id,
      createdBy: staff._id,
    })
  },
})

/** Stop an order, with the reason. It stays on the record. */
export const discontinue = mutation({
  args: { medicationId: v.id('medications'), reason: v.string() },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'medications')
    const order = scoped(staff, await ctx.db.get(args.medicationId), 'That order is no longer on file.')
    if (order.discontinuedAt !== undefined) throw new Error('That order is already discontinued.')
    if (!args.reason.trim()) throw new Error('Say why the order was stopped.')

    await ctx.db.patch(order._id, {
      discontinuedAt: Date.now(),
      discontinuedBy: staff._id,
      discontinuedReason: args.reason.trim(),
    })
    return null
  },
})

/* ------------------------------------------------------------------------
   Charting
   ------------------------------------------------------------------------ */

/**
 * Chart a dose.
 *
 * `givenAt` is when it actually went in, entered by the worker and defaulting
 * to now — a dose given at 8:05 and written up at 9:40 is charted at 8:05,
 * with the 9:40 kept alongside it. It may fall on the day after the slot's
 * date, for a late-evening dose given after midnight, but never in the future.
 *
 * One row per order, date and slot: a second one is refused rather than
 * merged, because the first is the record and replacing it silently is the
 * thing a MAR must never do. Void it and chart again. A PRN dose has no slot
 * and needs the reason it was given; a non-`given` outcome needs the reason it
 * was not.
 */
export const administer = mutation({
  args: {
    medicationId: v.id('medications'),
    date: v.string(),
    scheduledMinutes: v.optional(v.number()),
    outcome: doseOutcome,
    reason: v.optional(v.string()),
    note: v.optional(v.string()),
    givenAt: v.optional(v.number()),
    now: v.number(),
    tzOffsetMinutes: v.number(),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'medications')
    const order = scoped(staff, await ctx.db.get(args.medicationId), 'That order is no longer on file.')

    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error('Date must be YYYY-MM-DD.')
    const today = localDate(args.now, args.tzOffsetMinutes)
    if (args.date > today) throw new Error('A dose cannot be charted for a day that has not come.')

    const givenAt = args.givenAt ?? args.now
    if (givenAt > args.now + MINUTE) throw new Error('The time given cannot be in the future.')
    const dayStart = atLocal(args.date, 0, args.tzOffsetMinutes)
    if (givenAt < dayStart || givenAt >= dayStart + DAY + 6 * 60 * MINUTE) {
      throw new Error('The time given has to fall on the day of the dose, or the early hours after it.')
    }

    const reason = args.reason?.trim() || undefined
    const note = args.note?.trim() || undefined

    if (order.prn) {
      if (args.scheduledMinutes !== undefined) throw new Error('An as-needed order has no scheduled slot.')
      if (!liveOnDate(order, args.date, args.tzOffsetMinutes) || (order.discontinuedAt !== undefined && givenAt >= order.discontinuedAt)) {
        throw new Error(
          order.discontinuedAt !== undefined
            ? 'That order had been discontinued by then.'
            : 'That order is not active on this date.',
        )
      }
      if (args.outcome === 'given' && !reason) throw new Error('Say why the as-needed dose was given.')
    } else {
      if (args.scheduledMinutes === undefined) throw new Error('Choose which dose this is.')
      if (!order.times.includes(args.scheduledMinutes)) {
        throw new Error('That time is not on the order.')
      }
      if (!slotApplies(order, args.date, args.scheduledMinutes, args.tzOffsetMinutes)) {
        throw new Error(
          order.discontinuedAt !== undefined
            ? 'That order has been discontinued, and this dose fell after it was stopped.'
            : 'That order is not active for this dose.',
        )
      }
    }
    if (args.outcome !== 'given' && !reason) {
      throw new Error(`Say why the dose was ${OUTCOME_LABEL[args.outcome].toLowerCase()}.`)
    }

    const sameDay = (
      await ctx.db
        .query('medicationAdministrations')
        .withIndex('by_medication_date', (q) =>
          q.eq('medicationId', order._id).eq('date', args.date),
        )
        .collect()
    ).filter((r) => r.voidedAt === undefined)

    if (!order.prn) {
      if (sameDay.some((r) => r.scheduledMinutes === args.scheduledMinutes)) {
        throw new Error('That dose is already charted. Void the entry first if it was a mistake.')
      }
    } else if (
      args.outcome === 'given' &&
      order.prnMaxPerDay !== undefined &&
      sameDay.filter((r) => r.outcome === 'given').length >= order.prnMaxPerDay
    ) {
      throw new Error(
        `${order.name} is capped at ${order.prnMaxPerDay} dose${order.prnMaxPerDay === 1 ? '' : 's'} a day, and that has been reached.`,
      )
    }

    return await ctx.db.insert('medicationAdministrations', {
      medicationId: order._id,
      tenantId: order.tenantId,
      buildingId: order.buildingId,
      date: args.date,
      ...(args.scheduledMinutes !== undefined ? { scheduledMinutes: args.scheduledMinutes } : {}),
      outcome: args.outcome,
      ...(reason ? { reason } : {}),
      ...(note ? { note } : {}),
      givenAt,
      recordedAt: args.now,
      recordedBy: staff._id,
    })
  },
})

/** Strike a charted dose through. The row stays; the slot reopens. */
export const voidEntry = mutation({
  args: { administrationId: v.id('medicationAdministrations'), reason: v.string() },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'medications')
    const row = scoped(
      staff,
      await ctx.db.get(args.administrationId),
      'That entry is no longer on the record.',
    )
    if (row.voidedAt !== undefined) throw new Error('That entry is already voided.')
    if (!args.reason.trim()) throw new Error('Say why the entry is being voided.')

    await ctx.db.patch(row._id, {
      voidedAt: Date.now(),
      voidedBy: staff._id,
      voidReason: args.reason.trim(),
    })
    return null
  },
})
