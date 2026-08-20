import { api } from '../../convex/_generated/api'

/**
 * Guard for the Admin screens.
 *
 * The real enforcement is `requireAdmin` on every admin function in Convex —
 * this only keeps a non-admin from staring at a screen of permission errors.
 * `isReady` distinguishes "not an admin" from "we don't know yet", so the page
 * shows a loading state instead of flashing a refusal at an administrator.
 */
/**
 * Send someone away from a screen their current role may not see.
 *
 * `null` means "not known yet" and must not redirect — otherwise an
 * administrator gets bounced during the moment before `users.me` first
 * resolves.
 *
 * A `watch` on a boolean rather than a `watchEffect` over the whole document:
 * the effect form re-ran on every unrelated field of `me` and, more
 * importantly, its `navigateTo` was fire-and-forget, so a rejected navigation
 * disappeared silently. That is what left an administrator who switched to a
 * non-admin role sitting on `/admin/staff` while the page's own query started
 * refusing them — a screen that looks broken and gives no way to understand
 * why.
 */
function redirectWhenDisallowed(allowed: Ref<boolean | null>) {
  watch(
    allowed,
    async (value) => {
      if (value !== false) return
      try {
        await navigateTo('/', { replace: true })
      } catch {
        // A navigation cancelled by a newer one is fine; anything else will be
        // caught by the guard re-running on the next change.
      }
    },
    { immediate: true },
  )
}

export function useRequireAdmin() {
  const { data: me } = useConvexQuery(api.users.me)

  const isReady = computed(() => me.value !== undefined)
  const isAdmin = computed(() => me.value?.isAdmin === true)

  redirectWhenDisallowed(
    computed(() => (me.value === undefined ? null : me.value?.isAdmin === true)),
  )

  return { me, isAdmin, isReady }
}

/**
 * The same guard, for a screen gated on a capability rather than on being an
 * administrator — the Buildings screens, which a Building Manager reaches and
 * a coordinator does not.
 */
export function useRequireCapability(capability: Capability) {
  const { data: me } = useConvexQuery(api.users.me)

  const isReady = computed(() => me.value !== undefined)
  const allowed = computed(() => me.value?.capabilities?.includes(capability) === true)

  redirectWhenDisallowed(
    computed(() =>
      me.value === undefined ? null : me.value?.capabilities?.includes(capability) === true,
    ),
  )

  return { me, allowed, isReady }
}

/** Dollars typed into a form → integer cents. Returns null if unparseable. */
export function dollarsToCents(input: string): number | null {
  const parsed = Number.parseFloat(input.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed * 100)
}
