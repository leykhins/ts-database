/* ------------------------------------------------------------------------
   The shift clock.

   Split out of `model.ts` so the browser can import it. `model.ts` pulls in
   `@convex-dev/auth/server`, which cannot be bundled into the app; this file
   deliberately imports nothing, so the nav can name the live shift without a
   round trip and without the client and the server keeping two copies of the
   schedule that drift apart.

   Three eight-hour segments, back to back, so the day is covered around the
   clock and every wellness check belongs to exactly one segment. Callers pass
   their own clock (a Convex query must not read the wall clock) and their UTC
   offset, so "which shift is live" is answered in the building's local time
   rather than in UTC.
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
): { key: ShiftKey, shiftDate: string, hour: number } {
  const local = new Date(now - tzOffsetMinutes * 60_000)
  const hour = local.getUTCHours()
  const shift = SHIFTS.find((s) => hour >= s.from && hour < s.to) ?? SHIFTS[2]!
  return { key: shift.key, shiftDate: local.toISOString().slice(0, 10), hour }
}
