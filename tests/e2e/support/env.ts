/**
 * Centralised, fail-loud env helpers for the e2e suite.
 * Kept tiny so tests stay readable.
 */

export function required(name: string): string {
  const v = process.env[name]
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var: ${name}. See tests/e2e/.env.example`)
  }
  return v
}

export function optional(name: string, fallback: string): string {
  const v = process.env[name]
  return v && v.trim() !== '' ? v : fallback
}

export function flag(name: string): boolean {
  const v = process.env[name]
  return v === '1' || v?.toLowerCase() === 'true'
}

export const URLS = {
  api: () => required('E2E_API_URL'),
  consumer: () => required('E2E_CONSUMER_URL'),
  business: () => required('E2E_BUSINESS_URL'),
  staff: () => required('E2E_STAFF_URL'),
  admin: () => required('E2E_ADMIN_URL'),
}

export const TEST_PASSWORD = () => required('E2E_TEST_PASSWORD')

/**
 * Stable test account identifiers. Re-used across runs so we don't churn
 * Cognito users every test. Global setup creates them if missing.
 */
export const TEST_ACCOUNTS = {
  consumerA: {
    email: 'e2e-consumer-a@areacode.test',
    displayName: 'E2E Consumer A',
  },
  consumerB: {
    email: 'e2e-consumer-b@areacode.test',
    displayName: 'E2E Consumer B',
  },
  businessOwner: {
    email: 'e2e-business@areacode.test',
    displayName: 'E2E Business Owner',
  },
  staffMember: {
    email: 'e2e-staff@areacode.test',
    displayName: 'E2E Staff',
  },
  admin: {
    email: 'e2e-admin@areacode.test',
    displayName: 'E2E Admin',
  },
} as const

export type AccountKey = keyof typeof TEST_ACCOUNTS
