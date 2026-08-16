import { defineConfig } from 'vitest/config'

/**
 * Convex functions run in a V8 isolate, not Node, so the tests run in the
 * edge runtime to match. Only `convex/` is covered — the UI is verified in the
 * browser, the rules are verified here.
 */
export default defineConfig({
  test: {
    environment: 'edge-runtime',
    server: { deps: { inline: ['convex-test'] } },
    include: ['convex/**/*.test.ts'],
  },
})
