/**
 * Every route except the sign-in page requires a staff session.
 *
 * The Convex token lives in localStorage, so this only runs client-side; the
 * app is a SPA and there is no server render to protect. The real enforcement
 * is in Convex — every query and mutation calls `requireStaff` — this middleware
 * just avoids showing a shell that would immediately error.
 */
export default defineNuxtRouteMiddleware((to) => {
  if (import.meta.server) return

  const { isAuthenticated, isLoading } = useConvexAuth()

  if (to.path === '/login') {
    if (isAuthenticated.value) return navigateTo('/')
    return
  }

  // Still resolving a stored token — let the layout show its loading state
  // rather than bouncing the user to /login and back.
  if (isLoading.value && isAuthenticated.value) return

  if (!isAuthenticated.value) {
    return navigateTo({ path: '/login', query: to.fullPath === '/' ? {} : { next: to.fullPath } })
  }
})
