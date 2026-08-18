import { api } from '../../convex/_generated/api'

/**
 * Guard for the Admin screens.
 *
 * The real enforcement is `requireAdmin` on every admin function in Convex —
 * this only keeps a non-admin from staring at a screen of permission errors.
 * `isReady` distinguishes "not an admin" from "we don't know yet", so the page
 * shows a loading state instead of flashing a refusal at an administrator.
 */
export function useRequireAdmin() {
  const { data: me } = useConvexQuery(api.users.me)

  const isReady = computed(() => me.value !== undefined)
  const isAdmin = computed(() => me.value?.isAdmin === true)

  watchEffect(() => {
    if (me.value !== undefined && me.value !== null && !me.value.isAdmin) {
      navigateTo('/')
    }
  })

  return { me, isAdmin, isReady }
}

/**
 * The same guard, for a screen gated on a capability rather than on being an
 * administrator — the Buildings screens, which a Building Manager reaches and
 * a supervisor does not.
 */
export function useRequireCapability(capability: Capability) {
  const { data: me } = useConvexQuery(api.users.me)

  const isReady = computed(() => me.value !== undefined)
  const allowed = computed(() => me.value?.capabilities?.includes(capability) === true)

  watchEffect(() => {
    if (me.value !== undefined && me.value !== null && !allowed.value) {
      navigateTo('/')
    }
  })

  return { me, allowed, isReady }
}

/** Dollars typed into a form → integer cents. Returns null if unparseable. */
export function dollarsToCents(input: string): number | null {
  const parsed = Number.parseFloat(input.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round(parsed * 100)
}
