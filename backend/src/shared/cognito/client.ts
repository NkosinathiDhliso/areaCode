import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AdminGetUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminSetUserPasswordCommand,
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

export async function signUpUser(
  role: AuthRole,
  phone: string,
  customAttributes?: Record<string, string>,
) {
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

  await cognitoClient.send(
    new AdminCreateUserCommand({
      UserPoolId: pool.userPoolId,
      Username: phone,
      UserAttributes: userAttributes,
      MessageAction: 'SUPPRESS', // We handle OTP ourselves via CUSTOM_AUTH
    }),
  )

  // Set a random password (required by Cognito but unused with CUSTOM_AUTH)
  const tempPassword = `Tmp${Date.now()}!${Math.random().toString(36).slice(2)}`
  await cognitoClient.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: pool.userPoolId,
      Username: phone,
      Password: tempPassword,
      Permanent: true,
    }),
  )
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

  return {
    session: result.Session ?? '',
    challengeName: result.ChallengeName,
  }
}

// ─── Respond to Auth Challenge (verify OTP) ─────────────────────────────────

export async function respondToAuthChallenge(
  role: AuthRole,
  phone: string,
  code: string,
  session: string,
) {
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

export async function updateUserAttributes(
  role: AuthRole,
  phone: string,
  attributes: Record<string, string>,
) {
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
