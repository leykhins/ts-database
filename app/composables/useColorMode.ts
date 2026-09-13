type Mode = 'light' | 'dark'

const KEY = 'ts-database-color-mode'

/**
 * Light or dark, remembered.
 *
 * Follows the device on a first visit and a manual choice forever after — a
 * worker who turns the screen down for a night shift should not have it come
 * back bright because the operating system says it is 9am.
 *
 * The mode is written to `data-mode` on `<html>` rather than to a class,
 * matching how the token layer is keyed, and `color-scheme` on the same
 * element is what turns the browser's own furniture — scrollbars, form
 * controls, the space behind an overscroll — dark along with it.
 *
 * Shared module state: there is one screen and one mode. Reading the stored
 * value happens in `initialize()` rather than in the state initialiser because
 * this is an SSR-capable app shell; touching `localStorage` at module scope is
 * how a composable ends up throwing on the server.
 */
const mode = ref<Mode>('light')
let initialized = false

export function useColorMode() {
  function apply(next: Mode) {
    mode.value = next
    if (!import.meta.client) return
    document.documentElement.dataset.mode = next
  }

  function set(next: Mode) {
    apply(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // Private browsing, or storage disabled by policy. The mode still
      // applies for this session; it just will not be remembered.
    }
  }

  function initialize() {
    if (initialized || !import.meta.client) return
    initialized = true

    let stored: string | null = null
    try {
      stored = localStorage.getItem(KEY)
    } catch {
      stored = null
    }

    apply(
      stored === 'dark' || stored === 'light'
        ? stored
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light',
    )
  }

  return {
    mode: readonly(mode),
    isDark: computed(() => mode.value === 'dark'),
    initialize,
    set,
    toggle: () => set(mode.value === 'dark' ? 'light' : 'dark'),
  }
}
