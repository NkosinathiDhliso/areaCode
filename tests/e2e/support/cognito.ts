/**
 * Cognito admin helpers used by global setup/teardown.
 *
 * We deliberately keep this independent of the backend package so the e2e
 * suite can be installed and run on its own (CI, contractors, etc.).
 */

import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminDisableUserCommand,
  AdminGetUserCommand,
  UserNotFoundException,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider'

import { required, optional } from './env.js'

export type Pool = 'consumer' | 'business' | 'staff' | 'admin'

const region = optional('AWS_REGION', 'us-east-1')
const client = new CognitoIdentityProviderClient({ region })

function poolId(pool: Pool): string {
  switch (pool) {
    case 'consumer':
      return required('AREA_CODE_COGNITO_CONSUMER_USER_POOL_ID')
    case 'business':
      return required('AREA_CODE_COGNITO_BUSINESS_USER_POOL_ID')
    case 'staff':
      return required('AREA_CODE_COGNITO_STAFF_USER_POOL_ID')
    case 'admin':
      return required('AREA_CODE_COGNITO_ADMIN_USER_POOL_ID')
  }
}

/** Idempotent: creates the user if missing, otherwise resets the password. */
export async function ensureUser(pool: Pool, email: string, password: string, displayName: string): Promise<void> {
  const UserPoolId = poolId(pool)
  const normalized = email.toLowerCase().trim()

  try {
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId,
        Username: normalized,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email', Value: normalized },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'custom:display_name', Value: displayName },
        ],
      }),
    )
  } catch (err: unknown) {
    if (!(err instanceof UsernameExistsException)) throw err
  }

  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId,
      Username: normalized,
      Password: password,
      Permanent: true,
    }),
  )
}

export async function disableUserIfExists(pool: Pool, email: string): Promise<void> {
  const UserPoolId = poolId(pool)
  const normalized = email.toLowerCase().trim()
  try {
    await client.send(new AdminDisableUserCommand({ UserPoolId, Username: normalized }))
  } catch (err: unknown) {
    if (!(err instanceof UserNotFoundException)) throw err
  }
}

export async function userExists(pool: Pool, email: string): Promise<boolean> {
  const UserPoolId = poolId(pool)
  const normalized = email.toLowerCase().trim()
  try {
    await client.send(new AdminGetUserCommand({ UserPoolId, Username: normalized }))
    return true
  } catch (err: unknown) {
    if (err instanceof UserNotFoundException) return false
    throw err
  }
}
