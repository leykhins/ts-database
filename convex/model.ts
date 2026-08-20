import { getAuthUserId } from '@convex-dev/auth/server'
import type { Doc, Id } from './_generated/dataModel'
import type { QueryCtx, MutationCtx } from './_generated/server'

/** A room check older than this is "due". Policy: weekly room checks. */
export const CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

export type RoomStatus =
  | 'ok'
  | 'rent'
  | 'check'
  | 'deposit'
  | 'critical'
  | 'vacant'

/**
 * Every function in this app is staff-only. Callers get the user document, so
 * downstream code can attribute a payment or a completed check to a person —
 * "who posted this" is not optional in a housing ledger.
 */
export async function requireStaff(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<'users'>> {
  const userId = await getAuthUserId(ctx)
  if (userId === null) throw new Error('Not signed in.')
  const user = await ctx.db.get(userId)
  if (user === null) throw new Error('Signed-in user no longer exists.')
  return user
}

/* ------------------------------------------------------------------------
   Usernames

   Staff sign in with a username, not an email address. Building workers do not
   reliably have work email, and this app sends no mail — an address was only
   ever serving as an account key it is badly suited to.

   These two functions are authoritative on the server: the normalized username
   *is* the account identifier that `createAccount` and `retrieveAccount` match
   on, so if the client and the server ever disagreed about what "Asha " means,
   the account would simply not be found.
   ------------------------------------------------------------------------ */

/** Password floor, applied everywhere a credential is set. */
export const MIN_PASSWORD = 8

export function normalizeUsername(raw: string | undefined): string {
  return (raw ?? '').trim().toLowerCase()
}

const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/

/** Throws naming the rule that was broken. Call on an already-normalized name. */
export function validateUsername(username: string): void {
  // Checked before the pattern, so the likeliest mistake gets the most useful
  // message rather than a generic one about permitted characters.
  if (username.includes('@')) {
    throw new Error(
      'A username is not an email address — use the short name, for example “asha.okafor”.',
    )
  }
  if (username.length < 3) throw new Error('A username needs at least 3 characters.')
  if (username.length > 32) throw new Error('A username can be at most 32 characters.')
  if (!USERNAME.test(username)) {
    throw new Error(
      'Use lowercase letters, digits, dots, hyphens and underscores, starting with a letter or digit.',
    )
  }
}

/* ------------------------------------------------------------------------
   Roles and capabilities

   Reading is open to all staff: someone covering a shift needs the whole
   picture, and hiding a resident's balance from the person at the desk helps
   nobody. Writing is not. Each capability below names a kind of write, and the
   table says which roles may perform it. This map is the whole permission
   model — change a line here and the server, the nav and the disabled buttons
   all follow.

     config           the portfolio and the people: create and remove
                      buildings, create and remove staff accounts, set roles
     building-config  one building's fabric: its rooms, taking a room out of
                      service, the building's own name and address
     site-config      how one building runs: meal sittings, laundry hours, limits
     money            rent payments, monthly charges, deposit movements
     care             support levels, critical needs
     tenancy          intake, room moves, exits, editing a resident's record
     checks           room and building check sign-off, work orders
     wellness         wellness checks, shift reports, services, visitors

   `config` and `building-config` are deliberately separate. A building manager
   runs their own sites' rooms without being handed the staff directory or the
   ability to delete a building, and that distinction is what makes the role
   expressible here rather than as an `if (role === …)` somewhere downstream.
   ------------------------------------------------------------------------ */

export type Capability =
  | 'config'
  | 'building-config'
  | 'site-config'
  | 'money'
  | 'care'
  | 'tenancy'
  | 'checks'
  | 'wellness'

export type Role =
  | 'admin'
  | 'building-manager'
  | 'coordinator'
  | 'rsw'
  | 'wellness'
  | 'home-support'

/** Strictly nested: admin ⊃ building-manager ⊃ coordinator ⊃ the care roles. */
export const CAPABILITIES: Record<Role, Capability[]> = {
  admin: ['config', 'building-config', 'site-config', 'money', 'care', 'tenancy', 'checks', 'wellness'],
  'building-manager': ['building-config', 'site-config', 'money', 'care', 'tenancy', 'checks', 'wellness'],
  coordinator: ['site-config', 'money', 'care', 'tenancy', 'checks', 'wellness'],
  // The three care roles carry the same authority and differ in the duties
  // they are asked to complete on shift — see `DUTIES` below.
  rsw: ['care', 'checks', 'wellness'],
  wellness: ['care', 'checks', 'wellness'],
  'home-support': ['care', 'checks', 'wellness'],
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrator',
  'building-manager': 'Building Manager',
  coordinator: 'Coordinator',
  rsw: 'Resident Support Worker',
  wellness: 'Wellness Worker',
  'home-support': 'Home Support Worker',
}

/**
 * The role an account falls back to when it has none on record.
 *
 * The least-privileged one, deliberately. This used to be a mid-privilege role
 * that could take rent, so a half-created account was quietly trusted with
 * money.
 */
export const DEFAULT_ROLE: Role = 'rsw'

/* ------------------------------------------------------------------------
   Shifts

   A day is three segments. This is policy, not data: the building is staffed
   around the clock and every wellness check belongs to exactly one segment.
   The client passes its clock in (a query must not read the wall clock), and
   passes its UTC offset so "which shift is live" is answered in the building's
   local time rather than UTC.
   ------------------------------------------------------------------------ */

export type ShiftKey = 'overnight' | 'morning' | 'evening'

export const SHIFTS: {
  key: ShiftKey
  label: string
  hours: string
  icon: string
  from: number
  to: number
}[] = [
  { key: 'overnight', label: 'Overnight Staff', hours: '12 – 8 am', icon: 'moon', from: 0, to: 8 },
  { key: 'morning', label: 'Morning Staff', hours: '8 am – 4 pm', icon: 'sunrise', from: 8, to: 16 },
  { key: 'evening', label: 'Evening Staff', hours: '4 pm – 12 am', icon: 'sunset', from: 16, to: 24 },
]

/**
 * The calendar day a moment falls on, in the building's local time.
 * `tzOffsetMinutes` is the browser's `getTimezoneOffset()` — minutes *behind*
 * UTC, so local = utc − offset.
 */
export function localDate(now: number, tzOffsetMinutes: number): string {
  return new Date(now - tzOffsetMinutes * 60_000).toISOString().slice(0, 10)
}

/** Minutes from midnight, in the building's local time. */
export function localMinutes(now: number, tzOffsetMinutes: number): number {
  const local = new Date(now - tzOffsetMinutes * 60_000)
  return local.getUTCHours() * 60 + local.getUTCMinutes()
}

/**
 * The shift a moment belongs to. `tzOffsetMinutes` is the browser's
 * `getTimezoneOffset()` — minutes *behind* UTC, so local = utc − offset.
 */
export function shiftAt(
  now: number,
  tzOffsetMinutes: number,
): { key: ShiftKey; shiftDate: string; hour: number } {
  const local = new Date(now - tzOffsetMinutes * 60_000)
  const hour = local.getUTCHours()
  const shift = SHIFTS.find((s) => hour >= s.from && hour < s.to) ?? SHIFTS[2]!
  return { key: shift.key, shiftDate: local.toISOString().slice(0, 10), hour }
}

/* ------------------------------------------------------------------------
   Duties

   The standing tasks each care role is asked to complete on a shift. Kept in
   code rather than a table because they are the job description, not
   operational data: they change when the role changes, which is a deploy.
   ------------------------------------------------------------------------ */

export type Duty = { key: string; label: string; meta: string; icon: string }

export const DUTIES: Record<string, { title: string; icon: string; accent: string; items: Duty[] }> = {
  rsw: {
    title: 'Building Rounds & Tasks',
    icon: 'route',
    accent: 'blue',
    items: [
      { key: 'rounds', label: 'Rounds — building & grounds', meta: 'Every 30 minutes', icon: 'route' },
      { key: 'harm-reduction', label: 'Harm-reduction room restock', meta: 'Restock and clean', icon: 'shield-check' },
      { key: 'lobby', label: 'Lobby & amenity areas', meta: 'Sweep / mop', icon: 'home' },
      { key: 'bathrooms', label: 'Staff & shared bathrooms', meta: 'Due this shift', icon: 'door' },
      { key: 'medication', label: 'Medication support', meta: 'Per policy', icon: 'pill' },
      { key: 'requests', label: 'Resident assistance requests', meta: 'Laundry, deliveries, escorts', icon: 'notes' },
    ],
  },
  'home-support': {
    title: 'Personal Care & Medication',
    icon: 'pill',
    accent: 'teal',
    items: [
      { key: 'bathing', label: 'Bathing and hygiene assists', meta: 'Activities of daily living', icon: 'user-check' },
      { key: 'transfers', label: 'Toileting & transfers', meta: 'Mobility support', icon: 'user-check' },
      { key: 'wound-care', label: 'Wound and dressing care', meta: 'Per care plan', icon: 'heart' },
      { key: 'med-pass', label: 'Medication pass', meta: 'Transfer of function', icon: 'pill' },
      { key: 'meals', label: 'Meal and feeding support', meta: 'Monitor intake', icon: 'notes' },
      { key: 'observations', label: 'Observation log', meta: 'Document changes', icon: 'file-text' },
    ],
  },
  wellness: {
    title: 'Care Plans & Referrals',
    icon: 'heart',
    accent: 'violet',
    items: [
      { key: 'housing-retention', label: 'Housing-retention reviews', meta: 'Care plan work', icon: 'heart' },
      { key: 'referrals', label: 'Referrals — income, health, treatment', meta: 'Open referrals', icon: 'arrow-right' },
      { key: 'appointments', label: 'Appointment follow-up', meta: 'Encourage and escort', icon: 'calendar' },
      { key: 'care-plans', label: 'Care-plan updates', meta: 'Due this shift', icon: 'notes' },
      { key: 'crisis', label: 'Crisis check-ins', meta: 'De-escalation and support', icon: 'shield-check' },
      { key: 'mentorship', label: 'New-staff mentorship', meta: 'Shadowing', icon: 'user-check' },
    ],
  },
}

/** Duties for a role, falling back to the RSW list for non-care roles. */
export function dutiesFor(role: Role) {
  return DUTIES[role] ?? DUTIES.rsw!
}

/** The role a user's *real* account holds. */
export function realRole(user: Doc<'users'>): Role {
  return (user.role ?? DEFAULT_ROLE) as Role
}

/**
 * The role the server acts on. An administrator testing the app as another
 * role gets that role's permissions for real — otherwise the test proves
 * nothing about what a support worker can actually do.
 */
export function effectiveRole(user: Doc<'users'>): Role {
  return (user.simulatedRole ?? user.role ?? DEFAULT_ROLE) as Role
}

export function can(user: Doc<'users'>, capability: Capability): boolean {
  return CAPABILITIES[effectiveRole(user)].includes(capability)
}

/** Staff guard that also insists on a capability. Returns the caller. */
export async function requireCapability(
  ctx: QueryCtx | MutationCtx,
  capability: Capability,
): Promise<Doc<'users'>> {
  const user = await requireStaff(ctx)
  if (!can(user, capability)) {
    const role = ROLE_LABEL[effectiveRole(user)]
    throw new Error(
      user.simulatedRole
        ? `Not permitted while testing as ${role}. Switch back to your own role to do this.`
        : `${role} accounts cannot do this. Ask a supervisor or administrator.`,
    )
  }
  return user
}

/**
 * Administrator-only. The portfolio and the staff directory are configuration:
 * a mistake there is not recoverable from the UI, so the server refuses the
 * write rather than trusting a hidden menu item.
 */
export async function requireAdmin(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<'users'>> {
  return await requireCapability(ctx, 'config')
}

/**
 * Resolve each resident's photo to a URL, once, for a list that shows faces.
 *
 * Casual and relief staff do not know residents by name. A face in the row is
 * the difference between reading a note about "Room 102" and knowing who
 * answered the door, so the lists that drive a shift carry photos.
 */
export async function photoUrlsFor(
  ctx: QueryCtx | MutationCtx,
  tenants: Doc<'tenants'>[],
): Promise<Map<string, string | null>> {
  const entries = await Promise.all(
    tenants.map(
      async (tenant) =>
        [
          tenant._id as string,
          tenant.photoId ? await ctx.storage.getUrl(tenant.photoId) : null,
        ] as const,
    ),
  )
  return new Map(entries)
}

/** Balance owed, in cents. Charges minus payments and credits. */
export function balanceFromLedger(entries: Doc<'rentLedger'>[]): number {
  return entries.reduce(
    (sum, e) => sum + (e.kind === 'charge' ? e.amountCents : -e.amountCents),
    0,
  )
}

/* ------------------------------------------------------------------------
   Rollups

   `tenants.balanceCents` / `.depositHeldCents` mirror the two append-only
   tables. Every write goes through the helpers below so the mirror is updated
   inside the same transaction as the row it mirrors — the only arrangement in
   which the two cannot disagree. `recomputeTenantRollups` rebuilds them from
   the ledger and is the repair path if they ever do.
   ------------------------------------------------------------------------ */

/** Signed effect of a ledger row on what a tenant owes. */
export function ledgerDelta(kind: 'charge' | 'payment' | 'credit', amountCents: number): number {
  return kind === 'charge' ? amountCents : -amountCents
}

/** Insert a rent ledger row and move the tenant's cached balance with it. */
export async function applyLedgerEntry(
  ctx: MutationCtx,
  tenant: Doc<'tenants'>,
  entry: {
    kind: 'charge' | 'payment' | 'credit'
    amountCents: number
    postedAt: number
    periodLabel?: string
    method?: 'cheque' | 'cash' | 'eft' | 'money-order'
    reference?: string
    note?: string
    postedBy?: Id<'users'>
  },
): Promise<{ entryId: Id<'rentLedger'>; balanceCents: number }> {
  const entryId = await ctx.db.insert('rentLedger', {
    tenantId: tenant._id,
    buildingId: tenant.buildingId,
    ...entry,
  })

  const balanceCents = (tenant.balanceCents ?? 0) + ledgerDelta(entry.kind, entry.amountCents)

  await ctx.db.patch(tenant._id, {
    balanceCents,
    ...(entry.kind === 'payment'
      ? { lastPaymentAt: entry.postedAt, lastPaymentCents: entry.amountCents }
      : {}),
  })

  return { entryId, balanceCents }
}

/** Insert a deposit movement and move the tenant's cached held figure with it. */
export async function applyDepositEntry(
  ctx: MutationCtx,
  tenant: Doc<'tenants'>,
  entry: { amountCents: number; postedAt: number; reason: string; postedBy?: Id<'users'> },
): Promise<{ entryId: Id<'depositEntries'>; depositHeldCents: number }> {
  const entryId = await ctx.db.insert('depositEntries', {
    tenantId: tenant._id,
    buildingId: tenant.buildingId,
    ...entry,
  })

  const depositHeldCents = (tenant.depositHeldCents ?? 0) + entry.amountCents
  await ctx.db.patch(tenant._id, { depositHeldCents })

  return { entryId, depositHeldCents }
}

/** Rebuild one tenant's rollups from the tables they mirror. */
export async function recomputeTenantRollups(
  ctx: MutationCtx,
  tenantId: Id<'tenants'>,
): Promise<void> {
  const [ledger, deposits] = await Promise.all([
    ctx.db
      .query('rentLedger')
      .withIndex('by_tenant', (q) => q.eq('tenantId', tenantId))
      .collect(),
    ctx.db
      .query('depositEntries')
      .withIndex('by_tenant', (q) => q.eq('tenantId', tenantId))
      .collect(),
  ])

  const lastPayment = ledger
    .filter((e) => e.kind === 'payment')
    .sort((a, b) => b.postedAt - a.postedAt)[0]

  await ctx.db.patch(tenantId, {
    balanceCents: balanceFromLedger(ledger),
    depositHeldCents: depositHeld(deposits),
    lastPaymentAt: lastPayment?.postedAt,
    lastPaymentCents: lastPayment?.amountCents,
  })
}

export function depositHeld(entries: Doc<'depositEntries'>[]): number {
  return entries.reduce((sum, e) => sum + e.amountCents, 0)
}

/** Group ledger/deposit rows by tenant so a screen costs one table scan, not N. */
export function groupBy<T, K extends string>(
  rows: T[],
  key: (row: T) => K,
): Record<K, T[]> {
  const out = {} as Record<K, T[]>
  for (const row of rows) {
    const k = key(row)
    ;(out[k] ??= []).push(row)
  }
  return out
}

/**
 * The single place that decides what color a room is on the home screen.
 * Order matters and is deliberate: a resident in crisis outranks money owed,
 * money owed outranks paperwork.
 */
export function deriveRoomStatus(args: {
  tenant: Doc<'tenants'> | undefined
  balanceCents: number
  depositHeldCents: number
  hasOpenCriticalNeed: boolean
  lastCheckedAt: number | undefined
  now: number
}): { status: RoomStatus; note: string } {
  const { tenant, balanceCents, depositHeldCents, hasOpenCriticalNeed, lastCheckedAt, now } = args

  if (!tenant) return { status: 'vacant', note: 'Vacant' }
  if (hasOpenCriticalNeed) {
    return { status: 'critical', note: `${tenant.name} — critical needs on file` }
  }
  if (balanceCents > 0) {
    return { status: 'rent', note: `${tenant.name} — rent due ${money(balanceCents)}` }
  }
  if (depositHeldCents < tenant.depositRequiredCents) {
    return { status: 'deposit', note: `${tenant.name} — deposit short` }
  }
  if (lastCheckedAt === undefined || now - lastCheckedAt > CHECK_INTERVAL_MS) {
    return { status: 'check', note: 'Room check due' }
  }
  return { status: 'ok', note: `${tenant.name} — all clear` }
}

/** Server-side money formatting for notes that get stored or read as prose. */
export function money(cents: number): string {
  return (
    '$' +
    (cents / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

/* ------------------------------------------------------------------------
   Building access

   Staff cover the buildings they are assigned to and no others. This is not a
   UI filter: a resident's health record, a rent ledger and a visitor ban are
   all things a worker at another site has no business reading, and the server
   is where that gets settled.

   Judged on the *effective* role, so an administrator testing as a supervisor
   is held to that administrator's own assignments — the same principle
   `effectiveRole` already applies to capabilities. A simulation that quietly
   kept seeing every building would misrepresent the single most important
   thing about the role being simulated.
   ------------------------------------------------------------------------ */

/** The buildings a user may touch. `null` means all of them — administrators. */
export function assignedBuildingIds(user: Doc<'users'>): Id<'buildings'>[] | null {
  if (effectiveRole(user) === 'admin') return null
  return user.assignedBuildingIds ?? []
}

export function hasBuildingAccess(user: Doc<'users'>, buildingId: Id<'buildings'>): boolean {
  const allowed = assignedBuildingIds(user)
  return allowed === null || allowed.includes(buildingId)
}

/**
 * Refuse, rather than quietly returning nothing.
 *
 * A query that answers an out-of-scope request with `null` renders an empty
 * screen that reads as "no data" — a worker would conclude the building has no
 * residents rather than that they are looking at the wrong building. In this
 * app that is the one failure mode worth designing hardest against.
 */
export function assertBuildingAccess(user: Doc<'users'>, buildingId: Id<'buildings'>): void {
  if (hasBuildingAccess(user, buildingId)) return
  throw new Error('You are not assigned to that building. Ask an administrator for access.')
}

/**
 * Fetch-and-check, for everything that reaches a building through some other
 * record: a tenant, a room, a work order, a shift-report entry.
 *
 * Every building-scoped table in this schema carries `buildingId` directly, so
 * this is always one hop and never a chain of lookups.
 *
 *     const tenant = scoped(staff, await ctx.db.get(args.tenantId),
 *                           'That resident no longer exists.')
 */
export function scoped<T extends { buildingId: Id<'buildings'> }>(
  user: Doc<'users'>,
  doc: T | null,
  missing: string,
): T {
  if (!doc) throw new Error(missing)
  assertBuildingAccess(user, doc.buildingId)
  return doc
}

/**
 * Load a resident the caller is allowed to see.
 *
 * Returns `null` when the record does not exist, and *throws* when it exists in
 * a building the caller does not cover — the two are different answers and must
 * not be collapsed. Every per-resident read goes through this: a health record,
 * a SIN, a rent history and a shift note are exactly the things a worker at
 * another site must not be able to pull up by id.
 */
export async function scopedTenant(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
  tenantId: Id<'tenants'>,
): Promise<Doc<'tenants'> | null> {
  const tenant = await ctx.db.get(tenantId)
  if (!tenant) return null
  assertBuildingAccess(user, tenant.buildingId)
  return tenant
}

/** The building documents a user may see, for switchers and pickers. */
export async function assignedBuildings(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
): Promise<Doc<'buildings'>[]> {
  const allowed = assignedBuildingIds(user)
  if (allowed === null) return await ctx.db.query('buildings').collect()
  const docs = await Promise.all(allowed.map((id) => ctx.db.get(id)))
  return docs.filter((b): b is Doc<'buildings'> => b !== null)
}

/**
 * Resolve the building a screen should show: the one asked for, or the caller's
 * first assigned building.
 *
 * Never the deployment's first building, which is how a worker at Carrall Annex
 * ends up reading Dodson's ledger. Takes the caller precisely so that mistake
 * cannot be made silently — the signature is the reminder.
 */
export async function resolveBuilding(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
  buildingId: Id<'buildings'> | undefined,
): Promise<Doc<'buildings'> | null> {
  if (buildingId) {
    assertBuildingAccess(user, buildingId)
    return await ctx.db.get(buildingId)
  }
  const allowed = assignedBuildingIds(user)
  if (allowed === null) return await ctx.db.query('buildings').first()
  for (const id of allowed) {
    const building = await ctx.db.get(id)
    if (building) return building
  }
  return null
}

/**
 * Building configuration for a building the caller is assigned to.
 *
 * Two checks, not one: the capability says "may configure a building", the
 * assignment says "this one". A manager may add a room in their own site and
 * nowhere else.
 */
export async function requireBuildingConfig(
  ctx: QueryCtx | MutationCtx,
  buildingId: Id<'buildings'>,
): Promise<Doc<'users'>> {
  const user = await requireCapability(ctx, 'building-config')
  assertBuildingAccess(user, buildingId)
  return user
}
