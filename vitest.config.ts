import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    /** Cold Fastify `buildApp()` in integration suites can exceed 30s on some machines. */
    hookTimeout: 120_000,
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules', 'dist', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/**/*.ts', 'backend/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/node_modules/**'],
    },
  },
})
