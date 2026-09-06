import { api } from '../../convex/_generated/api'

/**
 * The notification feed, shared by the bell and the full page.
 *
 * Both render the same rows and both mark the same keys read, so the query and
 * the vocabulary live here rather than being written twice and drifting — the
 * bell saying "3" while the page lists four is exactly the kind of small lie
 * that makes people stop trusting the badge.
 */

export type Severity = 'high' | 'med' | 'low'

export type NotificationKind =
  | 'routine'
  | 'need'
  | 'maintenance'
  | 'rent'
  | 'visitor'
  | 'check'
  | 'pet'

export const NOTIFICATION_KIND: Record<NotificationKind, { icon: string; label: string }> = {
  routine: { icon: 'clipboard-check', label: 'Rounds' },
  need: { icon: 'heart-pulse', label: 'Critical need' },
  maintenance: { icon: 'wrench', label: 'Maintenance' },
  rent: { icon: 'dollar-sign', label: 'Rent' },
  visitor: { icon: 'user-plus', label: 'Visitors' },
  check: { icon: 'shield-check', label: 'Room checks' },
  pet: { icon: 'heart', label: 'Pets' },
}

/** Severity reads as colour and nothing else — the words carry the meaning. */
export const NOTIFICATION_SEVERITY: Record<Severity, { color: string; tint: string; label: string }> = {
  high: { color: 'var(--red-600)', tint: 'var(--red-50)', label: 'Now' },
  med: { color: 'var(--amber-600)', tint: 'var(--amber-50)', label: 'Soon' },
  low: { color: 'var(--blue-600)', tint: 'var(--blue-50)', label: 'When you can' },
}

export function useNotifications() {
  const { selected } = useSelectedBuilding()
  const now = useNow()

  // Rounds are answered in slots on the building's clock, so the feed needs the
  // offset as well as the moment — "the 9pm round" has to mean 9pm there.
  const tz = new Date().getTimezoneOffset()

  const { data, isLoading } = useConvexQuery(api.notifications.feed, () => ({
    ...(selected.value ? { buildingId: selected.value } : {}),
    now: now.value,
    tzOffsetMinutes: tz,
  }))

  const { mutate } = useConvexMutation(api.notifications.markRead)

  const rows = computed(() => data.value?.rows ?? [])
  const unread = computed(() => data.value?.unread ?? 0)

  /**
   * Mark what is on screen as seen. The keys come from the client so a row that
   * arrived between the render and the click is not silently swallowed.
   */
  async function markRead(keys: string[]) {
    const unseen = keys.filter((key) => rows.value.find((r) => r.key === key && !r.read))
    if (unseen.length === 0) return
    await mutate({ keys: unseen })
  }

  return { data, rows, unread, isLoading, markRead }
}
