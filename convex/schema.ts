import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { authTables } from '@convex-dev/auth/server'

/**
 * TS Database — data model for supportive & low-income housing operations.
 *
 * Money is stored in **cents** as integers throughout. Never store dollars as
 * floats: a $540.00 rent split three ways has to add back up exactly.
 *
 * Dates that describe a calendar day with no time-of-day meaning (date of
 * birth, intake date) are ISO `YYYY-MM-DD` strings. Anything that describes a
 * moment (a payment being posted, a check being completed) is a ms timestamp.
 */

export const supportLevel = v.union(
  v.literal('independent'),
  v.literal('moderate'),
  v.literal('high'),
  v.literal('critical'),
)

/**
 * Staff roles. `admin` is the only one that may change configuration.
 *
 * The three care roles are the front-desk jobs the Care Console is built for.
 * They are separate roles rather than one "care staff" bucket because each
 * carries a different duty list on shift — rounds, personal care, care plans.
 */
export const staffRole = v.union(
  v.literal('admin'),
  v.literal('supervisor'),
  v.literal('front-desk'),
  v.literal('care-staff'),
  v.literal('rsw'), // Resident Support Worker
  v.literal('wellness'), // Wellness Worker (mental-health support)
  v.literal('home-support'), // Home Support Worker (personal care)
)

/**
 * The three shift segments a day is divided into. Fixed policy, not data:
 * overnight 12–8, morning 8–4, evening 4–12.
 */
export const shiftKey = v.union(
  v.literal('overnight'),
  v.literal('morning'),
  v.literal('evening'),
)

/**
 * What happened when staff knocked. Only real events are stored — a check
 * that has not happened yet is the absence of a row, not a row saying "todo".
 */
export const checkOutcome = v.union(
  v.literal('seen'),
  v.literal('refused'),
  v.literal('absent'),
  v.literal('declined'),
  v.literal('no-answer'),
  v.literal('asleep'),
)

/**
 * The at-a-glance condition bar the legacy system led with. Staff read these
 * before walking into a room, so they are a fixed four-state scale rather than
 * free text: green is fine, amber needs watching, red needs care before entry.
 */
export const conditionFlag = v.union(
  v.literal('none'),
  v.literal('green'),
  v.literal('amber'),
  v.literal('red'),
)

/**
 * Health information that a paramedic or a police officer attending the site
 * needs in the first sixty seconds.
 *
 * Every field is optional and every field is a deliberate question staff are
 * asked at intake — an unanswered question reads as "not known", never as
 * "no". "Not known" and "no" are different things to somebody deciding whether
 * to start compressions.
 */
export const healthProfile = v.object({
  // Physical
  careRxProgram: v.optional(v.boolean()),
  mobilityIssues: v.optional(v.boolean()),
  developmentalDisabilities: v.optional(v.boolean()),
  physicalDisabilities: v.optional(v.boolean()),
  hivAids: v.optional(v.boolean()),
  dnrOrder: v.optional(v.boolean()),
  // Mental
  schizophrenia: v.optional(v.boolean()),
  receivesImShot: v.optional(v.boolean()),
  // Substance use
  substanceUse: v.optional(v.boolean()),
  overdoseAlert: v.optional(v.boolean()),
  onSubstanceTreatment: v.optional(v.boolean()),
  // Free text — the things that do not reduce to a checkbox
  conditions: v.optional(v.string()),
  allergies: v.optional(v.string()),
  medications: v.optional(v.string()),
  mobilityAids: v.optional(v.string()),
  careNotes: v.optional(v.string()),
})

/**
 * What a shift log entry is about.
 *
 * An **interaction** is something that happened with a resident — the reason
 * their name is in the report. An **event** happened to the building: a fire
 * alarm, a flood, police attending. An event may involve a resident and often
 * does not, which is exactly why it cannot be filed as an interaction: a fire
 * panel fault is not something anybody did to anyone.
 */
export const shiftLog = v.union(v.literal('interaction'), v.literal('event'))

export const logKind = v.union(
  // Interactions with a resident
  v.literal('welfare'),
  v.literal('medical'),
  v.literal('behavioural'),
  v.literal('harm-reduction'),
  v.literal('property'),
  v.literal('other'),
  // Building and site events
  v.literal('fire'),
  v.literal('flood'),
  v.literal('power'),
  v.literal('elevator'),
  v.literal('police'),
  v.literal('ambulance'),
  v.literal('evacuation'),
  v.literal('violence'),
  v.literal('contractor'),
  v.literal('security'),
)

/** Which sitting a food checklist belongs to. */
export const meal = v.union(
  v.literal('breakfast'),
  v.literal('lunch'),
  v.literal('dinner'),
)

/**
 * Harm-reduction supplies handed out at the desk. A union rather than a
 * `bubblePipe` table because sites add supplies over time and renaming a
 * table after the fact is a migration; adding a member here is not.
 */
export const supplyItem = v.union(
  v.literal('bubble-pipe'),
  v.literal('stem-pipe'),
  v.literal('foil'),
  v.literal('needle-kit'),
  v.literal('naloxone'),
  v.literal('other'),
)

/** What is chained up in the bike room. */
export const wheeledKind = v.union(
  v.literal('bike'),
  v.literal('e-bike'),
  v.literal('scooter'),
  v.literal('e-scooter'),
  v.literal('other'),
)

export const tenancyStatus = v.union(
  v.literal('current'),
  v.literal('prospective'),
  v.literal('prior'),
)

export default defineSchema({
  // Convex Auth tables (users, authSessions, authAccounts, …). We extend
  // `users` with the staff profile fields TS Database needs.
  ...authTables,
  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    image: v.optional(v.string()),
    // TS Database staff profile
    role: v.optional(staffRole),
    /**
     * An administrator testing the app as another role. While this is set, the
     * server treats the user as that role for every permission check — the
     * simulation is real, not a UI trick. Only the *real* role can clear it.
     */
    simulatedRole: v.optional(staffRole),
    homeBuildingId: v.optional(v.id('buildings')),
  })
    .index('email', ['email'])
    .index('phone', ['phone']),

  buildings: defineTable({
    name: v.string(),
    slug: v.string(),
    address: v.optional(v.string()),
    units: v.number(),
  }).index('by_slug', ['slug']),

  rooms: defineTable({
    buildingId: v.id('buildings'),
    number: v.string(),
    floor: v.string(),
    // Sort key so "101" … "312" order the way staff walk the building.
    sortKey: v.number(),
    monthlyRentCents: v.number(),
    lastCheckedAt: v.optional(v.number()),
    outOfService: v.optional(v.boolean()),
  })
    .index('by_building', ['buildingId'])
    .index('by_building_number', ['buildingId', 'number'])
    .index('by_building_sort', ['buildingId', 'sortKey']),

  tenants: defineTable({
    buildingId: v.id('buildings'),
    roomId: v.optional(v.id('rooms')),
    name: v.string(),
    dob: v.optional(v.string()),
    intakeDate: v.string(),
    exitDate: v.optional(v.string()),
    status: tenancyStatus,
    supportLevel,
    monthlyRentCents: v.number(),
    depositRequiredCents: v.number(),
    notes: v.optional(v.string()),
    exitReason: v.optional(v.string()),

    /* ---- Bio data ----------------------------------------------------
       Identity and contact details. `sin` is a financial identifier, not
       care information: it is returned only to roles that need it for
       benefits and subsidy work, and it is never printed on the responder
       sheet. See `tenants.get`. */
    pronouns: v.optional(v.string()),
    populationGroup: v.optional(v.string()),
    preferredName: v.optional(v.string()),
    sin: v.optional(v.string()),
    phone: v.optional(v.string()),
    photoId: v.optional(v.id('_storage')),
    languages: v.optional(v.string()),
    writeUp: v.optional(v.string()),

    /** The condition bar staff read before knocking. */
    flags: v.optional(
      v.object({
        houseAbility: v.optional(conditionFlag),
        mental: v.optional(conditionFlag),
        physical: v.optional(conditionFlag),
        pest: v.optional(conditionFlag),
        clutter: v.optional(conditionFlag),
      }),
    ),

    health: v.optional(healthProfile),

    /** Intake paperwork — the funding and benefits side of a tenancy. */
    intake: v.optional(
      v.object({
        sourceOfIncome: v.optional(v.string()),
        employmentType: v.optional(v.string()),
        mhrOffice: v.optional(v.string()),
        gaNumber: v.optional(v.string()),
        housingNeeds: v.optional(v.string()),
        subsidyInformation: v.optional(v.string()),
      }),
    ),

    /** Documents on file. Booleans because the question is "is it signed". */
    documents: v.optional(
      v.object({
        intentToRent: v.optional(v.boolean()),
        signedTenancyAgreement: v.optional(v.boolean()),
        covRoomRegistration: v.optional(v.boolean()),
        releaseOfInformation: v.optional(v.boolean()),
      }),
    ),

    /**
     * Rollups of the two append-only tables below.
     *
     * These are NOT a second source of truth: every write that touches
     * `rentLedger` or `depositEntries` updates them in the same transaction
     * (see `model.ts` → `applyLedgerEntry` / `applyDepositEntry`), so they
     * cannot drift. They exist because the roster screens would otherwise read
     * a building's entire ledger to show one column, which is fine at three
     * months of history and not fine at three years.
     *
     * Optional only so the fields could be added to a deployment that already
     * had tenants; `tenants:backfillRollups` fills them in.
     */
    balanceCents: v.optional(v.number()),
    depositHeldCents: v.optional(v.number()),
    lastPaymentAt: v.optional(v.number()),
    lastPaymentCents: v.optional(v.number()),
  })
    .index('by_building', ['buildingId'])
    .index('by_building_status', ['buildingId', 'status'])
    .index('by_room', ['roomId']),

  /**
   * Next of kin and the people to call. A table rather than an array on the
   * tenant: a resident can have several, and the one a paramedic needs at 3 am
   * is the one marked `isNextOfKin`, not whichever was entered first.
   */
  tenantContacts: defineTable({
    tenantId: v.id('tenants'),
    buildingId: v.id('buildings'),
    name: v.string(),
    relationship: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    isNextOfKin: v.boolean(),
    note: v.optional(v.string()),
  }).index('by_tenant', ['tenantId']),

  /**
   * Every change to a resident's support level, with the reason. Care staff are
   * asked to justify a level change at the moment they make it — reconstructing
   * "why was she moved to high support in March" afterwards is impossible.
   */
  supportLevelChanges: defineTable({
    tenantId: v.id('tenants'),
    buildingId: v.id('buildings'),
    from: supportLevel,
    to: supportLevel,
    reason: v.string(),
    changedAt: v.number(),
    changedBy: v.optional(v.id('users')),
  })
    .index('by_tenant', ['tenantId'])
    .index('by_building_changed', ['buildingId', 'changedAt']),

  /**
   * Append-only rent ledger. A tenant's balance is the sum of this table, never
   * a stored field — a stored balance and a ledger that disagree is the classic
   * way housing systems lose money.
   *
   * `charge` entries are positive amounts owed; `payment` entries are positive
   * amounts received. Balance = charges − payments.
   */
  rentLedger: defineTable({
    tenantId: v.id('tenants'),
    buildingId: v.id('buildings'),
    kind: v.union(v.literal('charge'), v.literal('payment'), v.literal('credit')),
    amountCents: v.number(),
    postedAt: v.number(),
    periodLabel: v.optional(v.string()), // e.g. "Jun 2026"
    method: v.optional(
      v.union(
        v.literal('cheque'),
        v.literal('cash'),
        v.literal('eft'),
        v.literal('money-order'),
      ),
    ),
    reference: v.optional(v.string()),
    postedBy: v.optional(v.id('users')),
    note: v.optional(v.string()),
  })
    .index('by_tenant', ['tenantId'])
    .index('by_building', ['buildingId'])
    .index('by_building_posted', ['buildingId', 'postedAt']),

  /** Security deposit movements. Held = sum of this table per tenant. */
  depositEntries: defineTable({
    tenantId: v.id('tenants'),
    buildingId: v.id('buildings'),
    amountCents: v.number(), // negative for refunds / deductions
    postedAt: v.number(),
    reason: v.string(),
    postedBy: v.optional(v.id('users')),
  })
    .index('by_tenant', ['tenantId'])
    .index('by_building', ['buildingId']),

  roomChecks: defineTable({
    buildingId: v.id('buildings'),
    roomId: v.optional(v.id('rooms')), // absent = whole-building check
    kind: v.union(v.literal('room'), v.literal('building')),
    completedAt: v.number(),
    outcome: v.union(
      v.literal('all-clear'),
      v.literal('deficiency'),
      v.literal('no-entry'),
    ),
    notes: v.optional(v.string()),
    completedBy: v.optional(v.id('users')),
  })
    .index('by_building', ['buildingId'])
    .index('by_building_completed', ['buildingId', 'completedAt'])
    .index('by_room', ['roomId']),

  criticalNeeds: defineTable({
    tenantId: v.id('tenants'),
    buildingId: v.id('buildings'),
    summary: v.string(),
    detail: v.optional(v.string()),
    openedAt: v.number(),
    resolvedAt: v.optional(v.number()),
    caseManager: v.optional(v.string()),
  })
    .index('by_tenant', ['tenantId'])
    .index('by_building', ['buildingId']),

  /**
   * Wellness checks — the record that somebody laid eyes on a resident.
   *
   * This is the Care Console's spine. One row per resident per shift segment,
   * written the moment the check happens. `shiftDate` is the calendar day the
   * *shift* belongs to, which is not the same as the calendar day for an
   * overnight shift — a 2 am check belongs to the shift that started at
   * midnight, and reports have to group that way.
   */
  wellnessChecks: defineTable({
    buildingId: v.id('buildings'),
    tenantId: v.id('tenants'),
    roomId: v.optional(v.id('rooms')),
    shiftDate: v.string(), // YYYY-MM-DD
    shiftKey,
    outcome: checkOutcome,
    note: v.optional(v.string()),
    completedAt: v.number(),
    completedBy: v.optional(v.id('users')),
  })
    .index('by_building_shift', ['buildingId', 'shiftDate', 'shiftKey'])
    .index('by_tenant_completed', ['tenantId', 'completedAt'])
    .index('by_building_completed', ['buildingId', 'completedAt']),

  /**
   * Shift reports — the handover.
   *
   * Two phases, as designed: log entries are written live while the shift runs
   * (`draft`), then the worker finalizes, which is when the whole-shift
   * questions appear and the report can be submitted. Reporter, site, date and
   * shift period are derived, never typed.
   */
  shiftReports: defineTable({
    buildingId: v.id('buildings'),
    shiftDate: v.string(),
    shiftKey,
    authorId: v.id('users'),
    authorRole: staffRole,
    status: v.union(v.literal('draft'), v.literal('submitted')),

    // Whole-shift answers, filled in at finalize time.
    summary: v.optional(v.string()),
    importantInfo: v.optional(v.string()),
    extraTasks: v.optional(v.string()),
    radioCheck: v.optional(v.boolean()),
    handover: v.optional(v.boolean()),
    readPrevious: v.optional(v.boolean()),
    /** Duty key → done, for the role's duty list. */
    duties: v.optional(v.record(v.string(), v.boolean())),

    startedAt: v.number(),
    submittedAt: v.optional(v.number()),
  })
    .index('by_building_shift', ['buildingId', 'shiftDate', 'shiftKey'])
    .index('by_author_status', ['authorId', 'status'])
    .index('by_building_started', ['buildingId', 'startedAt']),

  /**
   * Entries on a shift report — interactions and events both. One table
   * because they are the same row (when, where, what happened, who logged it)
   * and differ only in what they attach to. `log` says which list an entry
   * belongs to; entries written before the split are interactions.
   */
  shiftLogEntries: defineTable({
    reportId: v.id('shiftReports'),
    buildingId: v.id('buildings'),
    log: v.optional(shiftLog),
    location: v.string(),
    occurredAt: v.number(),
    kind: logKind,
    comments: v.string(),
    significant: v.boolean(),
    cameraReview: v.boolean(),
    /** Events only: did outside services attend, and was the building cleared. */
    emergencyServices: v.optional(v.boolean()),
    evacuated: v.optional(v.boolean()),
    loggedBy: v.optional(v.id('users')),
  })
    .index('by_report', ['reportId'])
    .index('by_building_occurred', ['buildingId', 'occurredAt']),

  /**
   * Which residents a log entry involves.
   *
   * A join table rather than an array on the entry, because the reverse
   * lookup is the one that matters: "everything logged about this resident"
   * drives their record, and an array field cannot be indexed for it. An
   * entry may involve nobody — a fire panel fault — or several people, which
   * a single `tenantId` could not say.
   */
  shiftLogParticipants: defineTable({
    entryId: v.id('shiftLogEntries'),
    tenantId: v.id('tenants'),
    buildingId: v.id('buildings'),
    occurredAt: v.number(),
  })
    .index('by_entry', ['entryId'])
    .index('by_tenant_occurred', ['tenantId', 'occurredAt']),

  /**
   * Per-site operating rules.
   *
   * Meal sittings, laundry hours and supply limits differ from building to
   * building, so they are configuration rather than constants: one row per
   * building, edited by a site manager. Times are minutes from midnight —
   * comparable without parsing, and formatted for display at the edge.
   */
  siteSettings: defineTable({
    buildingId: v.id('buildings'),

    meals: v.optional(
      v.array(
        v.object({
          meal,
          /** What is being served, so the checklist says more than "lunch". */
          menu: v.optional(v.string()),
          fromMinutes: v.number(),
          toMinutes: v.number(),
          served: v.boolean(),
        }),
      ),
    ),

    laundry: v.optional(
      v.object({
        fromMinutes: v.number(),
        toMinutes: v.number(),
        slotMinutes: v.number(),
        /** 0 = no cap. */
        maxPerResidentPerWeek: v.number(),
      }),
    ),

    /** Item → how many a resident may be given in one day. 0 = no cap. */
    supplyLimits: v.optional(v.record(v.string(), v.number())),
  }).index('by_building', ['buildingId']),

  /** The food checklist: one row per resident per sitting per day. */
  mealServices: defineTable({
    buildingId: v.id('buildings'),
    tenantId: v.id('tenants'),
    date: v.string(), // YYYY-MM-DD
    meal,
    servedAt: v.number(),
    servedBy: v.optional(v.id('users')),
    note: v.optional(v.string()),
  })
    .index('by_building_date_meal', ['buildingId', 'date', 'meal'])
    .index('by_tenant_served', ['tenantId', 'servedAt']),

  /** A resident's slot in the laundry room. */
  laundryBookings: defineTable({
    buildingId: v.id('buildings'),
    tenantId: v.id('tenants'),
    date: v.string(),
    startMinutes: v.number(),
    endMinutes: v.number(),
    note: v.optional(v.string()),
    bookedAt: v.number(),
    bookedBy: v.optional(v.id('users')),
  })
    .index('by_building_date', ['buildingId', 'date'])
    .index('by_tenant_date', ['tenantId', 'date']),

  /** Harm-reduction supplies handed over, capped per resident per day. */
  supplyIssues: defineTable({
    buildingId: v.id('buildings'),
    tenantId: v.id('tenants'),
    item: supplyItem,
    date: v.string(),
    issuedAt: v.number(),
    issuedBy: v.optional(v.id('users')),
    note: v.optional(v.string()),
  })
    .index('by_building_date', ['buildingId', 'date'])
    .index('by_tenant_date', ['tenantId', 'date']),

  /**
   * The bike room log. One row per stay: written when the machine comes in,
   * closed when it goes out. An open row is a machine still in the building.
   */
  wheeledMovements: defineTable({
    buildingId: v.id('buildings'),
    tenantId: v.id('tenants'),
    kind: wheeledKind,
    description: v.string(),
    signedInAt: v.number(),
    signedInBy: v.optional(v.id('users')),
    signedOutAt: v.optional(v.number()),
    signedOutBy: v.optional(v.id('users')),
  })
    .index('by_building_in', ['buildingId', 'signedInAt'])
    .index('by_tenant_in', ['tenantId', 'signedInAt']),

  /** The animals living in the building, and who they belong to. */
  pets: defineTable({
    buildingId: v.id('buildings'),
    tenantId: v.optional(v.id('tenants')),
    name: v.string(),
    kind: v.string(),
    description: v.optional(v.string()),
    retiredAt: v.optional(v.number()),
  }).index('by_building', ['buildingId']),

  /** Confirmation that an animal has been seen and is well. */
  petSightings: defineTable({
    petId: v.id('pets'),
    buildingId: v.id('buildings'),
    seenAt: v.number(),
    seenBy: v.optional(v.id('users')),
    note: v.optional(v.string()),
  })
    .index('by_pet_seen', ['petId', 'seenAt'])
    .index('by_building_seen', ['buildingId', 'seenAt']),

  /**
   * People who come to see residents.
   *
   * A visitor is registered once — name, date of birth or ID, a photo — and
   * every later visit is two taps: who they are here to see, and the time.
   * Asking a returning guest for their date of birth every Saturday is how a
   * sign-in book stops being filled in.
   *
   * A ban lives on the visitor rather than on the visit, because the question
   * at the door is "is this person allowed in", not "was the last visit fine".
   */
  visitors: defineTable({
    buildingId: v.id('buildings'),
    name: v.string(),
    dob: v.optional(v.string()),
    idNumber: v.optional(v.string()),
    photoId: v.optional(v.id('_storage')),
    note: v.optional(v.string()),

    bannedAt: v.optional(v.number()),
    bannedBy: v.optional(v.id('users')),
    bannedReason: v.optional(v.string()),
    /** Absent while banned means indefinitely. */
    bannedUntil: v.optional(v.string()),
  })
    .index('by_building', ['buildingId'])
    .index('by_building_name', ['buildingId', 'name']),

  /** One row per visit, so "who do they usually come for" is answerable. */
  visits: defineTable({
    visitorId: v.id('visitors'),
    buildingId: v.id('buildings'),
    tenantId: v.id('tenants'),
    signedInAt: v.number(),
    signedInBy: v.optional(v.id('users')),
    signedOutAt: v.optional(v.number()),
    signedOutBy: v.optional(v.id('users')),
    /** Staying the night, and whether that was covered by an authorization. */
    overnight: v.boolean(),
    authorized: v.optional(v.boolean()),
    note: v.optional(v.string()),
  })
    .index('by_visitor_in', ['visitorId', 'signedInAt'])
    .index('by_building_in', ['buildingId', 'signedInAt'])
    .index('by_tenant_in', ['tenantId', 'signedInAt']),

  /**
   * Permission for a guest to stay the night with a particular resident.
   *
   * Granted by a site manager, not by whoever is on the desk at 11pm. `days`
   * holds weekday numbers (0 = Sunday), so "weekends" is [0, 6] and there is
   * no separate vocabulary to keep in step.
   */
  overnightAuthorizations: defineTable({
    visitorId: v.id('visitors'),
    tenantId: v.id('tenants'),
    buildingId: v.id('buildings'),
    days: v.array(v.number()),
    fromDate: v.optional(v.string()),
    toDate: v.optional(v.string()),
    note: v.optional(v.string()),
    authorizedAt: v.number(),
    authorizedBy: v.optional(v.id('users')),
    revokedAt: v.optional(v.number()),
  })
    .index('by_building', ['buildingId'])
    .index('by_visitor', ['visitorId'])
    .index('by_tenant', ['tenantId']),

  workOrders: defineTable({
    buildingId: v.id('buildings'),
    roomId: v.optional(v.id('rooms')),
    title: v.string(),
    detail: v.optional(v.string()),
    status: v.union(
      v.literal('open'),
      v.literal('assigned'),
      v.literal('closed'),
    ),
    priority: v.union(v.literal('high'), v.literal('med'), v.literal('low')),
    openedAt: v.number(),
    closedAt: v.optional(v.number()),
    assignedTo: v.optional(v.string()),
  })
    .index('by_building', ['buildingId'])
    .index('by_building_status', ['buildingId', 'status']),
})
