/**
 * Disables the Cognito test users after a run unless E2E_KEEP_USERS=1.
 *
 * We disable rather than delete so audit trails stay intact. To fully
 * delete, run an admin script outside CI.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { config as loadEnv } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
loadEnv({ path: path.join(__dirname, '..', '.env') })

import { disableUserIfExists } from './cognito.js'
import { TEST_ACCOUNTS, flag } from './env.js'

export default async function globalTeardown(): Promise<void> {
  if (flag('E2E_KEEP_USERS')) {
    console.log('[e2e] E2E_KEEP_USERS=1 — leaving test users enabled.')
    return
  }

  const hasPools =
    !!process.env.AREA_CODE_COGNITO_CONSUMER_USER_POOL_ID &&
    !!process.env.AREA_CODE_COGNITO_BUSINESS_USER_POOL_ID &&
    !!process.env.AREA_CODE_COGNITO_STAFF_USER_POOL_ID &&
    !!process.env.AREA_CODE_COGNITO_ADMIN_USER_POOL_ID
  if (!hasPools) return

  await Promise.allSettled([
    disableUserIfExists('consumer', TEST_ACCOUNTS.consumerA.email),
    disableUserIfExists('consumer', TEST_ACCOUNTS.consumerB.email),
    disableUserIfExists('business', TEST_ACCOUNTS.businessOwner.email),
    disableUserIfExists('staff', TEST_ACCOUNTS.staffMember.email),
    disableUserIfExists('admin', TEST_ACCOUNTS.admin.email),
  ])
}
