import { Password } from '@convex-dev/auth/providers/Password'
import { convexAuth } from '@convex-dev/auth/server'
import type { DataModel } from './_generated/dataModel'

/**
 * Staff sign-in. Email + password only — TS Database accounts are created by an
 * administrator for named employees, not self-served by the public.
 *
 * Two rules are enforced here rather than in the UI, because the sign-up
 * endpoint is on the public internet and the UI is not the security boundary:
 *
 *  1. The role is never read from sign-up parameters. Letting a caller name
 *     their own role means anyone who can reach the deployment can mint an
 *     administrator.
 *  2. Only the very first account on a deployment may be self-served, and it
 *     bootstraps as the administrator. Every later account is created from
 *     Admin → Staff by someone who already holds the role.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password<DataModel>({
      profile(params) {
        return {
          email: params.email as string,
          name: (params.name as string) || (params.email as string),
        }
      },
    }),
  ],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, { userId, existingUserId }) {
      // Signing in to an account that already exists — nothing to decide.
      if (existingUserId) return

      const user = await ctx.db.get(userId)
      // An admin-created account arrives with its role already set by
      // `users.createStaff`; leave it alone.
      if (user?.role) return

      // `take(2)` is enough to answer "is this the only user?" without
      // scanning a staff list that grows over time.
      const users = await ctx.db.query('users').take(2)
      if (users.length > 1) {
        throw new Error(
          'Staff accounts are created by an administrator. Ask your supervisor to add you.',
        )
      }

      await ctx.db.patch(userId, { role: 'admin' })
    },
  },
})
