/**
 * The functional areas, and who each one is for.
 *
 * One list drives both the sidebar and the route guard. Keeping them apart is
 * how a screen ends up hidden from the nav but still reachable by typing the
 * URL — or worse, the reverse.
 *
 * `audience` is about whose job the screen is, not about permission. The server
 * settles permission; this decides whose sidebar is worth the space. A care
 * worker on shift has no use for the deposit ledger, and a manager doing
 * oversight never writes a shift report — showing each of them everything makes
 * the important thing harder to find.
 */
export type AreaAudience = 'everyone' | 'frontline' | 'oversight'

export interface Area {
  to: string
  icon: string
  label: string
  /** Match this path exactly rather than by prefix (`/care` vs `/care/reports`). */
  exact?: boolean
  audience: AreaAudience
  /** Key into the dashboard's `counts` for the sidebar badge. */
  badge?: 'tenants' | 'rentWarnings' | 'criticalNeeds'
}

export const AREAS: Area[] = [
  // Oversight starts at the building; a shift starts at the people.
  { to: '/', icon: 'layout-dashboard', label: 'Home', audience: 'oversight' },
  { to: '/care', icon: 'clipboard-check', label: 'Care Console', exact: true, audience: 'frontline' },

  // Written on shift, read by oversight — both need it.
  { to: '/care/reports', icon: 'file-text', label: 'Shift Reports', audience: 'everyone' },
  { to: '/services', icon: 'notes', label: 'Services', audience: 'everyone' },
  { to: '/visitors', icon: 'user-plus', label: 'Visitors', audience: 'everyone' },
  { to: '/tenants', icon: 'users', label: 'Tenants', audience: 'everyone', badge: 'tenants' },
  { to: '/checks', icon: 'shield-check', label: 'Room Checks', audience: 'everyone' },
  { to: '/support', icon: 'traffic-cone', label: 'Support Levels', audience: 'everyone' },
  { to: '/critical', icon: 'heart-pulse', label: 'Critical Needs', audience: 'everyone', badge: 'criticalNeeds' },
  { to: '/maintenance', icon: 'wrench', label: 'Maintenance', audience: 'everyone' },

  // The money and the returns. Nobody on a care shift is asked for these.
  { to: '/rents', icon: 'dollar-sign', label: 'Rents', audience: 'oversight', badge: 'rentWarnings' },
  { to: '/deposits', icon: 'lock', label: 'Security Deposits', audience: 'oversight' },
  { to: '/reports', icon: 'clipboard-list', label: 'Reports', audience: 'oversight' },
]

function wants(area: Area, isFrontline: boolean): boolean {
  if (area.audience === 'everyone') return true
  return area.audience === (isFrontline ? 'frontline' : 'oversight')
}

/** The sidebar, for this person. */
export function areasFor(isFrontline: boolean): Area[] {
  return AREAS.filter((area) => wants(area, isFrontline))
}

/** Where this person lands when they have no particular destination. */
export function homeFor(isFrontline: boolean): string {
  return isFrontline ? '/care' : '/'
}

/**
 * Whether a path belongs to this person's app.
 *
 * Unknown paths (`/admin/**`, a resident profile) return `true` — those carry
 * their own guards, and a list of areas is the wrong place to decide them.
 */
export function isAreaAllowed(path: string, isFrontline: boolean): boolean {
  const area = AREAS.filter((a) => (a.exact ? path === a.to : path === a.to || path.startsWith(`${a.to}/`)))
    // Longest match wins, so `/care/reports` is not judged as `/care`.
    .sort((a, b) => b.to.length - a.to.length)[0]
  if (!area) return true
  return wants(area, isFrontline)
}
