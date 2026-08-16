/**
 * Formatting helpers. Money arrives from Convex in cents and is only ever
 * turned into dollars here, at the edge, for display.
 */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** `$540.00` — always two decimals, always tabular in the UI. */
export function money(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100
  return (
    '$' +
    value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

/** `Jun 14, 2026` from a ms timestamp or an ISO `YYYY-MM-DD` string. */
export function formatDate(value: number | string | null | undefined): string {
  if (value == null) return '—'
  if (typeof value === 'string') {
    const [y, m, d] = value.split('-')
    if (!y || !m || !d) return value
    return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`
  }
  const date = new Date(value)
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
}

/** `Jun 14` — for dense ledger rows where the year is implied. */
export function formatShortDate(value: number | string | null | undefined): string {
  if (value == null) return '—'
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00`) : new Date(value)
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`
}

/** "3 days ago" / "today" — for how stale a check is. */
export function relativeDays(ts: number | null | undefined): string {
  if (ts == null) return 'never'
  const days = Math.floor((Date.now() - ts) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/** `510` → `8:30 am`. Minutes from midnight are the wire format for site hours. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null) return '—'
  const hour24 = Math.floor(minutes / 60) % 24
  const minute = minutes % 60
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${hour}:${String(minute).padStart(2, '0')} ${hour24 < 12 ? 'am' : 'pm'}`
}

/** `8:30 am` / `08:30` → minutes from midnight, or null if it is not a time. */
export function parseMinutes(text: string): number | null {
  const match = /^\s*(\d{1,2})[:.](\d{2})\s*(am|pm)?\s*$/i.exec(text)
  if (!match) return null

  let hour = Number(match[1])
  const minute = Number(match[2])
  if (minute > 59) return null

  const suffix = match[3]?.toLowerCase()
  if (suffix === 'pm' && hour < 12) hour += 12
  if (suffix === 'am' && hour === 12) hour = 0
  if (hour > 23) return null

  return hour * 60 + minute
}

/** Whole years between an ISO date and today. */
export function yearsSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const then = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(then.getTime())) return null
  const now = new Date()
  let years = now.getFullYear() - then.getFullYear()
  const beforeBirthday =
    now.getMonth() < then.getMonth() ||
    (now.getMonth() === then.getMonth() && now.getDate() < then.getDate())
  if (beforeBirthday) years--
  return years
}

const SUPPORT_LABEL: Record<string, string> = {
  independent: 'Independent',
  moderate: 'Moderate',
  high: 'High',
  critical: 'Critical',
}

export function supportLabel(level: string): string {
  return SUPPORT_LABEL[level] ?? level
}
