import type { Id } from '../../convex/_generated/dataModel'

const STORAGE_KEY = 'ts-database:building'
const CONFIRMED_KEY = 'ts-database:building-confirmed'
const RECENT_KEY = 'ts-database:building-recent'

/**
 * How many sites to remember having worked at.
 *
 * An organisation can run sixteen buildings and a casual worker can be on the
 * list for all of them, but nobody works sixteen sites in rotation — they work
 * three or four, with the occasional one-off. Five is enough to put the likely
 * answer in front of them without the "recent" list becoming a second copy of
 * the full one.
 */
const RECENT_LIMIT = 5

/**
 * How long a site choice stands before it is asked again.
 *
 * Twelve hours, not "today". A calendar day looks like the obvious answer and
 * is the wrong one: shifts here run 12–8, 8–4, 4–12, so an overnight worker who
 * signs on at 11:45 pm would be asked once before midnight and again five
 * minutes later at the start of "a new day". A window measured from the answer
 * has no boundary to land on — it covers a whole shift with slack for arriving
 * early and staying late, and it is always expired by the next day's work.
 */
const CONFIRMATION_MS = 12 * 60 * 60 * 1000

/**
 * The building the current shift is working in. Staff cover one building at a
 * time, so this is app-wide state rather than a per-screen filter, and it
 * survives a reload — coming back from a phone call shouldn't reset which
 * building you were in.
 *
 * It survives *too* well for casual staff, which is what `confirm` is for. A
 * relief worker at Dodson on Monday and Carrall on Tuesday has a remembered
 * selection that is silently wrong on Tuesday, and nothing about the wrong
 * answer looks wrong: every screen renders plausible data, the wellness checks
 * land on the other site's roster, and the building they are standing in shows
 * those checks as never done. The server cannot catch it either — they are
 * assigned to both, so there is nothing to refuse.
 */
export function useSelectedBuilding() {
  const selected = useState<Id<'buildings'> | null>('selected-building', () => {
    if (import.meta.client) {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored) return stored as Id<'buildings'>
    }
    return null
  })

  const confirmedAt = useState<number>('selected-building-confirmed', () => {
    if (import.meta.client) {
      const stored = Number(window.localStorage.getItem(CONFIRMED_KEY))
      if (Number.isFinite(stored)) return stored
    }
    return 0
  })

  /** Sites this person has actually worked, most recent first. */
  const recent = useState<Id<'buildings'>[]>('selected-building-recent', () => {
    if (import.meta.client) {
      try {
        const stored = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]')
        if (Array.isArray(stored)) return stored.slice(0, RECENT_LIMIT)
      } catch {
        // A corrupt entry is not worth failing a sign-in over.
      }
    }
    return []
  })

  function select(id: Id<'buildings'> | null) {
    selected.value = id
    if (import.meta.client) {
      if (id) window.localStorage.setItem(STORAGE_KEY, id)
      else window.localStorage.removeItem(STORAGE_KEY)
    }
  }

  /**
   * Choose a site *and* vouch for it — this is the answer to "where are you
   * working", not just a filter change.
   *
   * Kept separate from `select` on purpose. Switching site mid-shift from the
   * sidebar is also a deliberate answer and confirms too; what must never
   * confirm is `reconcile`, which picks a building on the worker's behalf when
   * the stored one has gone stale. A fallback the app chose is precisely the
   * case that needs a human to look at it.
   */
  function confirm(id: Id<'buildings'>) {
    select(id)
    confirmedAt.value = Date.now()
    recent.value = [id, ...recent.value.filter((x) => x !== id)].slice(0, RECENT_LIMIT)

    if (import.meta.client) {
      window.localStorage.setItem(CONFIRMED_KEY, String(confirmedAt.value))
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(recent.value))
    }
  }

  /** Whether the current choice is recent enough to still speak for the shift. */
  function isConfirmed(now = Date.now()): boolean {
    return selected.value !== null && now - confirmedAt.value < CONFIRMATION_MS
  }

  /**
   * Drop a remembered building that is no longer on offer.
   *
   * A stored id outlives the thing it points at — a building can be deleted, or
   * a worker's assignment revoked, while the id sits in `localStorage`. Left
   * alone it wedges the whole app: every screen asks for a building the server
   * will not return, and the shell shows "Loading…" forever. Treat it as stale
   * rather than as an error, and fall back to the first building available.
   *
   * Call with `null`/`undefined` while the list is still loading — that is not
   * evidence of anything and must not clear a good selection.
   */
  function reconcile(available: { _id: Id<'buildings'> }[] | null | undefined) {
    if (!available) return
    if (selected.value && available.some((b) => b._id === selected.value)) return
    select(available[0]?._id ?? null)
    // Deliberately not confirmed: see `confirm`.
    confirmedAt.value = 0
  }

  return { selected, select, reconcile, confirm, isConfirmed, confirmedAt, recent }
}
