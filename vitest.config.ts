import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@area-code/shared': resolve(__dirname, 'packages/shared'),
    },
  },
  test: {
    globals: true,
    /** Cold Fastify `buildApp()` in integration suites can exceed 30s on some machines. */
    hookTimeout: 120_000,
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules', 'dist', '**/node_modules/**'],
    env: {
      AREA_CODE_ENV: 'dev',
      USERS_TABLE: 'area-code-dev-users',
      NODES_TABLE: 'area-code-dev-nodes',
      CHECKINS_TABLE: 'area-code-dev-checkins',
      REWARDS_TABLE: 'area-code-dev-rewards',
      BUSINESSES_TABLE: 'area-code-dev-businesses',
      APP_DATA_TABLE: 'area-code-dev-app-data',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/**/*.ts', 'backend/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/node_modules/**'],
    },
  },
})
