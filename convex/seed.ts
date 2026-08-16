import { v } from 'convex/values'
import { internalMutation, mutation } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'
import { SHIFTS, recomputeTenantRollups, shiftAt } from './model'

/**
 * Development seed. Every resident, building and dollar figure below is
 * fictional — it mirrors the UI-kit sample data so the app can be demoed and
 * reviewed against the design without touching real tenant information.
 *
 * Run once:  npx convex run seed:run
 * Start over: npx convex run seed:run '{"reset": true}'
 */

const DAY = 86_400_000

type Level = 'independent' | 'moderate' | 'high' | 'critical'

/** The ten residents named in the design system's UI kit, kept verbatim. */
const NAMED: {
  room: string
  name: string
  level: Level
  rent: number
  balance: number
  deposit: number
  depositReq: number
  critical: boolean
  intake: string
  dob: string
}[] = [
  { room: '204', name: 'Dwayne Robinson', level: 'moderate', rent: 540, balance: 0, deposit: 540, depositReq: 540, critical: false, intake: '2024-03-12', dob: '1968-07-04' },
  { room: '118', name: 'Maria Santos', level: 'critical', rent: 495, balance: 495, deposit: 405, depositReq: 495, critical: true, intake: '2025-11-02', dob: '1971-01-22' },
  { room: '301', name: 'Kofi Mensah', level: 'independent', rent: 612, balance: 0, deposit: 612, depositReq: 612, critical: false, intake: '2023-06-19', dob: '1959-09-30' },
  { room: '109', name: 'Eleanor Whitfield', level: 'high', rent: 585, balance: 292.5, deposit: 585, depositReq: 585, critical: true, intake: '2025-02-08', dob: '1948-12-15' },
  { room: '212', name: 'Marcus Bell', level: 'moderate', rent: 540, balance: 0, deposit: 540, depositReq: 540, critical: false, intake: '2024-09-23', dob: '1982-05-11' },
  { room: '305', name: 'Priya Nair', level: 'independent', rent: 640, balance: 0, deposit: 640, depositReq: 640, critical: false, intake: '2024-12-01', dob: '1990-03-08' },
  { room: '120', name: 'James O’Brien', level: 'high', rent: 495, balance: 495, deposit: 255, depositReq: 495, critical: false, intake: '2025-08-14', dob: '1955-11-27' },
  { room: '208', name: 'Linh Tran', level: 'moderate', rent: 565, balance: 0, deposit: 565, depositReq: 565, critical: false, intake: '2024-04-30', dob: '1977-06-02' },
  { room: '101', name: 'Gloria Adeyemi', level: 'critical', rent: 540, balance: 1080, deposit: 540, depositReq: 540, critical: true, intake: '2025-10-05', dob: '1962-08-19' },
  { room: '310', name: 'Samuel Cohen', level: 'independent', rent: 612, balance: 0, deposit: 612, depositReq: 612, critical: false, intake: '2023-01-17', dob: '1951-04-25' },
]

/** Filler residents for the remaining occupied rooms. Also fictional. */
const FILLER_NAMES = [
  'Anita Kaur', 'Robert Deschamps', 'Yusuf Abdi', 'Nadia Petrov', 'Colin Hargreaves',
  'Rosa Delgado', 'Tomas Novak', 'Beverly Lindsay', 'Hassan Karimi', 'Grace Oyelaran',
  'Peter Nakamura', 'Denise Fontaine', 'Ivan Sokolov', 'Amara Diallo', 'Frank Mulligan',
  'Sun-hee Park', 'Oscar Rivera', 'Helen Baptiste', 'Dmitri Lazar', 'Fatima Zahra',
  'Wesley Tanaka', 'Camille Rousseau', 'Andre Kowalski', 'Ruth Ndlovu', 'Victor Simmons',
  'Leilani Kahale', 'Gordon Fraser', 'Mei Chen', 'Terrence Blake', 'Sofia Marchetti',
  'Ali Rahman', 'Judith Osei', 'Nikolai Ivanov', 'Paulette Girard', 'Omar Haddad',
]

const DODSON_FLOORS = [
  { label: 'Floor 1', from: 101, to: 120 },
  { label: 'Floor 2', from: 201, to: 216 },
  { label: 'Floor 3', from: 301, to: 312 },
]
const DODSON_VACANT = ['107', '114', '203', '210', '307', '312']
const DODSON_CHECK_DUE = ['103', '111', '116', '201', '206', '302', '309']
const DODSON_RENT_DUE = ['105', '215', '304'] // one month behind, beyond the named ten

const OTHER_BUILDINGS = [
  { name: 'Carrall Annex', slug: 'carrall-annex', units: 36, occupied: 33, floors: [{ label: 'Floor 1', from: 101, to: 118 }, { label: 'Floor 2', from: 201, to: 218 }], rent: 505 },
  { name: 'Eastside Lodge', slug: 'eastside-lodge', units: 60, occupied: 57, floors: [{ label: 'Floor 1', from: 101, to: 120 }, { label: 'Floor 2', from: 201, to: 220 }, { label: 'Floor 3', from: 301, to: 320 }], rent: 575 },
]

const cents = (dollars: number) => Math.round(dollars * 100)

export const run = mutation({
  args: { reset: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('buildings').first()
    if (existing && !args.reset) {
      return {
        skipped: true,
        message:
          'Data already present. Re-run with {"reset": true} to wipe and reseed.',
      }
    }
    if (args.reset) await wipe(ctx)
    return await seed(ctx)
  },
})

/** Same as `run`, callable from other server code / CI without auth. */
export const runInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    await wipe(ctx)
    return await seed(ctx)
  },
})

async function wipe(ctx: MutationCtx) {
  const tables = [
    'shiftLogParticipants',
    'shiftLogEntries',
    'shiftReports',
    'wellnessChecks',
    'supportLevelChanges',
    'rentLedger',
    'depositEntries',
    'roomChecks',
    'criticalNeeds',
    'workOrders',
    'tenants',
    'rooms',
    'buildings',
  ] as const
  for (const table of tables) {
    const rows = await ctx.db.query(table).collect()
    for (const row of rows) await ctx.db.delete(row._id)
  }
}

async function seed(ctx: MutationCtx) {
  const now = Date.now()

  // ---------------------------------------------------------------- Dodson
  const dodsonId = await ctx.db.insert('buildings', {
    name: 'Dodson Rooms',
    slug: 'dodson-rooms',
    address: '25 East Hastings Street',
    units: 48,
    })

  const roomIdByNumber = new Map<string, Id<'rooms'>>()
  let sort = 0
  for (const floor of DODSON_FLOORS) {
    for (let n = floor.from; n <= floor.to; n++) {
      const number = String(n)
      const due = DODSON_CHECK_DUE.includes(number)
      const id = await ctx.db.insert('rooms', {
        buildingId: dodsonId,
        number,
        floor: floor.label,
        sortKey: sort++,
        monthlyRentCents: cents(540),
        // Rooms flagged "due" were last checked 9 days ago; the rest, yesterday.
        lastCheckedAt: due ? now - 9 * DAY : now - 1 * DAY,
      })
      roomIdByNumber.set(number, id)
    }
  }

  const occupiedRooms = [...roomIdByNumber.keys()].filter(
    (n) => !DODSON_VACANT.includes(n),
  )
  const namedByRoom = new Map(NAMED.map((t) => [t.room, t]))
  let fillerIdx = 0

  const tenantIdByRoom = new Map<string, Id<'tenants'>>()

  for (const number of occupiedRooms) {
    const named = namedByRoom.get(number)
    const roomId = roomIdByNumber.get(number)!

    const rentDollars = named?.rent ?? 540
    const depositReq = named?.depositReq ?? rentDollars
    const level: Level =
      named?.level ??
      (['independent', 'moderate', 'moderate', 'high'] as Level[])[fillerIdx % 4]!

    const tenantId = await ctx.db.insert('tenants', {
      buildingId: dodsonId,
      roomId,
      name: named?.name ?? FILLER_NAMES[fillerIdx % FILLER_NAMES.length]!,
      dob: named?.dob ?? `19${60 + (fillerIdx % 30)}-0${(fillerIdx % 9) + 1}-1${fillerIdx % 9}`,
      intakeDate: named?.intake ?? `202${3 + (fillerIdx % 3)}-0${(fillerIdx % 9) + 1}-15`,
      status: 'current',
      supportLevel: level,
      monthlyRentCents: cents(rentDollars),
      depositRequiredCents: cents(depositReq),
    })
    if (!named) fillerIdx++
    tenantIdByRoom.set(number, tenantId)

    // ---- Ledger: three months charged, paid down to the target balance ----
    const balanceDollars =
      named?.balance ?? (DODSON_RENT_DUE.includes(number) ? rentDollars : 0)
    const chargedDollars = rentDollars * 3
    const paidDollars = chargedDollars - balanceDollars

    for (let m = 2; m >= 0; m--) {
      await ctx.db.insert('rentLedger', {
        tenantId,
        buildingId: dodsonId,
        kind: 'charge',
        amountCents: cents(rentDollars),
        postedAt: now - m * 30 * DAY,
        periodLabel: monthLabel(now - m * 30 * DAY),
      })
    }
    if (paidDollars > 0) {
      // Pay whole months first, then any part-month remainder.
      let remaining = paidDollars
      let m = 2
      while (remaining > 0.004 && m >= 0) {
        const chunk = Math.min(rentDollars, remaining)
        await ctx.db.insert('rentLedger', {
          tenantId,
          buildingId: dodsonId,
          kind: 'payment',
          amountCents: cents(chunk),
          postedAt: now - m * 30 * DAY + 2 * DAY,
          method: m % 2 === 0 ? 'cheque' : 'eft',
          reference: m % 2 === 0 ? `CHQ-${4200 + fillerIdx + m}` : undefined,
        })
        remaining -= chunk
        m--
      }
    }

    // ---- Security deposit ----
    const heldDollars = named?.deposit ?? depositReq
    if (heldDollars > 0) {
      await ctx.db.insert('depositEntries', {
        tenantId,
        buildingId: dodsonId,
        amountCents: cents(heldDollars),
        postedAt: now - 200 * DAY,
        reason: 'Deposit collected at intake',
      })
    }

    if (named?.critical) {
      await ctx.db.insert('criticalNeeds', {
        tenantId,
        buildingId: dodsonId,
        summary: 'Wellness check scheduled',
        detail: 'Case manager visit due this week.',
        openedAt: now - 6 * DAY,
        caseManager: 'D. Whitehorse',
      })
    }
  }

  // ---- Check history: 14 straight days of logged checks (the streak) ----
  for (let d = 1; d <= 14; d++) {
    await ctx.db.insert('roomChecks', {
      buildingId: dodsonId,
      roomId: roomIdByNumber.get('204'),
      kind: 'room',
      completedAt: now - d * DAY,
      outcome: 'all-clear',
    })
  }
  // Building check last done 9 days ago → 2 days past the 7-day policy.
  await ctx.db.insert('roomChecks', {
    buildingId: dodsonId,
    kind: 'building',
    completedAt: now - 9 * DAY,
    outcome: 'all-clear',
    notes: 'Fire route clear. Laundry room light out.',
  })

  await ctx.db.insert('workOrders', {
    buildingId: dodsonId,
    roomId: roomIdByNumber.get('118'),
    title: 'No heat in Room 118',
    detail: 'Maria Santos is on critical needs. Trades not yet assigned.',
    status: 'open',
    priority: 'high',
    openedAt: now - 2 * DAY,
  })
  await ctx.db.insert('workOrders', {
    buildingId: dodsonId,
    roomId: roomIdByNumber.get('215'),
    title: 'Dripping tap, Room 215',
    detail: 'Reported at front desk.',
    status: 'open',
    priority: 'low',
    openedAt: now - 5 * DAY,
  })

  // ------------------------------------------------- Other two buildings
  let nameCursor = 7
  for (const spec of OTHER_BUILDINGS) {
    const buildingId = await ctx.db.insert('buildings', {
      name: spec.name,
      slug: spec.slug,
      units: spec.units,
    })
    const numbers: { number: string; floor: string }[] = []
    for (const floor of spec.floors) {
      for (let n = floor.from; n <= floor.to; n++) {
        numbers.push({ number: String(n), floor: floor.label })
      }
    }
    let s = 0
    for (const { number, floor } of numbers) {
      const roomId = await ctx.db.insert('rooms', {
        buildingId,
        number,
        floor,
        sortKey: s,
        monthlyRentCents: cents(spec.rent),
        lastCheckedAt: now - ((s % 9) + 1) * DAY,
      })
      // Leave the last few rooms of each building vacant.
      if (s < spec.occupied) {
        const tenantId = await ctx.db.insert('tenants', {
          buildingId,
          roomId,
          name: FILLER_NAMES[nameCursor++ % FILLER_NAMES.length]!,
          intakeDate: '2024-05-20',
          status: 'current',
          supportLevel: (['independent', 'moderate', 'high'] as Level[])[s % 3]!,
          monthlyRentCents: cents(spec.rent),
          depositRequiredCents: cents(spec.rent),
        })
        await ctx.db.insert('rentLedger', {
          tenantId,
          buildingId,
          kind: 'charge',
          amountCents: cents(spec.rent),
          postedAt: now - 10 * DAY,
          periodLabel: monthLabel(now),
        })
        if (s % 7 !== 0) {
          await ctx.db.insert('rentLedger', {
            tenantId,
            buildingId,
            kind: 'payment',
            amountCents: cents(spec.rent),
            postedAt: now - 8 * DAY,
            method: 'cheque',
          })
        }
        await ctx.db.insert('depositEntries', {
          tenantId,
          buildingId,
          amountCents: cents(spec.rent),
          postedAt: now - 300 * DAY,
          reason: 'Deposit collected at intake',
        })
      }
      s++
    }
    await ctx.db.insert('roomChecks', {
      buildingId,
      kind: 'building',
      completedAt: now - 2 * DAY,
      outcome: 'all-clear',
    })
  }

  const [buildings, rooms, tenants] = await Promise.all([
    ctx.db.query('buildings').collect(),
    ctx.db.query('rooms').collect(),
    ctx.db.query('tenants').collect(),
  ])

  // The seed writes ledger and deposit rows directly, so the per-tenant
  // rollups those rows mirror are computed once at the end.
  for (const tenant of tenants) {
    await recomputeTenantRollups(ctx, tenant._id)
  }

  await seedCare(ctx, now)

  return {
    skipped: false,
    buildings: buildings.length,
    rooms: rooms.length,
    tenants: tenants.length,
  }
}

/**
 * Bio data for tenants seeded before the record grew: pronouns, phone, a next
 * of kin, and health answers. Fictional, like the rest of the seed.
 *
 *     npx convex run seed:bioOnly
 */
export const bioOnly = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tenants = await ctx.db.query('tenants').collect()
    const PRONOUNS = ['He/Him', 'She/Her', 'They/Them']
    const RELATIONS = ['sister', 'brother', 'partner', 'son', 'daughter', 'friend']
    const CONDITIONS = [
      'Type 2 diabetes — insulin in the room fridge',
      'Epilepsy — seizures reported, last one in March',
      'COPD — home oxygen on site',
      '',
    ]

    let filled = 0
    for (const [i, tenant] of tenants.entries()) {
      if (tenant.pronouns) continue

      const critical = tenant.supportLevel === 'critical'
      const high = tenant.supportLevel === 'high' || critical

      await ctx.db.patch(tenant._id, {
        pronouns: PRONOUNS[i % PRONOUNS.length],
        phone: `(604) ${200 + (i % 700)}-${1000 + ((i * 37) % 8999)}`,
        populationGroup: undefined,
        flags: {
          houseAbility: critical ? 'amber' : 'green',
          mental: critical ? 'amber' : 'none',
          physical: high ? 'amber' : 'none',
          pest: i % 11 === 0 ? 'amber' : 'green',
          clutter: i % 7 === 0 ? 'amber' : 'green',
        },
        health: {
          mobilityIssues: high ? true : i % 3 === 0 ? false : undefined,
          dnrOrder: i % 13 === 0 ? true : undefined,
          overdoseAlert: critical ? true : undefined,
          substanceUse: critical || i % 5 === 0 ? true : undefined,
          schizophrenia: critical && i % 2 === 0 ? true : undefined,
          careRxProgram: high ? true : undefined,
          conditions: CONDITIONS[i % CONDITIONS.length] || undefined,
          mobilityAids: high ? 'Uses a walker — cannot manage stairs' : undefined,
          careNotes: critical ? 'Knock loudly and wait — hard of hearing' : undefined,
        },
        intake: {
          sourceOfIncome: 'Income assistance',
          employmentType: 'Not employed',
          mhrOffice: 'Downtown Eastside',
        },
        documents: {
          intentToRent: true,
          signedTenancyAgreement: i % 9 !== 0,
          covRoomRegistration: i % 6 !== 0,
          releaseOfInformation: i % 4 !== 0,
        },
      })

      const existing = await ctx.db
        .query('tenantContacts')
        .withIndex('by_tenant', (q) => q.eq('tenantId', tenant._id))
        .first()
      if (!existing && i % 3 !== 2) {
        await ctx.db.insert('tenantContacts', {
          tenantId: tenant._id,
          buildingId: tenant.buildingId,
          name: ['Jane Doe', 'Michael Osei', 'Rosa Delgado', 'Tomas Novak'][i % 4]!,
          relationship: RELATIONS[i % RELATIONS.length]!,
          phone: `(604) ${300 + (i % 600)}-${2000 + ((i * 53) % 7999)}`,
          isNextOfKin: true,
        })
      }

      filled++
    }

    return { filled, of: tenants.length }
  },
})

/**
 * Care data only — wellness checks and a handover — without touching the rest.
 * For a deployment that was seeded before the Care Console existed:
 *
 *     npx convex run seed:careOnly
 */
export const careOnly = internalMutation({
  args: {
    /** The building's UTC offset, as the browser reports it (e.g. 420 for UTC−7). */
    tzOffsetMinutes: v.optional(v.number()),
    reset: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('wellnessChecks').first()
    if (existing && !args.reset) {
      return { skipped: true, message: 'Wellness checks already present. Pass {"reset": true}.' }
    }
    if (args.reset) {
      for (const table of [
        'wellnessChecks',
        'shiftLogParticipants',
        'shiftLogEntries',
        'shiftReports',
      ] as const) {
        for (const row of await ctx.db.query(table).collect()) await ctx.db.delete(row._id)
      }
    }
    await seedCare(ctx, Date.now(), args.tzOffsetMinutes ?? 0)
    const checks = await ctx.db.query('wellnessChecks').collect()
    return { skipped: false, checks: checks.length }
  },
})

/**
 * Wellness checks for the shift board, and one submitted handover.
 *
 * The board only means anything with history behind it: the two segments
 * before the live one are complete apart from a couple of refusals, and the
 * live one is part-done — which is what a console looks like mid-shift.
 */
async function seedCare(ctx: MutationCtx, now: number, tzOffsetMinutes = 0) {
  const buildings = await ctx.db.query('buildings').collect()
  const current = shiftAt(now, tzOffsetMinutes)
  const index = SHIFTS.findIndex((s) => s.key === current.key)

  for (const building of buildings) {
    const tenants = await ctx.db
      .query('tenants')
      .withIndex('by_building_status', (q) =>
        q.eq('buildingId', building._id).eq('status', 'current'),
      )
      .collect()
    if (tenants.length === 0) continue

    // Two residents per building never answer the door — they become the
    // flagged list the console leads with.
    const stubborn = new Set([tenants[1]?._id, tenants[4]?._id].filter(Boolean))

    for (let back = 2; back >= 0; back--) {
      let i = index - back
      let dayBack = 0
      while (i < 0) {
        i += SHIFTS.length
        dayBack += 1
      }
      const segment = SHIFTS[i]!
      const day = new Date(`${current.shiftDate}T00:00:00Z`)
      day.setUTCDate(day.getUTCDate() - dayBack)
      const shiftDate = day.toISOString().slice(0, 10)
      const live = back === 0

      for (const [n, tenant] of tenants.entries()) {
        // The live shift is only part-way through: later rooms are still to do.
        if (live && n >= Math.ceil(tenants.length * 0.6)) continue

        const refused = stubborn.has(tenant._id)
        await ctx.db.insert('wellnessChecks', {
          buildingId: building._id,
          tenantId: tenant._id,
          roomId: tenant.roomId,
          shiftDate,
          shiftKey: segment.key,
          outcome: refused ? (n % 2 === 0 ? 'refused' : 'absent') : 'seen',
          note: refused ? 'No contact — escalated to coordinator' : undefined,
          completedAt: now - (back * 8 + (tenants.length - n) * 0.2) * 3_600_000,
        })
      }
    }
  }

  // One submitted handover on the building the demo opens on.
  const first = buildings[0]
  const anyStaff = await ctx.db.query('users').first()
  if (!first || !anyStaff) return

  const previous = SHIFTS[(index + SHIFTS.length - 1) % SHIFTS.length]!
  const reportId = await ctx.db.insert('shiftReports', {
    buildingId: first._id,
    shiftDate: current.shiftDate,
    shiftKey: previous.key,
    authorId: anyStaff._id,
    authorRole: 'rsw',
    status: 'submitted',
    summary:
      'Quiet shift. Two refusals on wellness checks escalated to the coordinator. Fire panel test completed with the vendor at 11:00.',
    importantInfo:
      'Room 118 still not contacted across four shifts — manager following up in the morning.',
    radioCheck: true,
    handover: true,
    readPrevious: true,
    duties: { rounds: true, 'harm-reduction': true, lobby: true, bathrooms: false, medication: true, requests: false },
    startedAt: now - 9 * 3_600_000,
    submittedAt: now - 1 * 3_600_000,
  })

  const tenantForIncident = await ctx.db
    .query('tenants')
    .withIndex('by_building_status', (q) =>
      q.eq('buildingId', first._id).eq('status', 'current'),
    )
    .first()

  const entryId = await ctx.db.insert('shiftLogEntries', {
    reportId,
    buildingId: first._id,
    log: 'interaction',
    location: 'Lobby / amenity',
    occurredAt: now - 5 * 3_600_000,
    kind: 'medical',
    comments:
      'Suspected overdose in the second-floor lobby. Narcan administered, EHS attended, resident stable and monitored for the rest of the shift.',
    significant: true,
    cameraReview: true,
    loggedBy: anyStaff._id,
  })

  if (tenantForIncident) {
    await ctx.db.insert('shiftLogParticipants', {
      entryId,
      tenantId: tenantForIncident._id,
      buildingId: first._id,
      occurredAt: now - 5 * 3_600_000,
    })
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthLabel(ts: number): string {
  const d = new Date(ts)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
