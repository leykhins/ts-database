import {
  createAccount,
  getAuthUserId,
  invalidateSessions,
  modifyAccountCredentials,
  retrieveAccount,
} from '@convex-dev/auth/server'
import { v } from 'convex/values'
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import type { DataModel, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import {
  CAPABILITIES,
  ROLE_LABEL,
  effectiveRole,
  realRole,
  requireAdmin,
  requireStaff,
} from './model'
import type { Role } from './model'
import { staffRole } from './schema'

/** Password floor, applied wherever a credential is set. */
const MIN_PASSWORD = 8

/**
 * The signed-in staff member. Returns null rather than throwing when nobody is
 * signed in, so the shell can render its signed-out state without an error.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) return null
    const user = await ctx.db.get(userId)
    if (user === null) return null

    // `role` is what the server acts on — the simulated one while an
    // administrator is testing. `realRole` is who they actually are, and is
    // what the "stop testing" control checks.
    const role = effectiveRole(user)
    const actual = realRole(user)

    return {
      _id: user._id,
      name: user.name ?? user.email ?? 'Staff',
      email: user.email,
      role,
      roleLabel: ROLE_LABEL[role],
      realRole: actual,
      realRoleLabel: ROLE_LABEL[actual],
      isAdmin: role === 'admin',
      canAdminister: actual === 'admin',
      simulating: user.simulatedRole !== undefined,
      capabilities: CAPABILITIES[role],
      homeBuildingId: user.homeBuildingId,
    }
  },
})

/**
 * Act as another role, to test what that role can actually do.
 *
 * The simulated role is stored on the user and honoured by every permission
 * check on the server, so this is a real test rather than a UI preview. Only
 * the caller's *real* role is allowed to set or clear it — otherwise an
 * administrator testing as front desk could not get back.
 */
export const setSimulatedRole = mutation({
  args: { role: v.union(staffRole, v.null()) },
  handler: async (ctx, args) => {
    const user = await requireStaff(ctx)

    if (realRole(user) !== 'admin') {
      throw new Error('Only an administrator can test the app as another role.')
    }

    await ctx.db.patch(user._id, {
      // Simulating your own role is just not simulating.
      simulatedRole: args.role && args.role !== user.role ? args.role : undefined,
    })
    return null
  },
})

/**
 * Whether this deployment has no staff accounts at all. The sign-in screen uses
 * it to offer the one self-served account — the bootstrap administrator — and
 * to hide sign-up once staff exist. Deliberately public: it says nothing about
 * any person, and the sign-up endpoint enforces the same rule server-side.
 */
export const needsBootstrap = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query('users').take(1)
    return users.length === 0
  },
})

/** The staff directory, with each person's home building resolved. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx)
    const users = await ctx.db.query('users').collect()
    const buildings = await ctx.db.query('buildings').collect()
    const buildingName = new Map(buildings.map((b) => [b._id, b.name]))

    return users
      .map((user) => {
        const role: Role = user.role ?? 'front-desk'
        return {
          _id: user._id,
          name: user.name ?? user.email ?? 'Staff',
          email: user.email ?? '',
          role,
          roleLabel: ROLE_LABEL[role],
          simulatedRole: user.simulatedRole ?? null,
          homeBuildingId: user.homeBuildingId,
          homeBuilding: user.homeBuildingId
            ? buildingName.get(user.homeBuildingId) ?? null
            : null,
          isSelf: user._id === admin._id,
          createdAt: user._creationTime,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  },
})

/**
 * Guard for the account actions below. Actions have no database access, so the
 * admin check runs as a query and the action refuses if it throws.
 */
export const assertAdmin = internalQuery({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx)
    return admin._id
  },
})

export const findByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    return await ctx.db
      .query('users')
      .withIndex('email', (q) => q.eq('email', email))
      .first()
  },
})

/**
 * Create a staff account with a temporary password.
 *
 * An action, because hashing the credential is part of the auth library's
 * account creation and is not available inside a mutation.
 */
export const createStaff = action({
  args: {
    name: v.string(),
    email: v.string(),
    temporaryPassword: v.string(),
    role: staffRole,
    homeBuildingId: v.optional(v.id('buildings')),
  },
  handler: async (ctx, args): Promise<{ userId: Id<'users'> }> => {
    await ctx.runQuery(internal.users.assertAdmin, {})

    const name = args.name.trim()
    // Sign-in matches on the account id, which is the email verbatim, so both
    // ends lower-case it — otherwise "Bob@" and "bob@" are different accounts.
    const email = args.email.trim().toLowerCase()

    if (!name) throw new Error('Enter the employee’s name.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Enter a valid work email address.')
    }
    if (args.temporaryPassword.length < MIN_PASSWORD) {
      throw new Error(`The temporary password must be at least ${MIN_PASSWORD} characters.`)
    }

    const existing = await ctx.runQuery(internal.users.findByEmail, { email })
    if (existing) throw new Error('A staff account already uses that email.')

    const { user } = await createAccount<DataModel>(ctx, {
      provider: 'password',
      account: { id: email, secret: args.temporaryPassword },
      profile: {
        name,
        email,
        role: args.role,
        ...(args.homeBuildingId ? { homeBuildingId: args.homeBuildingId } : {}),
      },
    })

    return { userId: user._id }
  },
})

/** The signed-in user, for the account actions. Never takes an id from a caller. */
export const myAccount = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) return null
    const user = await ctx.db.get(userId)
    return user ? { _id: user._id, email: user.email ?? null } : null
  },
})

/**
 * Change your own password.
 *
 * The current password is verified by attempting to retrieve the account with
 * it — the auth library's own credential check — so a stolen session cannot be
 * used to lock the real owner out. Other sessions are invalidated; the one
 * doing the changing keeps working.
 */
export const changeMyPassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const me = await ctx.runQuery(internal.users.myAccount, {})
    if (!me?.email) throw new Error('Not signed in.')

    if (args.newPassword.length < MIN_PASSWORD) {
      throw new Error(`Choose a password of at least ${MIN_PASSWORD} characters.`)
    }
    if (args.newPassword === args.currentPassword) {
      throw new Error('The new password must be different from the current one.')
    }

    try {
      await retrieveAccount<DataModel>(ctx, {
        provider: 'password',
        account: { id: me.email, secret: args.currentPassword },
      })
    } catch {
      throw new Error('Your current password is not correct.')
    }

    await modifyAccountCredentials<DataModel>(ctx, {
      provider: 'password',
      account: { id: me.email, secret: args.newPassword },
    })
    return null
  },
})

/**
 * Create a staff account from the command line, for testing and for recovering
 * a deployment nobody can sign in to:
 *
 *     npx convex run users:createTestAccount \
 *       '{"name":"QA Tester","email":"qa@housing.org","password":"…","role":"admin"}'
 *
 * Internal, so it is not reachable from the browser, and it takes the password
 * as an argument rather than defaulting to one — a known-password account that
 * a deploy could mint on its own is a backdoor. Anyone who can run this already
 * holds the deploy key and could patch a role directly.
 */
export const createTestAccount = internalAction({
  args: {
    name: v.string(),
    email: v.string(),
    password: v.string(),
    role: staffRole,
  },
  handler: async (ctx, args): Promise<{ userId: Id<'users'>; email: string }> => {
    const email = args.email.trim().toLowerCase()

    if (args.password.length < MIN_PASSWORD) {
      throw new Error(`The password must be at least ${MIN_PASSWORD} characters.`)
    }

    const existing = await ctx.runQuery(internal.users.findByEmail, { email })
    if (existing) throw new Error(`An account already uses ${email}.`)

    const { user } = await createAccount<DataModel>(ctx, {
      provider: 'password',
      account: { id: email, secret: args.password },
      profile: { name: args.name.trim(), email, role: args.role },
    })

    return { userId: user._id, email }
  },
})

export const updateRole = mutation({
  args: { userId: v.id('users'), role: staffRole },
  handler: async (ctx, args) => {
    await requireAdmin(ctx)

    const user = await ctx.db.get(args.userId)
    if (!user) throw new Error('That staff account no longer exists.')

    // A deployment with no administrator left can only be recovered from the CLI.
    if (user.role === 'admin' && args.role !== 'admin') {
      const admins = await ctx.db
        .query('users')
        .filter((q) => q.eq(q.field('role'), 'admin'))
        .take(2)
      if (admins.length < 2) {
        throw new Error(
          'This is the only administrator. Promote someone else before changing this role.',
        )
      }
    }

    await ctx.db.patch(args.userId, { role: args.role })
    return null
  },
})

export const setHomeBuilding = mutation({
  args: {
    userId: v.id('users'),
    homeBuildingId: v.union(v.id('buildings'), v.null()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx)

    const user = await ctx.db.get(args.userId)
    if (!user) throw new Error('That staff account no longer exists.')

    if (args.homeBuildingId) {
      const building = await ctx.db.get(args.homeBuildingId)
      if (!building) throw new Error('That building no longer exists.')
    }

    await ctx.db.patch(args.userId, {
      homeBuildingId: args.homeBuildingId ?? undefined,
    })
    return null
  },
})

/** Set a new temporary password and sign the person out of every device. */
export const resetPassword = action({
  args: { userId: v.id('users'), temporaryPassword: v.string() },
  handler: async (ctx, args): Promise<null> => {
    await ctx.runQuery(internal.users.assertAdmin, {})

    if (args.temporaryPassword.length < MIN_PASSWORD) {
      throw new Error(`The temporary password must be at least ${MIN_PASSWORD} characters.`)
    }

    const user = await ctx.runQuery(internal.users.getById, { userId: args.userId })
    if (!user?.email) throw new Error('That staff account has no email to reset.')

    await modifyAccountCredentials<DataModel>(ctx, {
      provider: 'password',
      account: { id: user.email, secret: args.temporaryPassword },
    })
    await invalidateSessions<DataModel>(ctx, { userId: args.userId })
    return null
  },
})

export const getById = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => await ctx.db.get(userId),
})

/**
 * Remove a staff account: sessions first, then the credential rows, then the
 * profile. Ledger entries keep the user id of whoever posted them — those stay
 * as they are, because "posted by a deleted account" is still the truth.
 */
export const remove = action({
  args: { userId: v.id('users') },
  handler: async (ctx, args): Promise<null> => {
    const adminId = await ctx.runQuery(internal.users.assertAdmin, {})
    if (adminId === args.userId) {
      throw new Error('You cannot remove your own account.')
    }

    await invalidateSessions<DataModel>(ctx, { userId: args.userId })
    await ctx.runMutation(internal.users.purge, { userId: args.userId })
    return null
  },
})

/**
 * Recovery hatch, CLI only:
 *
 *     npx convex run users:promoteToAdmin '{"email":"name@housing.org"}'
 *
 * Internal, so it is not reachable from the browser. This is the way back in
 * if a deployment ends up with no administrator, and the way an account made
 * before roles were enforced gets promoted.
 */
export const promoteToAdmin = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const user = await ctx.db
      .query('users')
      .withIndex('email', (q) => q.eq('email', email.trim().toLowerCase()))
      .first()
    if (!user) throw new Error(`No staff account with the email ${email}.`)

    await ctx.db.patch(user._id, { role: 'admin' })
    return { userId: user._id, name: user.name ?? user.email }
  },
})

export const purge = internalMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId)
    if (!user) return null

    if (user.role === 'admin') {
      const admins = await ctx.db
        .query('users')
        .filter((q) => q.eq(q.field('role'), 'admin'))
        .take(2)
      if (admins.length < 2) {
        throw new Error('This is the only administrator account.')
      }
    }

    const accounts = await ctx.db
      .query('authAccounts')
      .withIndex('userIdAndProvider', (q) => q.eq('userId', userId))
      .collect()
    for (const account of accounts) await ctx.db.delete(account._id)

    await ctx.db.delete(userId)
    return null
  },
})
