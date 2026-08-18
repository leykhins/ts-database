import { ConvexCredentials } from '@convex-dev/auth/providers/ConvexCredentials'
import { convexAuth, createAccount, retrieveAccount } from '@convex-dev/auth/server'
import { Scrypt } from 'lucia'
import type { DataModel } from './_generated/dataModel'
import { MIN_PASSWORD, normalizeUsername, validateUsername } from './model'

/**
 * Staff sign-in: username and password. Accounts are created by an
 * administrator for named employees, not self-served by the public, and a
 * building worker should not need a work email address to come on shift.
 *
 * This is a `ConvexCredentials` provider rather than the library's `Password`
 * one for a single reason: `Password` keys the account on `profile().email`
 * (see `node_modules/@convex-dev/auth/dist/providers/Password.js`), so using it
 * would mean storing a username in a field called `email` forever.
 *
 * Everything else `Password` gives us, we still get, because it lives in
 * `createAccount`/`retrieveAccount` rather than in the provider:
 *   - the `authAccounts` row and its duplicate refusal
 *   - the failed-attempt rate limit (10 an hour, per account)
 *   - one indistinguishable error for "no such user" and "wrong password",
 *     so sign-in cannot be used to enumerate who works here
 *
 * The provider keeps the id `password`, which is what the account rows, the
 * client plugin and every `createAccount` call in `users.ts` already name.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    ConvexCredentials<DataModel>({
      id: 'password',

      authorize: async (params, ctx) => {
        const flow = params.flow
        const username = normalizeUsername(params.username as string | undefined)
        const secret = params.password as string | undefined

        if (!username) throw new Error('Enter your username.')
        if (!secret) throw new Error('Enter your password.')

        if (flow === 'signUp') {
          // Bootstrap only — `afterUserCreatedOrUpdated` below refuses the
          // second self-signup on a deployment.
          validateUsername(username)
          if (secret.length < MIN_PASSWORD) {
            throw new Error(`Choose a password of at least ${MIN_PASSWORD} characters.`)
          }

          const { user } = await createAccount<DataModel>(ctx, {
            provider: 'password',
            account: { id: username, secret },
            profile: {
              username,
              name: (params.name as string | undefined)?.trim() || username,
            },
            // An account is its username and nothing else. Linking by a
            // verified email would give a second path to adopt a staff account.
            shouldLinkViaEmail: false,
            shouldLinkViaPhone: false,
          })
          return { userId: user._id }
        }

        if (flow === 'signIn') {
          // Throws `InvalidAccountId`, `InvalidSecret` or `TooManyFailedAttempts`.
          // The caller cannot tell the first two apart, which is the point;
          // `login.vue` maps them to one message.
          const { user } = await retrieveAccount<DataModel>(ctx, {
            provider: 'password',
            account: { id: username, secret },
          })
          return { userId: user._id }
        }

        throw new Error('Missing `flow` param — it must be "signIn" or "signUp".')
      },

      // Identical to the `Password` provider's default hashing.
      crypto: {
        async hashSecret(password: string) {
          return await new Scrypt().hash(password)
        },
        async verifySecret(password: string, hash: string) {
          return await new Scrypt().verify(hash, password)
        },
      },
    }),
  ],
  callbacks: {
    /**
     * The first account on a deployment bootstraps as the administrator; every
     * later self-signup is refused. Accounts after the first are made from
     * Admin → Staff, which sets a role explicitly.
     */
    async afterUserCreatedOrUpdated(ctx, { userId, existingUserId }) {
      if (existingUserId) return
      const user = await ctx.db.get(userId)
      if (user?.role) return
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
