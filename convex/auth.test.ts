/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { normalizeUsername, validateUsername } from './model'

/**
 * Username sign-in.
 *
 * The normalization rules are tested as pure functions because they are what
 * decides whether a typed name finds an account at all: the normalized username
 * *is* the `authAccounts` identifier, so a disagreement between the two ends
 * shows up as "no such user" rather than as anything diagnosable.
 */

const modules = import.meta.glob('./**/*.ts')

describe('username rules', () => {
  test('a username is trimmed and lower-cased', () => {
    expect(normalizeUsername('  Asha.Okafor  ')).toBe('asha.okafor')
    expect(normalizeUsername('ASHA')).toBe('asha')
    expect(normalizeUsername(undefined)).toBe('')
  })

  test('an email address typed into the username box says so', () => {
    // The likeliest mistake, so it gets its own message rather than a generic
    // one about permitted characters.
    expect(() => validateUsername('asha@housing.org')).toThrow(/not an email address/)
  })

  test('a too-short, too-long or malformed username is refused', () => {
    expect(() => validateUsername('ab')).toThrow(/at least 3/)
    expect(() => validateUsername('a'.repeat(33))).toThrow(/at most 32/)
    expect(() => validateUsername('asha okafor')).toThrow(/lowercase letters/)
    expect(() => validateUsername('.asha')).toThrow(/lowercase letters/)
    expect(() => validateUsername('asha!')).toThrow(/lowercase letters/)
  })

  test('an ordinary username passes', () => {
    for (const name of ['asha', 'asha.okafor', 'a_b-c', 'staff01']) {
      expect(() => validateUsername(name)).not.toThrow()
    }
  })
})

describe('accounts', () => {
  test('a duplicate username is refused before an account is made', async () => {
    const t = convexTest(schema, modules)

    const adminId = await t.run(async (ctx) =>
      ctx.db.insert('users', { name: 'Ada', username: 'ada', role: 'admin' }),
    )
    const admin = t.withIdentity({ subject: `${adminId}|session` })

    await expect(
      admin.action(api.users.createStaff, {
        name: 'Someone Else',
        username: 'ADA', // same account once normalized
        temporaryPassword: 'harbour-1234',
        role: 'rsw',
      }),
    ).rejects.toThrow(/already taken/)
  })

  test('a username that is really an email is refused at creation', async () => {
    const t = convexTest(schema, modules)

    const adminId = await t.run(async (ctx) =>
      ctx.db.insert('users', { name: 'Ada', username: 'ada', role: 'admin' }),
    )
    const admin = t.withIdentity({ subject: `${adminId}|session` })

    await expect(
      admin.action(api.users.createStaff, {
        name: 'Asha Okafor',
        username: 'asha@housing.org',
        temporaryPassword: 'harbour-1234',
        role: 'rsw',
      }),
    ).rejects.toThrow(/not an email address/)
  })

  test('only an administrator may create staff', async () => {
    const t = convexTest(schema, modules)

    const workerId = await t.run(async (ctx) =>
      ctx.db.insert('users', { name: 'Devon', username: 'devon', role: 'rsw' }),
    )

    await expect(
      t.withIdentity({ subject: `${workerId}|session` }).action(api.users.createStaff, {
        name: 'Nope',
        username: 'nope',
        temporaryPassword: 'harbour-1234',
        role: 'admin',
      }),
    ).rejects.toThrow(/cannot do this/)
  })

  test('promoting by username is the way back in', async () => {
    const t = convexTest(schema, modules)

    await t.run(async (ctx) => {
      await ctx.db.insert('users', { name: 'Asha', username: 'asha', role: 'rsw' })
    })

    // Mixed case, to prove the recovery hatch normalizes like everything else.
    await t.mutation(internal.users.promoteToAdmin, { username: '  ASHA ' })

    const user = await t.run(async (ctx) =>
      ctx.db
        .query('users')
        .withIndex('by_username', (q) => q.eq('username', 'asha'))
        .first(),
    )
    expect(user?.role).toBe('admin')
  })

  test('promoting an unknown username fails loudly', async () => {
    const t = convexTest(schema, modules)
    await expect(
      t.mutation(internal.users.promoteToAdmin, { username: 'ghost' }),
    ).rejects.toThrow(/No staff account/)
  })
})
