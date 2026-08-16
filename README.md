# TS Database

Operations dashboard for supportive & low-income housing — the tool building
supervisors and front-desk staff use to run buildings for seniors and people
living with mental-health conditions.

Built with **Nuxt 4**, **Convex**, and **shadcn-vue**, styled by the
[TS Database design system](https://claude.ai/design) (Claude Design project
`f084d878-7469-40c5-95ef-392016c0a92e`).

---

## Getting started

Node 20.19+ (the repo pins **24** in `.nvmrc`):

```bash
nvm use
```

```bash
npm install
```

Provision a Convex deployment (opens a browser to sign in the first time). This
also writes the deployment URL into `.env.local` and regenerates
`convex/_generated/`:

```bash
npx convex dev
```

Convex Auth needs signing keys on the deployment:

```bash
npx @convex-dev/auth
```

Load the fictional sample building (Dodson Rooms, 48 rooms, 42 residents):

```bash
npm run seed
```

Then, in a second terminal:

```bash
npm run dev
```

Open http://localhost:3000 and choose **"First account on a new deployment?
Create the administrator"**. That first account becomes the administrator; the
sign-up form disappears afterwards, and every later account is created from
**Admin → Staff** inside the app.

If an account predates this rule, or a deployment ends up with no
administrator, promote one from the CLI:

```bash
npx convex run users:promoteToAdmin '{"email":"name@housing.org"}'
```

### Environment

`NUXT_PUBLIC_CONVEX_URL` (or `CONVEX_URL`, which `npx convex dev` writes for
you) points the frontend at the deployment. See `.env.example`.

---

## How it is put together

### Data — `convex/`

| File | What lives there |
|---|---|
| `schema.ts` | Buildings, rooms, tenants, rent ledger, deposits, room checks, critical needs, work orders |
| `model.ts` | Shared rules: staff auth guard, balance maths, room-status precedence |
| `dashboard.ts` | The whole Home screen in one subscription |
| `tenants.ts` · `rents.ts` · `checks.ts` | Per-area queries and mutations |
| `deposits.ts` · `support.ts` · `needs.ts` · `maintenance.ts` · `reports.ts` | The remaining functional areas |
| `care.ts` | Care Console — wellness checks, the shift board, flagged residents |
| `settings.ts` | Per-site operating rules: meal sittings, laundry hours, supply limits |
| `services.ts` | Meals, laundry, harm-reduction supplies, the bike room, pets |
| `profile.ts` | The resident record: bio data, health, contacts, responder sheet |
| `shiftReports.ts` | Shift reports and incidents |
| `buildings.ts` · `rooms.ts` | Portfolio configuration — administrator only |
| `users.ts` | Staff directory, account creation, roles, role testing |
| `crons.ts` | Monthly rent posting |
| `auth.ts` | Convex Auth, email + password |
| `seed.ts` | Fictional development data |
| `permissions.test.ts` | The rules that are expensive to get wrong |

### Motion

The design system's rule is that hover changes colour and border and **never
position** — no card lift, no scale. Movement is therefore reserved for things
that genuinely arrive, leave or are working:

| | |
|---|---|
| Route change | fade + 4px rise, `--dur-base` / `--ease-out` |
| Dialogs, sheets, dropdowns | retimed from shadcn's defaults to the system's tokens |
| Skeletons | a neutral shimmer sweep — a pulse reads as broken, and a brand-tinted one makes an empty screen look full |
| Buttons mid-write | `<Button loading>` swaps the leading icon for a spinner, disables the control and sets `aria-busy` |
| Topbar | flat until the page scrolls under it, then it takes a hairline |
| Switcher chevrons | rotate on open |
| Progress bars and the Wellness Index ring | ease with `--ease-out` rather than Tailwind's default |

`tokens/base.css` collapses every animation under `prefers-reduced-motion`, so
all of the above degrades to nothing on its own.

### Faces

Relief and casual staff do not know residents by face, and asking for a room
number mid-task is how notes get filed against the wrong person. Every avatar in
the app is a button that opens the resident photo viewer (`useResidentPhoto` +
one dialog mounted in `app.vue`), and the lists that drive a shift — the roster,
the Care Console's checklist, flagged and critical panels, the wellness-check
dialog — carry the photo inline. `photoUrlsFor` in `model.ts` resolves a list's
photos in one pass.

Photos are uploaded from the resident record straight to Convex storage, so the
file never passes through a function.

### The responder sheet

`/tenants/<id>/print` is the page that gets handed to an attending paramedic or
officer. What it leaves out is the point of it: no rent, no ledger, no deposit,
no shift notes — `profile.sheet` is a separate query from the one the rest of
the record uses, and a test asserts none of those fields can reach it.

Two rules run through the resident record:

- **A blank is never a "no".** Every health question is yes / no / not
  recorded. "No DNR on file" and "nobody has ever asked" are different things
  to somebody deciding whether to start compressions, so the sheet prints the
  difference.
- **The SIN is not care information.** It is masked (`•••-•••-789`) for
  everyone, revealed only to roles that do benefits work, and left off the
  printed sheet unless whoever is printing explicitly asks for it — a sheet
  with a SIN on it left at a nursing station is an identity-theft risk.

---

Three rules the schema enforces deliberately:

- **Money is stored in cents, as integers.** Never dollars as floats.
- **The rent ledger and the deposit table are append-only.** They are the
  source of truth for what is owed and what is held.
- **`tenants.balanceCents` / `.depositHeldCents` mirror those tables, and are
  only ever written in the same transaction as the row they mirror** (see
  `model.ts` → `applyLedgerEntry`). The roster screens read the mirror instead
  of a building's entire ledger; because the two move together, they cannot
  disagree. `npx convex run tenants:backfillRollups` rebuilds them.

### Roles

Reading is open to all staff — someone covering a shift needs the whole
picture. Writing is not. `model.ts` → `CAPABILITIES` is the entire permission
model; change a line there and the server, the nav and the disabled buttons all
follow.

| | config | site-config | money | care | tenancy | checks | wellness |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Administrator** | ● | ● | ● | ● | ● | ● | ● |
| **Building Supervisor** | | ● | ● | ● | ● | ● | ● |
| **Front Desk** | | | ● | | ● | ● | ● |
| **Resident Support Worker** | | | | ● | | ● | ● |
| **Wellness Worker** | | | | ● | | ● | ● |
| **Home Support Worker** | | | | ● | | ● | ● |

- **config** — buildings, rooms, staff accounts
- **site-config** — how one building runs: meal sittings, laundry hours, supply limits
- **money** — rent payments, monthly charges, deposit movements
- **care** — support levels, critical needs
- **tenancy** — intake, room moves, exits, editing a resident's record
- **checks** — room and building check sign-off, work orders
- **wellness** — wellness checks and shift reports

The three care roles hold the same authority and differ in the duties they are
asked to complete on shift (`model.ts` → `DUTIES`): rounds and building tasks
for an RSW, personal care and medication for Home Support, care plans and
referrals for a Wellness Worker.

Every query and mutation calls `requireStaff` or `requireCapability`, so
authorisation is enforced on the server; the route middleware and the disabled
buttons only avoid showing staff a wall of refusals. Sign-up cannot set a role
and is refused once any account exists, so an administrator is the only way in.

### Testing as another role

An administrator can act as any role from the sidebar footer. The chosen role is
stored on their user document and honoured by **every permission check on the
server**, so it is a real test and not a preview: a refused write is refused for
the same reason a front-desk worker's would be. Only the administrator's real
role can clear it, so it is always possible to switch back.
`convex/permissions.test.ts` asserts exactly this.

### UI — `app/`

```
components/ui/     shadcn-vue primitives (owned, edited to match the design system)
components/ds/     design-system pieces shadcn has no equivalent for  → <Ds*>
components/app/    TS Database composition                            → <Ts*>
assets/css/tokens/ the design system, vendored verbatim — do not edit
assets/css/theme.css  the bridge from those tokens to Tailwind + shadcn names
```

`theme.css` is the single place shadcn's semantic names (`bg-background`,
`rounded-md`, `border-border`) are wired to TS Database tokens, so a stock
shadcn component comes out looking like TS Database without being edited. The
files under `tokens/` are copied from the Claude Design project and are
deliberately never modified, so they can be re-synced.

Icons are **Hugeicons** throughout. `app/utils/icons.ts` maps the design
system's semantic names (`shield-check`, `heart-pulse`) to glyphs;
`app/lib/icons.ts` re-exports them under Lucide's names so the generated shadcn
components need only a changed import path and stay re-generatable.

### Convex in Vue

Convex ships first-party React and Svelte bindings but not Vue ones.
`app/plugins/convex.client.ts` drives the framework-agnostic `ConvexClient`
directly and reproduces the token lifecycle `@convex-dev/auth`'s React provider
implements — same storage keys, same `auth:signIn` / `auth:signOut` contract.
`app/composables/useConvex.ts` exposes `useConvexQuery` (a live subscription),
`useConvexMutation`, `useConvexAction`, and `useConvexAuth`.

The app runs as a SPA (`ssr: false`): it is internal, auth-gated, and its data
layer is a live subscription, so a server render would only produce a shell that
is immediately replaced.

---

## Scope

Fully built and wired to Convex:

- **Home** — All Clear banner, live room grid, "Do next" queue, KPIs
- **Tenants** — roster with tabs and filters, and the resident profile
- **Rents** — rent roster, warnings, Receive Rent
- **Resident record** — full bio data with a photo, next of kin, health
  information, intake paperwork, and the notes logged about them on shift.
  Prints a **responder sheet** for police and paramedics attending the site
- **Services** — the food checklist (one per sitting), laundry booking, harm-
  reduction supplies, the bike room and the pet roster. Every rule — sitting
  times, laundry hours and slot length, daily supply caps — is per-site
  configuration a manager sets, not a constant
- **Care Console** — the shift home for care staff: three-shift wellness board,
  Wellness Index, a prioritised "do this next" queue, flagged residents, the
  role's duty list, critical watch and recent handovers
- **Shift Reports** — two-phase: log as the shift runs, then finalize to answer
  the whole-shift questions and submit. Reporter, site, date and shift period
  are derived, never typed. Two logs: **interactions** (what happened with a
  resident) and **events** (what happened to the building — fire alarms,
  floods, outages, services attending). A kind belongs to one log or the other
  and the server refuses a crossed entry, so nobody's name ends up on a burst
  pipe. An entry names any number of residents — none for a fire panel fault,
  two for an argument — through `shiftLogParticipants`, a join table rather
  than an array so "everything logged about this resident" stays indexed
- **Room Checks** — per-room and whole-building sign-off
- **Security Deposits** — held against required, shortfalls and refunds, with
  every movement recorded
- **Support Levels** — distribution and per-floor load, level changes with a
  mandatory reason and a kept history
- **Critical Needs** — open and resolved cases, with case managers
- **Maintenance** — work orders by priority and age, assignment, closing
- **Auxiliary Reports** — shift handover, occupancy, rent roll, birthdays; the
  page prints without the app chrome
- **Admin → Buildings** — add buildings, add rooms a floor at a time, take rooms
  out of service
- **Admin → Staff** — create accounts with a temporary password, set roles and
  home buildings, reset passwords, remove accounts

Rent is charged to every current tenancy on the 1st of the month by
`convex/crons.ts`. The Rents screen has the same action as a button, for the
first month of a new building; both refuse to charge a tenancy twice for the
same period.

---

## Commands

```bash
npm run dev          # Nuxt dev server
npm run dev:backend  # convex dev (run alongside)
npm run seed         # load the fictional sample data
npm run test         # convex-test + vitest (rules, permissions, money)
npm run build        # production build
npm run typecheck    # vue-tsc
```

Some packages ship install scripts (esbuild's platform binary, vue-demi's Vue 2/3
shim). npm 11 gates these; the ones this project needs are pre-approved in
`package.json` under `allowScripts`, so `npm install` is non-interactive.
