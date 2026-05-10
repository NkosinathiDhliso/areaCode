import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminSetUserPasswordCommand,
  AdminDisableUserCommand,
  AdminUserGlobalSignOutCommand,
  ListUsersCommand,
  type AuthFlowType,
} from '@aws-sdk/client-cognito-identity-provider'

import type { AuthRole } from '../middleware/auth.js'
import { AppError } from '../errors/AppError.js'

const region = process.env['AWS_REGION'] ?? 'us-east-1'
const cognitoClient = new CognitoIdentityProviderClient({ region })

interface PoolConfig {
  userPoolId: string
  clientId: string
}

const poolConfigs: Record<AuthRole, () => PoolConfig> = {
  consumer: () => ({
    userPoolId: process.env['AREA_CODE_COGNITO_CONSUMER_USER_POOL_ID'] ?? '',
    clientId: process.env['AREA_CODE_COGNITO_CONSUMER_CLIENT_ID'] ?? '',
  }),
  business: () => ({
    userPoolId: process.env['AREA_CODE_COGNITO_BUSINESS_USER_POOL_ID'] ?? '',
    clientId: process.env['AREA_CODE_COGNITO_BUSINESS_CLIENT_ID'] ?? '',
  }),
  staff: () => ({
    userPoolId: process.env['AREA_CODE_COGNITO_STAFF_USER_POOL_ID'] ?? '',
    clientId: process.env['AREA_CODE_COGNITO_STAFF_CLIENT_ID'] ?? '',
  }),
  admin: () => ({
    userPoolId: process.env['AREA_CODE_COGNITO_ADMIN_USER_POOL_ID'] ?? '',
    clientId: process.env['AREA_CODE_COGNITO_ADMIN_CLIENT_ID'] ?? '',
  }),
}

function getPool(role: AuthRole): PoolConfig {
  const config = poolConfigs[role]()
  if (!config.userPoolId || !config.clientId) {
    throw AppError.internal(`Cognito pool not configured for role: ${role}`)
  }
  return config
}

// ─── Sign Up ────────────────────────────────────────────────────────────────

export async function signUpUser(role: AuthRole, phone: string, customAttributes?: Record<string, string>) {
  const pool = getPool(role)
  const userAttributes = [
    { Name: 'phone_number', Value: phone },
    ...(customAttributes
      ? Object.entries(customAttributes).map(([k, v]) => ({
          Name: `custom:${k}`,
          Value: v,
        }))
      : []),
  ]

  try {
    await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: pool.userPoolId,
        Username: phone,
        UserAttributes: userAttributes,
        MessageAction: 'SUPPRESS', // We handle OTP ourselves via CUSTOM_AUTH
      }),
    )
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'UsernameExistsException') {
      // User already exists in Cognito — this is OK for retry-after-partial-signup
      return
    }
    throw err
  }

  // Set a random password (required by Cognito but unused with CUSTOM_AUTH)
  const tempPassword = `Tmp${Date.now()}!${crypto.randomUUID().replace(/-/g, '')}`
  await cognitoClient.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: pool.userPoolId,
      Username: phone,
      Password: tempPassword,
      Permanent: true,
    }),
  )
}

export async function createEmailPasswordUser(
  role: AuthRole,
  email: string,
  password: string,
  customAttributes?: Record<string, string>,
) {
  const pool = getPool(role)
  const normalizedEmail = email.toLowerCase().trim()
  const userAttributes = [
    { Name: 'email', Value: normalizedEmail },
    { Name: 'email_verified', Value: 'true' },
    ...(customAttributes
      ? Object.entries(customAttributes).map(([k, v]) => ({
          Name: k.startsWith('custom:') ? k : `custom:${k}`,
          Value: v,
        }))
      : []),
  ]

  try {
    await cognitoClient.send(
      new AdminCreateUserCommand({
        UserPoolId: pool.userPoolId,
        Username: normalizedEmail,
        UserAttributes: userAttributes,
        MessageAction: 'SUPPRESS',
      }),
    )
  } catch (err: unknown) {
    if ((err as { name?: string }).name !== 'UsernameExistsException') throw err
  }

  await cognitoClient.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: pool.userPoolId,
      Username: normalizedEmail,
      Password: password,
      Permanent: true,
    }),
  )

  const user = await getCognitoUser(role, normalizedEmail)
  if (!user?.sub) throw AppError.internal('Failed to create Cognito email user')
  return user
}

// ─── Initiate Auth (send OTP) ───────────────────────────────────────────────

export async function initiateAuth(role: AuthRole, phone: string) {
  const pool = getPool(role)

  const result = await cognitoClient.send(
    new AdminInitiateAuthCommand({
      UserPoolId: pool.userPoolId,
      ClientId: pool.clientId,
      AuthFlow: 'CUSTOM_AUTH' as AuthFlowType,
      AuthParameters: {
        USERNAME: phone,
      },
    }),
  )

  if (!result.Session) {
    throw AppError.internal('Cognito did not return a session for CUSTOM_AUTH challenge')
  }

  return {
    session: result.Session,
    challengeName: result.ChallengeName,
  }
}

// ─── Respond to Auth Challenge (verify OTP) ─────────────────────────────────

export async function respondToAuthChallenge(role: AuthRole, phone: string, code: string, session: string) {
  const pool = getPool(role)

  const result = await cognitoClient.send(
    new AdminRespondToAuthChallengeCommand({
      UserPoolId: pool.userPoolId,
      ClientId: pool.clientId,
      ChallengeName: 'CUSTOM_CHALLENGE',
      ChallengeResponses: {
        USERNAME: phone,
        ANSWER: code,
      },
      Session: session,
    }),
  )

  if (!result.AuthenticationResult) {
    throw AppError.unauthorized('Authentication failed')
  }

  return {
    accessToken: result.AuthenticationResult.AccessToken ?? '',
    refreshToken: result.AuthenticationResult.RefreshToken ?? '',
    idToken: result.AuthenticationResult.IdToken ?? '',
    expiresIn: result.AuthenticationResult.ExpiresIn ?? 3600,
  }
}

export async function passwordAuth(role: AuthRole, email: string, password: string) {
  const pool = getPool(role)

  const result = await cognitoClient.send(
    new AdminInitiateAuthCommand({
      UserPoolId: pool.userPoolId,
      ClientId: pool.clientId,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH' as AuthFlowType,
      AuthParameters: {
        USERNAME: email.toLowerCase().trim(),
        PASSWORD: password,
      },
    }),
  )

  if (!result.AuthenticationResult) {
    throw AppError.unauthorized('Authentication failed')
  }

  return {
    accessToken: result.AuthenticationResult.AccessToken ?? '',
    refreshToken: result.AuthenticationResult.RefreshToken ?? '',
    idToken: result.AuthenticationResult.IdToken ?? '',
  }
}

// ─── Get User ───────────────────────────────────────────────────────────────

export async function getCognitoUser(role: AuthRole, phone: string) {
  const pool = getPool(role)
  try {
    const result = await cognitoClient.send(
      new AdminGetUserCommand({
        UserPoolId: pool.userPoolId,
        Username: phone,
      }),
    )
    const attrs: Record<string, string> = {}
    for (const attr of result.UserAttributes ?? []) {
      if (attr.Name && attr.Value) attrs[attr.Name] = attr.Value
    }
    return { sub: attrs['sub'] ?? '', attributes: attrs, enabled: result.Enabled ?? true }
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'UserNotFoundException') return null
    throw err
  }
}

// ─── Update Custom Attributes ───────────────────────────────────────────────

export async function updateUserAttributes(role: AuthRole, phone: string, attributes: Record<string, string>) {
  const pool = getPool(role)
  await cognitoClient.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: pool.userPoolId,
      Username: phone,
      UserAttributes: Object.entries(attributes).map(([k, v]) => ({
        Name: k.startsWith('custom:') ? k : `custom:${k}`,
        Value: v,
      })),
    }),
  )
}

/** Federated users use pool Username different from phone lookup; resolve via `sub` attribute filter. */
async function listUserAttrsBySub(
  poolUserPoolId: string,
  cognitoSub: string,
): Promise<{ Username?: string; attrs: Record<string, string> } | null> {
  const listRes = await cognitoClient.send(
    new ListUsersCommand({
      UserPoolId: poolUserPoolId,
      Filter: `sub = "${cognitoSub}"`,
      Limit: 1,
    }),
  )
  const u = listRes.Users?.[0]
  if (!u?.Username) return null
  const attrs: Record<string, string> = {}
  for (const a of u.Attributes ?? []) {
    if (a.Name && a.Value) attrs[a.Name] = a.Value
  }
  return { Username: u.Username, attrs }
}

/** Attributes for a federated or native user looked up by `sub`. */
export async function getCognitoUserAttrsBySub(
  role: AuthRole,
  cognitoSub: string,
): Promise<Record<string, string> | null> {
  const pool = getPool(role)
  const row = await listUserAttrsBySub(pool.userPoolId, cognitoSub)
  return row?.attrs ?? null
}

/** Hosted UI access tokens sometimes omit `email`; read verified attribute from Cognito. */
export async function getVerifiedEmailBySub(role: AuthRole, cognitoSub: string): Promise<string | undefined> {
  const attrs = await getCognitoUserAttrsBySub(role, cognitoSub)
  const email = attrs?.['email']
  return typeof email === 'string' ? email.toLowerCase().trim() : undefined
}

/** @deprecated use getVerifiedEmailBySub('consumer', sub) */
export async function getConsumerVerifiedEmailBySub(cognitoSub: string): Promise<string | undefined> {
  return getVerifiedEmailBySub('consumer', cognitoSub)
}

export async function updateUserAttributesByCognitoSub(
  role: AuthRole,
  cognitoSub: string,
  attributes: Record<string, string>,
) {
  const pool = getPool(role)
  const row = await listUserAttrsBySub(pool.userPoolId, cognitoSub)
  const username = row?.Username
  if (!username) throw AppError.notFound('Cognito user not found for sub')

  await cognitoClient.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: pool.userPoolId,
      Username: username,
      UserAttributes: Object.entries(attributes).map(([k, v]) => ({
        Name: k.startsWith('custom:') ? k : `custom:${k}`,
        Value: v,
      })),
    }),
  )
}

// ─── Admin Login (email/password for admin pool) ────────────────────────────

export async function adminPasswordAuth(email: string, password: string) {
  const pool = getPool('admin')

  const result = await cognitoClient.send(
    new AdminInitiateAuthCommand({
      UserPoolId: pool.userPoolId,
      ClientId: pool.clientId,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH' as AuthFlowType,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    }),
  )

  if (!result.AuthenticationResult) {
    throw AppError.unauthorized('Authentication failed')
  }

  return {
    accessToken: result.AuthenticationResult.AccessToken ?? '',
    refreshToken: result.AuthenticationResult.RefreshToken ?? '',
    idToken: result.AuthenticationResult.IdToken ?? '',
  }
}

// ─── Admin IAM ────────────────────────────────────────────────────────────────

export async function listAdminUsers(): Promise<Array<{ sub: string; email: string; role: string; enabled: boolean }>> {
  const pool = getPool('admin')
  const result = await cognitoClient.send(new ListUsersCommand({ UserPoolId: pool.userPoolId, Limit: 60 }))
  return (result.Users ?? []).map((u) => {
    const attrs: Record<string, string> = {}
    for (const a of u.Attributes ?? []) {
      if (a.Name && a.Value !== undefined) attrs[a.Name] = a.Value
    }
    return {
      sub: attrs['sub'] ?? u.Username ?? '',
      email: attrs['email'] ?? '',
      role: attrs['custom:admin_role'] ?? 'support_agent',
      enabled: u.Enabled ?? false,
    }
  })
}

export async function createAdminUser(email: string, tempPassword: string, role: string): Promise<{ sub: string }> {
  const pool = getPool('admin')
  const result = await cognitoClient.send(
    new AdminCreateUserCommand({
      UserPoolId: pool.userPoolId,
      Username: email,
      TemporaryPassword: tempPassword,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'custom:admin_role', Value: role },
      ],
      MessageAction: 'SUPPRESS',
    }),
  )
  const sub = result.User?.Attributes?.find((a) => a.Name === 'sub')?.Value ?? ''

  // Immediately convert the temp password to a permanent password so the admin can sign in
  // without going through Cognito's NEW_PASSWORD_REQUIRED challenge flow.
  await cognitoClient.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: pool.userPoolId,
      Username: email,
      Password: tempPassword,
      Permanent: true,
    }),
  )

  return { sub }
}

export async function setAdminUserRole(cognitoSub: string, role: string): Promise<void> {
  const pool = getPool('admin')
  await cognitoClient.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: pool.userPoolId,
      Username: cognitoSub,
      UserAttributes: [{ Name: 'custom:admin_role', Value: role }],
    }),
  )
}

// ─── Disable User ───────────────────────────────────────────────────────────

export async function disableCognitoUser(role: AuthRole, cognitoSub: string) {
  const pool = getPool(role)
  await cognitoClient.send(
    new AdminDisableUserCommand({
      UserPoolId: pool.userPoolId,
      Username: cognitoSub,
    }),
  )
  // Also sign out all sessions
  try {
    await cognitoClient.send(
      new AdminUserGlobalSignOutCommand({
        UserPoolId: pool.userPoolId,
        Username: cognitoSub,
      }),
    )
  } catch {
    // Best effort — user may already be signed out
  }
}
