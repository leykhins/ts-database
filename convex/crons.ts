import { cronJobs } from 'convex/server'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalMutation } from './_generated/server'
import { chargePeriod, monthLabel } from './rents'

/**
 * Scheduled work.
 *
 * The month's rent has to be charged whether or not anyone remembers to press
 * a button — a balance that only moves when a human posts a payment tells you
 * nothing about who is behind. This runs on the 1st; the same `chargePeriod`
 * helper backs the manual button on the Rents screen, and both refuse to
 * charge a period twice, so an early manual run simply makes the cron a no-op.
 */

export const postMonthlyRent = internalMutation({
  args: {},
  handler: async (ctx) => {
    const buildings = await ctx.db.query('buildings').collect()
    const period = monthLabel(Date.now())

    // One transaction per building: a portfolio-wide charge in a single
    // mutation would grow past the transaction limits as sites are added.
    for (const building of buildings) {
      await ctx.scheduler.runAfter(0, internal.crons.postMonthlyRentForBuilding, {
        buildingId: building._id,
        periodLabel: period,
      })
    }

    return { buildings: buildings.length, period }
  },
})

export const postMonthlyRentForBuilding = internalMutation({
  args: { buildingId: v.id('buildings'), periodLabel: v.string() },
  handler: async (ctx, args) => {
    const result = await chargePeriod(ctx, args.buildingId, args.periodLabel)
    console.log(
      `[rent] ${args.periodLabel}: charged ${result.charged}, skipped ${result.skipped}`,
    )
    return result
  },
})

const crons = cronJobs()

// 06:00 UTC on the 1st of every month — before any shift starts anywhere the
// app is likely to run, and after month-end has definitely passed.
crons.cron('post monthly rent', '0 6 1 * *', internal.crons.postMonthlyRent, {})

export default crons
