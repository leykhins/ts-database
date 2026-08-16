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

  return { selected, select }
}
