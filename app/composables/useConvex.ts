import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server'

/**
 * Subscribe to a Convex query. The returned refs update live as the underlying
 * data changes — no refetching, no cache invalidation.
 *
 * `args` may be a plain object or a getter. Return `null` from the getter to
 * hold the subscription (a detail page whose id hasn't resolved yet, say).
 */
export function useConvexQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  args?: FunctionArgs<Query> | (() => FunctionArgs<Query> | null),
  options: { requireAuth?: boolean } = {},
) {
  const { requireAuth = true } = options
  const { $convex, $convexAuth } = useNuxtApp()

  const data = shallowRef<FunctionReturnType<Query> | undefined>(undefined)
  const error = shallowRef<Error | null>(null)
  const isLoading = ref(true)

  let unsubscribe: (() => void) | undefined

  const resolveArgs = (): FunctionArgs<Query> | null =>
    typeof args === 'function'
      ? (args as () => FunctionArgs<Query> | null)()
      : ((args ?? {}) as FunctionArgs<Query>)

  const subscribe = () => {
    unsubscribe?.()
    unsubscribe = undefined

    // Every query in this app is staff-only; subscribing before the token is
    // attached just produces a "Not signed in" error the user would see flash.
    if (requireAuth && !$convexAuth.isAuthenticated.value) {
      isLoading.value = $convexAuth.isLoading.value
      return
    }

    const resolved = resolveArgs()
    if (resolved === null) {
      isLoading.value = true
      return
    }

    isLoading.value = data.value === undefined
    const subscription = $convex.onUpdate(
      query,
      resolved,
      (result) => {
        data.value = result
        error.value = null
        isLoading.value = false
      },
      (e) => {
        error.value = e
        isLoading.value = false
      },
    )
    unsubscribe = subscription
  }

  watch(
    () => [
      $convexAuth.isAuthenticated.value,
      $convexAuth.isLoading.value,
      JSON.stringify(resolveArgs()),
    ],
    subscribe,
    { immediate: true },
  )

  onScopeDispose(() => unsubscribe?.())

  return { data, error, isLoading }
}

/**
 * Run a Convex mutation, with `pending` / `error` state for the button that
 * triggered it.
 */
export function useConvexMutation<
  Mutation extends FunctionReference<'mutation'>,
>(mutation: Mutation) {
  const { $convex } = useNuxtApp()
  const pending = ref(false)
  const error = shallowRef<Error | null>(null)

  const mutate = async (
    args: FunctionArgs<Mutation>,
  ): Promise<FunctionReturnType<Mutation>> => {
    pending.value = true
    error.value = null
    try {
      return await $convex.mutation(mutation, args)
    } catch (e) {
      error.value = e as Error
      throw e
    } finally {
      pending.value = false
    }
  }

  return { mutate, pending, error }
}

/**
 * Run a Convex action. Same shape as `useConvexMutation` — actions are what
 * the account functions have to be, because credential hashing happens outside
 * the transaction.
 */
export function useConvexAction<Action extends FunctionReference<'action'>>(
  action: Action,
) {
  const { $convex } = useNuxtApp()
  const pending = ref(false)
  const error = shallowRef<Error | null>(null)

  const run = async (
    args: FunctionArgs<Action>,
  ): Promise<FunctionReturnType<Action>> => {
    pending.value = true
    error.value = null
    try {
      return await $convex.action(action, args)
    } catch (e) {
      error.value = e as Error
      throw e
    } finally {
      pending.value = false
    }
  }

  return { run, pending, error }
}

/** Sign-in state and actions for the current staff session. */
export function useConvexAuth() {
  return useNuxtApp().$convexAuth
}
