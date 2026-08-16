import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import {
  applyDepositEntry,
  applyLedgerEntry,
  requireCapability,
  requireStaff,
  resolveBuilding,
} from './model'

const paymentMethod = v.union(
  v.literal('cheque'),
  v.literal('cash'),
  v.literal('eft'),
  v.literal('money-order'),
)

/** `Jun 2026` — the period label a month's charges are grouped under. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function monthLabel(ts: number): string {
  const d = new Date(ts)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Rent roster: who owes what, worst first — the order staff work the list. */
export const roster = query({
  args: { buildingId: v.optional(v.id('buildings')) },
  handler: async (ctx, args) => {
    await requireStaff(ctx)
    const building = await resolveBuilding(ctx, args.buildingId)
    if (!building) return null

    const buildingId = building._id
    const [tenants, rooms] = await Promise.all([
      ctx.db
        .query('tenants')
        .withIndex('by_building_status', (q) =>
          q.eq('buildingId', buildingId).eq('status', 'current'),
        )
        .collect(),
      ctx.db
        .query('rooms')
        .withIndex('by_building', (q) => q.eq('buildingId', buildingId))
        .collect(),
    ])

    const roomById = new Map(rooms.map((r) => [r._id as string, r]))

    const rows = tenants
      .map((t) => {
        const balanceCents = t.balanceCents ?? 0
        const monthsBehind =
          t.monthlyRentCents > 0 ? Math.floor(balanceCents / t.monthlyRentCents) : 0
        return {
          _id: t._id,
          name: t.name,
          room: t.roomId ? (roomById.get(t.roomId)?.number ?? '—') : '—',
          monthlyRentCents: t.monthlyRentCents,
          balanceCents,
          lastPaymentAt: t.lastPaymentAt ?? null,
          lastPaymentCents: t.lastPaymentCents ?? null,
          // "High / Low / No Warning" — the legacy system's own vocabulary.
          warning: monthsBehind >= 2 ? 'high' : balanceCents > 0 ? 'low' : 'none',
        }
      })
      .sort((a, b) => b.balanceCents - a.balanceCents)

    const totals = rows.reduce(
      (acc, r) => {
        acc.dueCents += Math.max(0, r.balanceCents)
        acc.chargedCents += r.monthlyRentCents
        return acc
      },
      { dueCents: 0, chargedCents: 0 },
    )

    // The current period, and whether it has been charged yet — the Rents
    // screen offers to post it and must not offer twice.
    const now = Date.now()
    const period = monthLabel(now)
    const charged = await ctx.db
      .query('rentLedger')
      .withIndex('by_building_posted', (q) =>
        q.eq('buildingId', buildingId).gte('postedAt', startOfMonth(now)),
      )
      .collect()
    const chargedThisPeriod = charged.filter(
      (e) => e.kind === 'charge' && e.periodLabel === period,
    ).length

    return {
      building: { _id: building._id, name: building.name },
      rows,
      period,
      chargedThisPeriod,
      collectedThisMonthCents: charged
        .filter((e) => e.kind === 'payment')
        .reduce((sum, e) => sum + e.amountCents, 0),
      totals: {
        ...totals,
        warnings: rows.filter((r) => r.warning !== 'none').length,
        highWarnings: rows.filter((r) => r.warning === 'high').length,
      },
    }
  },
})

function startOfMonth(ts: number): number {
  const d = new Date(ts)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

/**
 * Post a rent payment. Writes a ledger row and moves the tenant's cached
 * balance in the same transaction — see `model.ts` for why both exist.
 */
export const receivePayment = mutation({
  args: {
    tenantId: v.id('tenants'),
    amountCents: v.number(),
    method: paymentMethod,
    reference: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'money')

    if (!Number.isInteger(args.amountCents) || args.amountCents <= 0) {
      throw new Error('Payment amount must be a positive number of cents.')
    }

    const tenant = await ctx.db.get(args.tenantId)
    if (!tenant) throw new Error('Tenant not found.')

    const now = Date.now()
    return await applyLedgerEntry(ctx, tenant, {
      kind: 'payment',
      amountCents: args.amountCents,
      postedAt: now,
      periodLabel: monthLabel(now),
      method: args.method,
      reference: args.reference,
      note: args.note,
      postedBy: staff._id,
    })
  },
})

/**
 * Charge the month's rent to every current tenant in a building.
 *
 * Shared by the button on the Rents screen and by the monthly cron, so the two
 * cannot diverge. Charging a period twice is refused per tenant rather than
 * de-duplicated afterwards: unpicking a double charge takes a week.
 */
export async function chargePeriod(
  ctx: MutationCtx,
  buildingId: Id<'buildings'>,
  periodLabel: string,
  postedBy?: Id<'users'>,
): Promise<{ charged: number; skipped: number; amountCents: number }> {
  const tenants = await ctx.db
    .query('tenants')
    .withIndex('by_building_status', (q) =>
      q.eq('buildingId', buildingId).eq('status', 'current'),
    )
    .collect()

  const alreadyCharged = new Set<string>()
  for (const t of tenants) {
    const existing = await ctx.db
      .query('rentLedger')
      .withIndex('by_tenant', (q) => q.eq('tenantId', t._id))
      .collect()
    if (existing.some((e) => e.kind === 'charge' && e.periodLabel === periodLabel)) {
      alreadyCharged.add(t._id)
    }
  }

  const now = Date.now()
  let charged = 0
  let amountCents = 0
  for (const t of tenants) {
    if (alreadyCharged.has(t._id)) continue
    await applyLedgerEntry(ctx, t, {
      kind: 'charge',
      amountCents: t.monthlyRentCents,
      postedAt: now,
      periodLabel,
      postedBy,
    })
    charged++
    amountCents += t.monthlyRentCents
  }

  return { charged, skipped: tenants.length - charged, amountCents }
}

export const chargeMonthlyRent = mutation({
  args: {
    buildingId: v.id('buildings'),
    periodLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'money')
    return await chargePeriod(
      ctx,
      args.buildingId,
      args.periodLabel ?? monthLabel(Date.now()),
      staff._id,
    )
  },
})

/** Record money into or out of a tenant's security deposit. */
export const adjustDeposit = mutation({
  args: {
    tenantId: v.id('tenants'),
    amountCents: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'money')
    if (!Number.isInteger(args.amountCents) || args.amountCents === 0) {
      throw new Error('Deposit adjustment must be a non-zero number of cents.')
    }
    if (!args.reason.trim()) {
      throw new Error('Say what this deposit movement is for.')
    }

    const tenant = await ctx.db.get(args.tenantId)
    if (!tenant) throw new Error('Tenant not found.')

    const held = tenant.depositHeldCents ?? 0
    if (args.amountCents < 0 && held + args.amountCents < 0) {
      throw new Error(
        'That is more than is held for this tenancy — a deposit cannot go negative.',
      )
    }

    return await applyDepositEntry(ctx, tenant, {
      amountCents: args.amountCents,
      postedAt: Date.now(),
      reason: args.reason.trim(),
      postedBy: staff._id,
    })
  },
})
