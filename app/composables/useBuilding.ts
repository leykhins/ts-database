import type { Id } from '../../convex/_generated/dataModel'

const STORAGE_KEY = 'ts-database:building'

/**
 * The building the current shift is working in. Staff cover one building at a
 * time, so this is app-wide state rather than a per-screen filter, and it
 * survives a reload — coming back from a phone call shouldn't reset which
 * building you were in.
 */
export function useSelectedBuilding() {
  const selected = useState<Id<'buildings'> | null>('selected-building', () => {
    if (import.meta.client) {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored) return stored as Id<'buildings'>
    }
    return null
  })

  function select(id: Id<'buildings'> | null) {
    selected.value = id
    if (import.meta.client) {
      if (id) window.localStorage.setItem(STORAGE_KEY, id)
      else window.localStorage.removeItem(STORAGE_KEY)
    }
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
  }

  return { selected, select, reconcile }
}
