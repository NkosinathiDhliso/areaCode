/**
 * Mints a Cognito ID token for a seeded test user via ADMIN_USER_PASSWORD_AUTH.
 *
 * Used by API-driven specs (e.g. provisioning fixtures, security probes,
 * cross-portal real-time tests where logging in via UI for every browser
 * context would be wasteful).
 */

import { AdminInitiateAuthCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'

import { optional, required, TEST_ACCOUNTS, TEST_PASSWORD, type AccountKey } from './env.js'

const region = optional('AWS_REGION', 'us-east-1')
const client = new CognitoIdentityProviderClient({ region })

const POOL: Record<AccountKey, { pool: string; client: string }> = {
  consumerA: { pool: 'AREA_CODE_COGNITO_CONSUMER_USER_POOL_ID', client: 'AREA_CODE_COGNITO_CONSUMER_CLIENT_ID' },
  consumerB: { pool: 'AREA_CODE_COGNITO_CONSUMER_USER_POOL_ID', client: 'AREA_CODE_COGNITO_CONSUMER_CLIENT_ID' },
  businessOwner: { pool: 'AREA_CODE_COGNITO_BUSINESS_USER_POOL_ID', client: 'AREA_CODE_COGNITO_BUSINESS_CLIENT_ID' },
  staffMember: { pool: 'AREA_CODE_COGNITO_STAFF_USER_POOL_ID', client: 'AREA_CODE_COGNITO_STAFF_CLIENT_ID' },
  admin: { pool: 'AREA_CODE_COGNITO_ADMIN_USER_POOL_ID', client: 'AREA_CODE_COGNITO_ADMIN_CLIENT_ID' },
}

const cache = new Map<AccountKey, { token: string; expiresAt: number }>()

export async function getIdToken(account: AccountKey): Promise<string> {
  const cached = cache.get(account)
  // Refresh 60s before actual expiry to avoid mid-test timeouts.
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token

  const { pool, client: clientEnv } = POOL[account]
  const UserPoolId = required(pool)
  const ClientId = required(clientEnv)
  const username = TEST_ACCOUNTS[account].email

  const result = await client.send(
    new AdminInitiateAuthCommand({
      UserPoolId,
      ClientId,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: {
        USERNAME: username,
        PASSWORD: TEST_PASSWORD(),
      },
    }),
  )

  const idToken = result.AuthenticationResult?.IdToken
  const expiresIn = result.AuthenticationResult?.ExpiresIn ?? 3600
  if (!idToken) throw new Error(`Cognito did not return an ID token for ${account}`)

  cache.set(account, { token: idToken, expiresAt: Date.now() + expiresIn * 1000 })
  return idToken
}
