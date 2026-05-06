import * as cognito from '../../shared/cognito/client.js'
import { AppError } from '../../shared/errors/AppError.js'
import { kvGet, kvSet, kvIncr } from '../../shared/kv/dynamodb-kv.js'
import * as repo from './repository.js'

export function suggestedUsernameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? 'explorer'
  let slug = local
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 24)
  if (slug.length < 3) slug = `go_${slug.padEnd(2, '0')}`.slice(0, 24)
  return slug
}

export async function refreshToken(refreshTokenValue: string, pool: string) {
  const role = pool as 'consumer' | 'business' | 'staff' | 'admin'
  const poolConfig = {
    consumer: {
      userPoolId: process.env['AREA_CODE_COGNITO_CONSUMER_USER_POOL_ID'] ?? '',
      clientId: process.env['AREA_CODE_COGNITO_CONSUMER_CLIENT_ID'] ?? '',
    },
    business: {
      userPoolId: process.env['AREA_CODE_COGNITO_BUSINESS_USER_POOL_ID'] ?? '',
      clientId: process.env['AREA_CODE_COGNITO_BUSINESS_CLIENT_ID'] ?? '',
    },
    staff: {
      userPoolId: process.env['AREA_CODE_COGNITO_STAFF_USER_POOL_ID'] ?? '',
      clientId: process.env['AREA_CODE_COGNITO_STAFF_CLIENT_ID'] ?? '',
    },
    admin: {
      userPoolId: process.env['AREA_CODE_COGNITO_ADMIN_USER_POOL_ID'] ?? '',
      clientId: process.env['AREA_CODE_COGNITO_ADMIN_CLIENT_ID'] ?? '',
    },
  }[role]

  if (!poolConfig?.userPoolId) {
    throw AppError.badRequest('Invalid pool for refresh')
  }

  const { CognitoIdentityProviderClient, AdminInitiateAuthCommand } =
    await import('@aws-sdk/client-cognito-identity-provider')
  const client = new CognitoIdentityProviderClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' })

  const result = await client.send(
    new AdminInitiateAuthCommand({
      UserPoolId: poolConfig.userPoolId,
      ClientId: poolConfig.clientId,
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      AuthParameters: { REFRESH_TOKEN: refreshTokenValue },
    }),
  )

  if (!result.AuthenticationResult?.AccessToken) {
    throw AppError.unauthorized('Token refresh failed')
  }

  return {
    accessToken: result.AuthenticationResult.AccessToken,
  }
}

export async function getAccountType(phone: string): Promise<string> {
  const user = await repo.findUserByPhone(phone)
  if (user) return 'consumer'

  const staff = await repo.findStaffByPhone(phone)
  if (staff) return 'staff'

  // Check Cognito business pool
  const bizUser = await cognito.getCognitoUser('business', phone)
  if (bizUser) return 'business'

  return 'not_found'
}

export async function checkOtpRateLimit(phone: string) {
  // 60s resend cooldown
  const cooldown = await kvGet(`otp:cooldown:${phone}`)
  if (cooldown) {
    throw AppError.tooManyRequests('Please wait before requesting another OTP')
  }

  // 3/hour limit
  const count = await kvIncr(`otp:hourly:${phone}`, 3600)
  if (count > 3) {
    throw AppError.tooManyRequests('OTP rate limit exceeded. Try again later.')
  }

  // Set 60s cooldown
  await kvSet(`otp:cooldown:${phone}`, '1', 60)
}
