/**
 * One clock for the whole app.
 *
 * A Convex query re-runs when its data changes, not when time passes, so
 * anything that measures lateness — a round that came due, a guest who has not
 * signed out — has to be handed the current time as an argument. Several
 * screens need that at once, and each one owning its own `setInterval` means
 * they tick at different moments and quietly disagree about what "now" is on
 * the same page.
 *
 * Shared module state rather than a `provide`: it is a clock, there is only one
 * of it, and it is the same clock on every route.
 */
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
let users = 0

export function useNow(everyMs = 60_000) {
  if (import.meta.client) {
    onMounted(() => {
      users++
      if (!timer) {
        now.value = Date.now()
        timer = setInterval(() => (now.value = Date.now()), everyMs)
      }
    })

    onScopeDispose(() => {
      users--
      if (users <= 0 && timer) {
        clearInterval(timer)
        timer = null
      }
    })
  }

  return now
}
