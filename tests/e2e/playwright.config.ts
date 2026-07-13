import { defineConfig, devices } from '@playwright/test'
import { config as loadEnv } from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
loadEnv({ path: path.join(__dirname, '.env') })

const CONSUMER_URL = process.env.E2E_CONSUMER_URL ?? 'https://staging.areacode.co.za'
const BUSINESS_URL = process.env.E2E_BUSINESS_URL ?? 'https://business.staging.areacode.co.za'
const STAFF_URL = process.env.E2E_STAFF_URL ?? 'https://staff.staging.areacode.co.za'
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? 'https://admin.staging.areacode.co.za'

const isCI = !!process.env.CI

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: isCI ? [['github'], ['html', { open: 'never' }], ['list']] : [['html', { open: 'never' }], ['list']],
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    ignoreHTTPSErrors: true,
  },

  globalSetup: './support/global-setup.ts',
  globalTeardown: './support/global-teardown.ts',

  projects: [
    // ── Smoke (no auth, runs first to fail fast) ─────────────────────────
    {
      name: 'smoke',
      testMatch: /smoke\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },

    // ── Cross-cutting sweeps (no auth): a11y §9, perf §6, security §7 ────
    {
      name: 'cross-cutting',
      testMatch: /(accessibility|performance|security)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['smoke'],
    },

    // ── Consumer web ─────────────────────────────────────────────────────
    {
      name: 'consumer-desktop',
      testMatch: /consumer\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: CONSUMER_URL,
        // Johannesburg city centre — keeps geo-gated checks deterministic.
        geolocation: { latitude: -26.2041, longitude: 28.0473 },
        permissions: ['geolocation'],
        locale: 'en-ZA',
        timezoneId: 'Africa/Johannesburg',
      },
      dependencies: ['smoke'],
    },
    {
      name: 'consumer-mobile',
      testMatch: /consumer\/.*\.spec\.ts/,
      use: {
        ...devices['iPhone 13'],
        baseURL: CONSUMER_URL,
        geolocation: { latitude: -26.2041, longitude: 28.0473 },
        permissions: ['geolocation'],
        locale: 'en-ZA',
        timezoneId: 'Africa/Johannesburg',
      },
      dependencies: ['smoke'],
    },

    // ── Business portal ──────────────────────────────────────────────────
    {
      name: 'business',
      testMatch: /business\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: BUSINESS_URL,
        permissions: ['camera'],
      },
      dependencies: ['smoke'],
    },

    // ── Staff portal (camera permission for QR scanner) ──────────────────
    {
      name: 'staff',
      testMatch: /staff\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: STAFF_URL,
        permissions: ['camera'],
        // Inject a fake video stream so the QR scanner has something to scan.
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
      dependencies: ['smoke'],
    },

    // ── Admin portal ─────────────────────────────────────────────────────
    {
      name: 'admin',
      testMatch: /admin\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: ADMIN_URL,
      },
      dependencies: ['smoke'],
    },

    // ── Mobile sweep (responsiveness — UAT §8) ──────────────────────────
    {
      name: 'mobile-sweep',
      testMatch: /mobile-sweep\.spec\.ts/,
      use: {
        ...devices['iPhone SE (3rd gen)'],
      },
      dependencies: ['smoke'],
    },

    // ── Cross-portal real-time tests ─────────────────────────────────────
    {
      name: 'cross-portal',
      testMatch: /cross-portal\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        // Each test opens its own contexts pointing at multiple portals.
      },
      dependencies: ['consumer-desktop', 'business', 'staff', 'admin'],
    },
  ],
})
