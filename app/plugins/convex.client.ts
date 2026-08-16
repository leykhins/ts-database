import { ConvexClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'

/**
 * Convex + Convex Auth for Vue.
 *
 * Convex ships first-party React and Svelte bindings but not Vue ones, so this
 * plugin talks to the framework-agnostic `ConvexClient` directly and reproduces
 * the token lifecycle that `@convex-dev/auth`'s React provider implements:
 * a short-lived JWT held in memory and mirrored to localStorage, plus a refresh
 * token exchanged for a new JWT whenever Convex asks for a fresh one.
 *
 * Storage keys and the `auth:signIn` / `auth:signOut` action contract are
 * deliberately identical to the React client's, so a session survives swapping
 * one for the other.
 */

const JWT_KEY = '__convexAuthJWT'
const REFRESH_KEY = '__convexAuthRefreshToken'

type Tokens = { token: string; refreshToken: string }

export default defineNuxtPlugin((nuxtApp) => {
  const url = useRuntimeConfig().public.convexUrl

  if (!url) {
    console.error(
      '[convex] NUXT_PUBLIC_CONVEX_URL is not set. Run `npx convex dev` and copy the deployment URL into .env.',
    )
  }

  const client = new ConvexClient(url || 'https://unconfigured.convex.cloud', {
    // Nothing to warn about on unload: every mutation here is a discrete,
    // re-runnable action, and the warning fires on ordinary navigation.
    unsavedChangesWarning: false,
  })

  // Namespace storage by deployment so two deployments on localhost don't
  // hand each other's tokens back and forth.
  const ns = url.replace(/[^a-zA-Z0-9]/g, '')
  const key = (k: string) => `${k}_${ns}`

  const read = (k: string): string | null => {
    try {
      return window.localStorage.getItem(key(k))
    } catch {
      return null
    }
  }
  const write = (k: string, value: string | null) => {
    try {
      if (value === null) window.localStorage.removeItem(key(k))
      else window.localStorage.setItem(key(k), value)
    } catch {
      /* private mode / storage disabled — session stays in memory only */
    }
  }

  let token: string | null = read(JWT_KEY)
  const isAuthenticated = ref(token !== null)
  const isLoading = ref(true)

  const setTokens = (tokens: Tokens | null) => {
    token = tokens?.token ?? null
    write(JWT_KEY, tokens?.token ?? null)
    write(REFRESH_KEY, tokens?.refreshToken ?? null)
    isAuthenticated.value = token !== null
  }

  /**
   * Exchange the refresh token for a new JWT. Called by Convex when the current
   * token is rejected or nearing expiry — never on a schedule of our own.
   */
  const refresh = async (): Promise<string | null> => {
    const refreshToken = read(REFRESH_KEY)
    if (refreshToken === null) {
      setTokens(null)
      return null
    }
    try {
      const result = (await client.action(api.auth.signIn as any, {
        refreshToken,
      })) as { tokens: Tokens | null }
      setTokens(result.tokens ?? null)
      return result.tokens?.token ?? null
    } catch {
      // A refresh token that no longer works means the session is over.
      setTokens(null)
      return null
    }
  }

  client.setAuth(
    async ({ forceRefreshToken }) => {
      if (forceRefreshToken) return await refresh()
      return token
    },
    (authed) => {
      isAuthenticated.value = authed
      isLoading.value = false
    },
  )

  // If we booted with no stored JWT there is nothing for Convex to validate,
  // so no `onChange` will fire and we resolve the loading state ourselves.
  if (token === null) isLoading.value = false

  const signIn = async (
    params: Record<string, unknown>,
    provider = 'password',
  ): Promise<void> => {
    const result = (await client.action(api.auth.signIn as any, {
      provider,
      params,
    })) as { tokens?: Tokens | null; redirect?: string }

    if (result.redirect) {
      window.location.href = result.redirect
      return
    }
    if (!result.tokens) {
      throw new Error('Sign-in did not return a session.')
    }
    setTokens(result.tokens)
    isLoading.value = false
  }

  const signOut = async (): Promise<void> => {
    try {
      await client.action(api.auth.signOut as any, {})
    } catch {
      // Already signed out server-side is a fine place to end up.
    }
    setTokens(null)
    isLoading.value = false
  }

  // Keep sibling tabs in step: signing out in one tab signs out in all of them.
  window.addEventListener('storage', (event) => {
    if (event.key !== key(JWT_KEY)) return
    token = event.newValue
    isAuthenticated.value = token !== null
  })

  nuxtApp.hook('app:beforeMount', () => {
    // Nothing to do — the client connects eagerly on construction.
  })

  return {
    provide: {
      convex: client,
      convexAuth: {
        isAuthenticated: readonly(isAuthenticated),
        isLoading: readonly(isLoading),
        signIn,
        signOut,
      },
    },
  }
})
