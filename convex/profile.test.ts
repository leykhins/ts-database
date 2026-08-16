/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'

/**
 * The resident record's two sensitive rules: who may see a social insurance
 * number, and what the printed responder sheet is allowed to carry.
 */

const modules = import.meta.glob('./**/*.ts')

async function setup() {
  const t = convexTest(schema, modules)

  const ids = await t.run(async (ctx) => {
    const buildingId = await ctx.db.insert('buildings', {
      name: 'Dodson Rooms',
      slug: 'dodson-rooms',
      address: '25 East Hastings Street',
      units: 1,
    })
    const roomId = await ctx.db.insert('rooms', {
      buildingId,
      number: '204',
      floor: 'Floor 2',
      sortKey: 0,
      monthlyRentCents: 54_000,
    })
    const tenantId = await ctx.db.insert('tenants', {
      buildingId,
      roomId,
      name: 'Dwayne Robinson',
      dob: '1968-07-04',
      intakeDate: '2024-03-12',
      status: 'current',
      supportLevel: 'moderate',
      monthlyRentCents: 54_000,
      depositRequiredCents: 54_000,
      balanceCents: 120_000,
      depositHeldCents: 54_000,
      sin: '123-456-789',
    })

    const users = {
      admin: await ctx.db.insert('users', { name: 'Ada', email: 'a@x.org', role: 'admin' }),
      frontDesk: await ctx.db.insert('users', { name: 'Fran', email: 'f@x.org', role: 'front-desk' }),
      rsw: await ctx.db.insert('users', { name: 'Devon', email: 'd@x.org', role: 'rsw' }),
    }

    return { buildingId, roomId, tenantId, users }
  })

  const as = (userId: Id<'users'>) => t.withIdentity({ subject: `${userId}|session` })
  return { t, as, ...ids }
}

describe('social insurance numbers', () => {
  test('are masked for everyone and readable only by benefits roles', async () => {
    const { as, users, tenantId } = await setup()

    const forAdmin = await as(users.admin).query(api.profile.get, { tenantId })
    expect(forAdmin!.sin).toEqual({ masked: '•••-•••-789', visible: true })

    const forWorker = await as(users.rsw).query(api.profile.get, { tenantId })
    expect(forWorker!.sin).toEqual({ masked: '•••-•••-789', visible: false })
    // The masked form never carries enough to be used.
    expect(JSON.stringify(forWorker)).not.toContain('123-456-789')
  })

  test('revealing one is refused for a care role', async () => {
    const { as, users, tenantId } = await setup()

    expect(await as(users.frontDesk).query(api.profile.revealSin, { tenantId })).toBe('123-456-789')
    await expect(as(users.rsw).query(api.profile.revealSin, { tenantId })).rejects.toThrow(
      /does not have access/,
    )
  })

  test('a care role cannot write identity fields at all', async () => {
    const { as, users, tenantId } = await setup()

    // The capability gate stops them before the SIN check does; the check
    // inside `updateIdentity` is belt-and-braces for a future role that can
    // edit a record without doing benefits work.
    await expect(
      as(users.rsw).mutation(api.profile.updateIdentity, { tenantId, sin: '999888777' }),
    ).rejects.toThrow(/cannot do this/)
  })

  test('a malformed number is refused rather than stored', async () => {
    const { as, users, tenantId } = await setup()

    await expect(
      as(users.admin).mutation(api.profile.updateIdentity, { tenantId, sin: '12345' }),
    ).rejects.toThrow(/nine digits/)
  })
})

describe('the responder sheet', () => {
  test('carries no financial or tenancy-account information', async () => {
    const { as, users, tenantId } = await setup()

    const sheet = await as(users.rsw).query(api.profile.sheet, { tenantId })
    const serialised = JSON.stringify(sheet)

    // The resident owes $1,200 and holds a $540 deposit — none of it may appear.
    expect(serialised).not.toContain('120000')
    expect(serialised).not.toContain('54000')
    for (const field of [
      'balanceCents',
      'depositHeldCents',
      'depositRequiredCents',
      'monthlyRentCents',
      'lastPayment',
      'ledger',
    ]) {
      expect(serialised).not.toContain(field)
    }
  })

  test('leaves the SIN off unless it is explicitly asked for', async () => {
    const { as, users, tenantId } = await setup()

    const plain = await as(users.admin).query(api.profile.sheet, { tenantId })
    expect(plain!.tenant.sin).toBeNull()

    const withSin = await as(users.admin).query(api.profile.sheet, {
      tenantId,
      includeSin: true,
    })
    expect(withSin!.tenant.sin).toBe('123-456-789')

    // …and asking does not get a care role past the same gate.
    const denied = await as(users.rsw).query(api.profile.sheet, { tenantId, includeSin: true })
    expect(denied!.tenant.sin).toBeNull()
  })

  test('leads with the alerts that change what a responder does first', async () => {
    const { as, users, tenantId } = await setup()

    await as(users.rsw).mutation(api.profile.updateHealth, {
      tenantId,
      health: { dnrOrder: true, overdoseAlert: true },
    })

    const sheet = await as(users.rsw).query(api.profile.sheet, { tenantId })
    expect(sheet!.alerts.map((a) => a.label)).toEqual([
      'Valid DNR order on file',
      'Overdose alert',
    ])
  })

  test('an unanswered health question stays "not recorded", never "no"', async () => {
    const { as, users, tenantId } = await setup()

    await as(users.rsw).mutation(api.profile.updateHealth, { tenantId, health: { hivAids: false } })

    const sheet = await as(users.rsw).query(api.profile.sheet, { tenantId })
    expect(sheet!.health.hivAids).toBe(false)
    expect(sheet!.health.dnrOrder).toBeUndefined()
  })

  test('a partial health update does not clear what is already recorded', async () => {
    const { as, users, tenantId, t } = await setup()

    await as(users.rsw).mutation(api.profile.updateHealth, { tenantId, health: { dnrOrder: true } })
    await as(users.rsw).mutation(api.profile.updateHealth, {
      tenantId,
      health: { mobilityIssues: true },
    })

    const tenant = await t.run((ctx) => ctx.db.get(tenantId))
    expect(tenant!.health).toMatchObject({ dnrOrder: true, mobilityIssues: true })
  })
})

describe('contacts', () => {
  test('only one contact is next of kin', async () => {
    const { as, users, tenantId } = await setup()
    const staff = as(users.frontDesk)

    await staff.mutation(api.profile.addContact, {
      tenantId,
      name: 'Jane Doe',
      relationship: 'Sister',
      phone: '(604) 123-4567',
      isNextOfKin: true,
    })
    await staff.mutation(api.profile.addContact, {
      tenantId,
      name: 'Marcus Bell',
      relationship: 'Friend',
      isNextOfKin: true,
    })

    const profile = await staff.query(api.profile.get, { tenantId })
    const nextOfKin = profile!.contacts.filter((c) => c.isNextOfKin)
    expect(nextOfKin).toHaveLength(1)
    expect(nextOfKin[0]!.name).toBe('Marcus Bell')
    // The next of kin sorts first, which is the order the sheet prints in.
    expect(profile!.contacts[0]!.name).toBe('Marcus Bell')
  })
})

describe('shift notes', () => {
  test('show submitted reports only — never a colleague’s open draft', async () => {
    const { as, users, tenantId, buildingId } = await setup()
    const worker = as(users.rsw)

    const reportId = await worker.mutation(api.shiftReports.start, {
      buildingId,
      now: Date.UTC(2026, 5, 15, 18),
      tzOffsetMinutes: 0,
    })
    await worker.mutation(api.shiftReports.addEntry, {
      reportId,
      log: 'interaction',
      tenantIds: [tenantId],
      location: 'Hallway',
      occurredAt: Date.UTC(2026, 5, 15, 19),
      kind: 'welfare',
      comments: 'Found in the hallway, disoriented. Escorted back to the room.',
      significant: false,
      cameraReview: false,
    })

    expect(await worker.query(api.profile.shiftNotes, { tenantId })).toHaveLength(0)

    await worker.mutation(api.shiftReports.submit, {
      reportId,
      summary: 'One welfare concern.',
      radioCheck: true,
      handover: true,
      readPrevious: true,
      now: Date.UTC(2026, 5, 15, 23),
    })

    const notes = await worker.query(api.profile.shiftNotes, { tenantId })
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ kind: 'interaction', title: 'Hallway' })
  })

  test('include wellness checks that did not go to plan', async () => {
    const { as, users, tenantId } = await setup()
    const worker = as(users.rsw)

    await worker.mutation(api.care.logCheck, {
      tenantId,
      outcome: 'seen',
      now: Date.UTC(2026, 5, 15, 9),
      tzOffsetMinutes: 0,
    })
    await worker.mutation(api.care.logCheck, {
      tenantId,
      outcome: 'refused',
      note: 'Would not open the door.',
      now: Date.UTC(2026, 5, 15, 18),
      tzOffsetMinutes: 0,
    })

    const notes = await worker.query(api.profile.shiftNotes, { tenantId })
    // The plain "seen" check is not a note; the refusal is.
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ kind: 'check', title: 'refused' })
  })
})
