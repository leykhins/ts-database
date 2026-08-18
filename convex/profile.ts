import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { conditionFlag, healthProfile } from './schema'
import { can, requireCapability, requireStaff } from './model'

/**
 * The resident record — bio data, health, contacts, and the sheet that gets
 * printed and handed to a paramedic.
 *
 * Two rules run through this file:
 *
 *  1. **A blank is not a "no".** Every health question is a tri-state:
 *     yes, no, or not recorded. Somebody deciding whether to start
 *     compressions needs to know the difference between "no DNR on file" and
 *     "nobody has ever asked".
 *  2. **The SIN is not care information.** It is a financial identifier used
 *     for benefits and subsidy work, it is of no use to a first responder, and
 *     a printed sheet with one on it left at a nursing station is an
 *     identity-theft risk. It is returned only to roles that do benefits work,
 *     and it is off the responder sheet unless somebody explicitly asks for it.
 */

/** Roles that do benefits and subsidy work, and therefore need the SIN. */
function canSeeSin(user: Doc<'users'>): boolean {
  return can(user, 'money') || can(user, 'config')
}

/** `•••-•••-123` — enough to confirm a match, not enough to use. */
function maskSin(sin: string): string {
  const digits = sin.replace(/\D/g, '')
  return digits.length >= 3 ? `•••-•••-${digits.slice(-3)}` : '•••'
}

const EMPTY_HEALTH = {
  careRxProgram: undefined,
  mobilityIssues: undefined,
  developmentalDisabilities: undefined,
  physicalDisabilities: undefined,
  hivAids: undefined,
  dnrOrder: undefined,
  schizophrenia: undefined,
  receivesImShot: undefined,
  substanceUse: undefined,
  overdoseAlert: undefined,
  onSubstanceTreatment: undefined,
} as const

/**
 * Everything on the resident's information page that is not money.
 *
 * Rent, the ledger and the deposit stay in `tenants.get` — this is the record
 * a care worker reads, and keeping the two apart is what lets the print sheet
 * be sure it is not carrying financial information.
 */
export const get = query({
  args: { tenantId: v.id('tenants') },
  handler: async (ctx, { tenantId }) => {
    const staff = await requireStaff(ctx)

    const tenant = await ctx.db.get(tenantId)
    if (!tenant) return null

    const [building, room, contacts, photoUrl] = await Promise.all([
      ctx.db.get(tenant.buildingId),
      tenant.roomId ? ctx.db.get(tenant.roomId) : Promise.resolve(null),
      ctx.db
        .query('tenantContacts')
        .withIndex('by_tenant', (q) => q.eq('tenantId', tenantId))
        .collect(),
      tenant.photoId ? ctx.storage.getUrl(tenant.photoId) : Promise.resolve(null),
    ])

    const sinVisible = canSeeSin(staff)

    return {
      _id: tenant._id,
      name: tenant.name,
      preferredName: tenant.preferredName ?? null,
      pronouns: tenant.pronouns ?? null,
      populationGroup: tenant.populationGroup ?? null,
      dob: tenant.dob ?? null,
      phone: tenant.phone ?? null,
      languages: tenant.languages ?? null,
      photoUrl,
      writeUp: tenant.writeUp ?? null,

      room: room?.number ?? '—',
      floor: room?.floor ?? null,
      building: building?.name ?? '—',
      buildingAddress: building?.address ?? null,
      status: tenant.status,
      supportLevel: tenant.supportLevel,
      intakeDate: tenant.intakeDate,
      exitDate: tenant.exitDate ?? null,

      // The SIN is masked for everyone; the raw value only travels to roles
      // that need it, and only when they ask for it.
      sin: tenant.sin ? { masked: maskSin(tenant.sin), visible: sinVisible } : null,

      flags: {
        houseAbility: tenant.flags?.houseAbility ?? 'none',
        mental: tenant.flags?.mental ?? 'none',
        physical: tenant.flags?.physical ?? 'none',
        pest: tenant.flags?.pest ?? 'none',
        clutter: tenant.flags?.clutter ?? 'none',
      },

      health: { ...EMPTY_HEALTH, ...(tenant.health ?? {}) },

      intake: {
        sourceOfIncome: tenant.intake?.sourceOfIncome ?? null,
        employmentType: tenant.intake?.employmentType ?? null,
        mhrOffice: tenant.intake?.mhrOffice ?? null,
        gaNumber: tenant.intake?.gaNumber ?? null,
        housingNeeds: tenant.intake?.housingNeeds ?? null,
        subsidyInformation: tenant.intake?.subsidyInformation ?? null,
      },

      documents: {
        intentToRent: tenant.documents?.intentToRent ?? false,
        signedTenancyAgreement: tenant.documents?.signedTenancyAgreement ?? false,
        covRoomRegistration: tenant.documents?.covRoomRegistration ?? false,
        releaseOfInformation: tenant.documents?.releaseOfInformation ?? false,
      },

      contacts: contacts
        .sort((a, b) => Number(b.isNextOfKin) - Number(a.isNextOfKin))
        .map((c) => ({
          _id: c._id,
          name: c.name,
          relationship: c.relationship,
          phone: c.phone ?? null,
          email: c.email ?? null,
          isNextOfKin: c.isNextOfKin,
          note: c.note ?? null,
        })),
    }
  },
})

/**
 * The SIN in full. A separate call so that reading it is a deliberate act
 * rather than a side effect of opening a resident's page.
 */
export const revealSin = query({
  args: { tenantId: v.id('tenants') },
  handler: async (ctx, { tenantId }) => {
    const staff = await requireStaff(ctx)
    if (!canSeeSin(staff)) {
      throw new Error('Your role does not have access to social insurance numbers.')
    }

    const tenant = await ctx.db.get(tenantId)
    return tenant?.sin ?? null
  },
})

/**
 * What has been logged about this resident on shift: entries from submitted
 * shift reports, and wellness checks that carried a note. One timeline, newest
 * first — this is the "notes from shift reports" a worker coming on shift
 * reads before knocking.
 */
export const shiftNotes = query({
  args: { tenantId: v.id('tenants') },
  handler: async (ctx, { tenantId }) => {
    await requireStaff(ctx)

    // The reverse lookup runs through the join table: every entry that named
    // this resident, newest first.
    const [participants, checks] = await Promise.all([
      ctx.db
        .query('shiftLogParticipants')
        .withIndex('by_tenant_occurred', (q) => q.eq('tenantId', tenantId))
        .order('desc')
        .take(40),
      ctx.db
        .query('wellnessChecks')
        .withIndex('by_tenant_completed', (q) => q.eq('tenantId', tenantId))
        .order('desc')
        .take(40),
    ])

    const entries = (
      await Promise.all(participants.map((p) => ctx.db.get(p.entryId)))
    ).filter((e): e is NonNullable<typeof e> => e !== null)

    // Only submitted reports are part of the record; a colleague's open draft
    // is not something to read about a resident.
    const reports = await Promise.all(entries.map((e) => ctx.db.get(e.reportId)))
    const staffIds = [
      ...new Set([
        ...entries.map((e) => e.loggedBy),
        ...checks.map((c) => c.completedBy),
      ].filter(Boolean)),
    ]
    const people = await Promise.all(staffIds.map((id) => ctx.db.get(id as Id<'users'>)))
    const nameById = new Map(people.filter(Boolean).map((p) => [p!._id as string, p!.name]))

    const fromEntries = entries
      .map((entry, i) => ({ entry, report: reports[i] }))
      .filter(({ report }) => report?.status === 'submitted')
      .map(({ entry, report }) => ({
        _id: entry._id as string,
        kind: (entry.log ?? 'interaction') as 'interaction' | 'event',
        at: entry.occurredAt,
        title: entry.location,
        body: entry.comments,
        significant: entry.significant,
        cameraReview: entry.cameraReview,
        shift: report!.shiftKey,
        shiftDate: report!.shiftDate,
        by: entry.loggedBy ? (nameById.get(entry.loggedBy) ?? null) : null,
      }))

    const fromChecks = checks
      .filter((c) => c.note || c.outcome !== 'seen')
      .map((check) => ({
        _id: check._id as string,
        kind: 'check' as const,
        at: check.completedAt,
        title: check.outcome,
        body: check.note ?? '',
        significant: false,
        cameraReview: false,
        shift: check.shiftKey,
        shiftDate: check.shiftDate,
        by: check.completedBy ? (nameById.get(check.completedBy) ?? null) : null,
      }))

    return [...fromEntries, ...fromChecks].sort((a, b) => b.at - a.at).slice(0, 40)
  },
})

/**
 * The responder sheet: what a paramedic or an officer needs, and nothing else.
 *
 * Deliberately excludes rent, the ledger, deposits and shift notes. The SIN is
 * excluded unless the person printing explicitly asks for it — see the note at
 * the top of this file.
 */
export const sheet = query({
  args: { tenantId: v.id('tenants'), includeSin: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx)

    const tenant = await ctx.db.get(args.tenantId)
    if (!tenant) return null

    const [building, room, contacts, photoUrl] = await Promise.all([
      ctx.db.get(tenant.buildingId),
      tenant.roomId ? ctx.db.get(tenant.roomId) : Promise.resolve(null),
      ctx.db
        .query('tenantContacts')
        .withIndex('by_tenant', (q) => q.eq('tenantId', args.tenantId))
        .collect(),
      tenant.photoId ? ctx.storage.getUrl(tenant.photoId) : Promise.resolve(null),
    ])

    const health = { ...EMPTY_HEALTH, ...(tenant.health ?? {}) }

    // The three things that change what a responder does in the first minute.
    const alerts: { label: string; detail: string }[] = []
    if (health.dnrOrder) {
      alerts.push({ label: 'Valid DNR order on file', detail: 'Do not resuscitate' })
    }
    if (health.overdoseAlert) {
      alerts.push({ label: 'Overdose alert', detail: 'Previous overdose on record' })
    }
    if (health.mobilityIssues) {
      alerts.push({
        label: 'Mobility issues',
        detail: tenant.health?.mobilityAids || 'May not be able to reach the door',
      })
    }

    return {
      generatedBy: staff.name ?? staff.username ?? 'Staff',
      tenant: {
        name: tenant.name,
        preferredName: tenant.preferredName ?? null,
        pronouns: tenant.pronouns ?? null,
        dob: tenant.dob ?? null,
        phone: tenant.phone ?? null,
        languages: tenant.languages ?? null,
        photoUrl,
        room: room?.number ?? '—',
        floor: room?.floor ?? null,
        supportLevel: tenant.supportLevel,
        status: tenant.status,
        intakeDate: tenant.intakeDate,
        sin: args.includeSin && canSeeSin(staff) ? (tenant.sin ?? null) : null,
      },
      building: {
        name: building?.name ?? '—',
        address: building?.address ?? null,
      },
      flags: {
        houseAbility: tenant.flags?.houseAbility ?? 'none',
        mental: tenant.flags?.mental ?? 'none',
        physical: tenant.flags?.physical ?? 'none',
        pest: tenant.flags?.pest ?? 'none',
        clutter: tenant.flags?.clutter ?? 'none',
      },
      alerts,
      health,
      contacts: contacts
        .sort((a, b) => Number(b.isNextOfKin) - Number(a.isNextOfKin))
        .map((c) => ({
          name: c.name,
          relationship: c.relationship,
          phone: c.phone ?? null,
          isNextOfKin: c.isNextOfKin,
        })),
    }
  },
})

/* ------------------------------------------------------------------------
   Writes
   ------------------------------------------------------------------------ */

export const updateIdentity = mutation({
  args: {
    tenantId: v.id('tenants'),
    preferredName: v.optional(v.string()),
    pronouns: v.optional(v.string()),
    populationGroup: v.optional(v.string()),
    phone: v.optional(v.string()),
    languages: v.optional(v.string()),
    sin: v.optional(v.string()),
    writeUp: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const staff = await requireCapability(ctx, 'tenancy')

    const tenant = await ctx.db.get(args.tenantId)
    if (!tenant) throw new Error('That resident no longer exists.')

    const patch: Record<string, unknown> = {}
    for (const key of ['preferredName', 'pronouns', 'populationGroup', 'phone', 'languages', 'writeUp'] as const) {
      if (args[key] !== undefined) patch[key] = args[key]!.trim() || undefined
    }

    if (args.sin !== undefined) {
      if (!canSeeSin(staff)) {
        throw new Error('Your role cannot record social insurance numbers.')
      }
      const digits = args.sin.replace(/\D/g, '')
      if (digits && digits.length !== 9) {
        throw new Error('A social insurance number is nine digits.')
      }
      patch.sin = digits ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : undefined
    }

    await ctx.db.patch(args.tenantId, patch)
    return null
  },
})

export const updateHealth = mutation({
  args: { tenantId: v.id('tenants'), health: healthProfile },
  handler: async (ctx, args) => {
    await requireCapability(ctx, 'care')

    const tenant = await ctx.db.get(args.tenantId)
    if (!tenant) throw new Error('That resident no longer exists.')

    // Merge rather than replace: a form that only asked about mobility must
    // not silently clear a DNR order somebody recorded last year.
    await ctx.db.patch(args.tenantId, { health: { ...(tenant.health ?? {}), ...args.health } })
    return null
  },
})

export const setFlags = mutation({
  args: {
    tenantId: v.id('tenants'),
    flags: v.object({
      houseAbility: v.optional(conditionFlag),
      mental: v.optional(conditionFlag),
      physical: v.optional(conditionFlag),
      pest: v.optional(conditionFlag),
      clutter: v.optional(conditionFlag),
    }),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, 'care')

    const tenant = await ctx.db.get(args.tenantId)
    if (!tenant) throw new Error('That resident no longer exists.')

    await ctx.db.patch(args.tenantId, { flags: { ...(tenant.flags ?? {}), ...args.flags } })
    return null
  },
})

export const updateIntake = mutation({
  args: {
    tenantId: v.id('tenants'),
    intake: v.object({
      sourceOfIncome: v.optional(v.string()),
      employmentType: v.optional(v.string()),
      mhrOffice: v.optional(v.string()),
      gaNumber: v.optional(v.string()),
      housingNeeds: v.optional(v.string()),
      subsidyInformation: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, 'tenancy')

    const tenant = await ctx.db.get(args.tenantId)
    if (!tenant) throw new Error('That resident no longer exists.')

    await ctx.db.patch(args.tenantId, { intake: { ...(tenant.intake ?? {}), ...args.intake } })
    return null
  },
})

export const updateDocuments = mutation({
  args: {
    tenantId: v.id('tenants'),
    documents: v.object({
      intentToRent: v.optional(v.boolean()),
      signedTenancyAgreement: v.optional(v.boolean()),
      covRoomRegistration: v.optional(v.boolean()),
      releaseOfInformation: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, 'tenancy')

    const tenant = await ctx.db.get(args.tenantId)
    if (!tenant) throw new Error('That resident no longer exists.')

    await ctx.db.patch(args.tenantId, {
      documents: { ...(tenant.documents ?? {}), ...args.documents },
    })
    return null
  },
})

/* ---- Contacts ---- */

export const addContact = mutation({
  args: {
    tenantId: v.id('tenants'),
    name: v.string(),
    relationship: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    isNextOfKin: v.boolean(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, 'tenancy')

    const tenant = await ctx.db.get(args.tenantId)
    if (!tenant) throw new Error('That resident no longer exists.')
    if (!args.name.trim()) throw new Error('Enter the contact’s name.')
    if (!args.relationship.trim()) throw new Error('Say how they are related.')

    // One next of kin: the point of the marker is that it is unambiguous at 3 am.
    if (args.isNextOfKin) {
      const existing = await ctx.db
        .query('tenantContacts')
        .withIndex('by_tenant', (q) => q.eq('tenantId', args.tenantId))
        .collect()
      for (const contact of existing.filter((c) => c.isNextOfKin)) {
        await ctx.db.patch(contact._id, { isNextOfKin: false })
      }
    }

    return await ctx.db.insert('tenantContacts', {
      tenantId: args.tenantId,
      buildingId: tenant.buildingId,
      name: args.name.trim(),
      relationship: args.relationship.trim(),
      phone: args.phone?.trim() || undefined,
      email: args.email?.trim() || undefined,
      isNextOfKin: args.isNextOfKin,
      note: args.note?.trim() || undefined,
    })
  },
})

export const removeContact = mutation({
  args: { contactId: v.id('tenantContacts') },
  handler: async (ctx, { contactId }) => {
    await requireCapability(ctx, 'tenancy')
    await ctx.db.delete(contactId)
    return null
  },
})

/* ---- Photo ---- */

/**
 * A short-lived URL the browser uploads the photo straight to. The file never
 * passes through a Convex function, so a large image cannot blow a mutation's
 * size limit.
 */
export const generatePhotoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, 'tenancy')
    return await ctx.storage.generateUploadUrl()
  },
})

export const setPhoto = mutation({
  args: { tenantId: v.id('tenants'), storageId: v.id('_storage') },
  handler: async (ctx, args) => {
    await requireCapability(ctx, 'tenancy')

    const tenant = await ctx.db.get(args.tenantId)
    if (!tenant) throw new Error('That resident no longer exists.')

    // Replacing a photo removes the old file rather than orphaning it.
    if (tenant.photoId) await ctx.storage.delete(tenant.photoId)

    await ctx.db.patch(args.tenantId, { photoId: args.storageId })
    return null
  },
})

export const removePhoto = mutation({
  args: { tenantId: v.id('tenants') },
  handler: async (ctx, { tenantId }) => {
    await requireCapability(ctx, 'tenancy')

    const tenant = await ctx.db.get(tenantId)
    if (!tenant?.photoId) return null

    await ctx.storage.delete(tenant.photoId)
    await ctx.db.patch(tenantId, { photoId: undefined })
    return null
  },
})
