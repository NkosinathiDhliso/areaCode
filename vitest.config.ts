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
    /** Property tests with 200–500 async iterations need more than the default 5 s. */
    testTimeout: 60_000,
    include: ['**/*.test.ts', '**/*.test.tsx'],
    // `.claude/worktrees/**` are ephemeral git worktrees (full repo copies an
    // agent checks out per session). Without excluding them the suite runs once
    // per worktree — tripling test count and timing out. They are not source.
    exclude: ['node_modules', 'dist', '**/node_modules/**', '**/.claude/**'],
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
