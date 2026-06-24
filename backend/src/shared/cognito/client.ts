/**
 * Cognito client wrapper.
 *
 * ⚠️  Some functions in this file (signUpUser, initiateAuth,
 * respondToAuthChallenge) wire the Cognito CUSTOM_AUTH challenge flow
 * used for phone-OTP authentication. Phone-OTP is permanently disabled
 * in prod (returns 410 Gone via the auth handler). These functions are
 * preserved only because dev-mode fixture tests still exercise them.
 *
 * Email/password auth (createEmailPasswordUser, passwordAuth) and
 * federated OAuth (Hosted UI) are the supported live paths.
 *
 * Read `.kiro/steering/no-sms-no-phone-auth.md` before extending or
 * removing anything in this file.
 */
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminSetUserPasswordCommand,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminUserGlobalSignOutCommand,
  ListUsersCommand,
  type AuthFlowType,
} from '@aws-sdk/client-cognito-identity-provider'

import type { AuthRole } from '../middleware/auth.js'

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
    throw new Error(`Cognito pool not configured for role: ${role}`)
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
    // Surface "already exists" to the caller instead of silently swallowing it.
    // The previous behaviour fell through to AdminSetUserPassword below, which
    // would RESET an existing user's password on a duplicate signup — an
    // account-takeover hazard. Callers decide how to handle a true duplicate
    // (409) vs. an orphan recovery (see recoverOrphanEmailUser).
    if ((err as { name?: string }).name === 'UsernameExistsException') {
      throw new UsernameTakenError(normalizedEmail)
    }
    throw err
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
  if (!user?.sub) throw new Error('Failed to create Cognito email user')
  return user
}

/**
 * Sentinel thrown by createEmailPasswordUser when the Cognito username (email)
 * already exists. Lets the service distinguish a real duplicate from an orphan.
 */
export class UsernameTakenError extends Error {
  constructor(public readonly email: string) {
    super('Cognito username already exists')
    this.name = 'UsernameTakenError'
  }
}

/**
 * Recover an orphaned Cognito email user — one that exists in Cognito but has
 * no backing DynamoDB row (left behind by a partially-failed signup). Sets the
 * permanent password the user just chose and returns the user. The caller MUST
 * have already confirmed (via the authoritative DynamoDB email lock) that no
 * real account owns this email, so this can never reset a live account.
 */
export async function recoverOrphanEmailUser(role: AuthRole, email: string, password: string) {
  const pool = getPool(role)
  const normalizedEmail = email.toLowerCase().trim()
  await cognitoClient.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: pool.userPoolId,
      Username: normalizedEmail,
      Password: password,
      Permanent: true,
    }),
  )
  const user = await getCognitoUser(role, normalizedEmail)
  if (!user?.sub) throw new Error('Failed to recover Cognito email user')
  return user
}

/**
 * Delete a Cognito user by their username (the normalized email for
 * email/password users). Used to roll back a half-created account when a
 * later step of signup fails, so the user gets a clean retry instead of an
 * orphaned Cognito user with no backing DynamoDB row. Best-effort: swallows
 * "user not found" so callers can call it unconditionally during cleanup.
 */
export async function deleteUserByUsername(role: AuthRole, username: string): Promise<void> {
  const pool = getPool(role)
  try {
    await cognitoClient.send(
      new AdminDeleteUserCommand({
        UserPoolId: pool.userPoolId,
        Username: username.toLowerCase().trim(),
      }),
    )
  } catch (err: unknown) {
    if ((err as { name?: string }).name !== 'UserNotFoundException') throw err
  }
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
    throw new Error('Cognito did not return a session for CUSTOM_AUTH challenge')
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
    throw new Error('Authentication failed')
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
    throw new Error('Authentication failed')
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
  if (!username) throw new Error('Cognito user not found for sub')

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
    throw new Error('Authentication failed')
  }

  return {
    accessToken: result.AuthenticationResult.AccessToken ?? '',
    refreshToken: result.AuthenticationResult.RefreshToken ?? '',
    idToken: result.AuthenticationResult.IdToken ?? '',
  }
}

// ─── Admin TOTP (software token) MFA ────────────────────────────────────────

export interface AdminAuthOutcome {
  /** Present when authentication is fully complete (no MFA, or DEV). */
  tokens?: { accessToken: string; refreshToken: string; idToken: string }
  /** 'SOFTWARE_TOKEN_MFA' (enrolled) or 'MFA_SETUP' (must enrol now). */
  challengeName?: 'SOFTWARE_TOKEN_MFA' | 'MFA_SETUP'
  /** Opaque Cognito session to carry into the challenge response. */
  session?: string
}

/**
 * Begin admin login. Returns either final tokens (MFA disabled / not required)
 * or a challenge the caller must satisfy. For MFA_SETUP we don't associate the
 * token here — the dedicated /mfa/associate-setup step does that with the
 * returned session.
 */
export async function adminBeginAuth(email: string, password: string): Promise<AdminAuthOutcome> {
  const pool = getPool('admin')
  const result = await cognitoClient.send(
    new AdminInitiateAuthCommand({
      UserPoolId: pool.userPoolId,
      ClientId: pool.clientId,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH' as AuthFlowType,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
  )

  if (result.AuthenticationResult) {
    return {
      tokens: {
        accessToken: result.AuthenticationResult.AccessToken ?? '',
        refreshToken: result.AuthenticationResult.RefreshToken ?? '',
        idToken: result.AuthenticationResult.IdToken ?? '',
      },
    }
  }

  const challenge = result.ChallengeName
  if (challenge === 'SOFTWARE_TOKEN_MFA' || challenge === 'MFA_SETUP') {
    return { challengeName: challenge, session: result.Session }
  }

  throw new Error(`Unsupported admin auth challenge: ${challenge ?? 'none'}`)
}

/**
 * Associate a new TOTP secret during the MFA_SETUP challenge. Returns the
 * base32 secret (for manual entry / QR) and a fresh session to carry into the
 * verify step.
 */
export async function adminAssociateSoftwareToken(session: string): Promise<{ secretCode: string; session: string }> {
  const result = await cognitoClient.send(new AssociateSoftwareTokenCommand({ Session: session }))
  if (!result.SecretCode || !result.Session) throw new Error('Failed to associate software token')
  return { secretCode: result.SecretCode, session: result.Session }
}

/**
 * Verify the first TOTP code during MFA setup. Returns a fresh session to carry
 * into the MFA_SETUP challenge response. Throws on a wrong/expired code.
 */
export async function adminVerifySoftwareToken(session: string, code: string): Promise<{ session: string }> {
  const result = await cognitoClient.send(
    new VerifySoftwareTokenCommand({ Session: session, UserCode: code, FriendlyDeviceName: 'Area Code Admin' }),
  )
  if (result.Status !== 'SUCCESS' || !result.Session) {
    throw new Error('TOTP verification failed')
  }
  return { session: result.Session }
}

/** Complete an MFA challenge (SOFTWARE_TOKEN_MFA or MFA_SETUP) and get tokens. */
export async function adminRespondToMfaChallenge(opts: {
  email: string
  session: string
  challengeName: 'SOFTWARE_TOKEN_MFA' | 'MFA_SETUP'
  code?: string
}): Promise<{ accessToken: string; refreshToken: string; idToken: string }> {
  const pool = getPool('admin')
  const challengeResponses: Record<string, string> =
    opts.challengeName === 'SOFTWARE_TOKEN_MFA'
      ? { USERNAME: opts.email, SOFTWARE_TOKEN_MFA_CODE: opts.code ?? '' }
      : { USERNAME: opts.email }

  const result = await cognitoClient.send(
    new AdminRespondToAuthChallengeCommand({
      UserPoolId: pool.userPoolId,
      ClientId: pool.clientId,
      ChallengeName: opts.challengeName,
      Session: opts.session,
      ChallengeResponses: challengeResponses,
    }),
  )

  if (!result.AuthenticationResult) throw new Error('MFA challenge did not return tokens')
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

// ─── Set User Password ──────────────────────────────────────────────────────

export async function adminSetUserPassword(role: AuthRole, username: string, password: string) {
  const pool = getPool(role)
  await cognitoClient.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: pool.userPoolId,
      Username: username,
      Password: password,
      Permanent: true,
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
