/**
 * Provisions the test users in each Cognito pool before any test runs.
 *
 * Idempotent. Safe to re-run. Skipped automatically when AWS credentials
 * are not configured (so contributors can still run @smoke locally).
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { config as loadEnv } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
loadEnv({ path: path.join(__dirname, '..', '.env') })

import { ensureUser } from './cognito.js'
import { TEST_ACCOUNTS, TEST_PASSWORD } from './env.js'

export default async function globalSetup(): Promise<void> {
  const hasAws = !!process.env.AWS_ACCESS_KEY_ID || !!process.env.AWS_PROFILE
  const hasPools =
    !!process.env.AREA_CODE_COGNITO_CONSUMER_USER_POOL_ID &&
    !!process.env.AREA_CODE_COGNITO_BUSINESS_USER_POOL_ID &&
    !!process.env.AREA_CODE_COGNITO_STAFF_USER_POOL_ID &&
    !!process.env.AREA_CODE_COGNITO_ADMIN_USER_POOL_ID

  if (!hasAws || !hasPools) {
    console.warn(
      '[e2e] Skipping Cognito seeding (missing AWS creds or pool IDs). ' + 'Only @smoke tests will run reliably.',
    )
    return
  }

  const pwd = TEST_PASSWORD()

  await Promise.all([
    ensureUser('consumer', TEST_ACCOUNTS.consumerA.email, pwd, TEST_ACCOUNTS.consumerA.displayName),
    ensureUser('consumer', TEST_ACCOUNTS.consumerB.email, pwd, TEST_ACCOUNTS.consumerB.displayName),
    ensureUser('business', TEST_ACCOUNTS.businessOwner.email, pwd, TEST_ACCOUNTS.businessOwner.displayName),
    ensureUser('staff', TEST_ACCOUNTS.staffMember.email, pwd, TEST_ACCOUNTS.staffMember.displayName),
    ensureUser('admin', TEST_ACCOUNTS.admin.email, pwd, TEST_ACCOUNTS.admin.displayName),
  ])

  console.log('[e2e] Cognito test users ready.')
}
