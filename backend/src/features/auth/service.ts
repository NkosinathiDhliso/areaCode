import { AppError } from '../../shared/errors/AppError.js'
import { kvGet, kvSet, kvDel, kvIncr } from '../../shared/kv/dynamodb-kv.js'
import * as repo from './repository.js'
import { createLoginSession } from './session-service.js'
import * as cognito from '../../shared/cognito/client.js'
import { reportOtpFeedback } from '../../shared/sms/feedback.js'

const DEV_MODE = process.env['AREA_CODE_ENV'] === 'dev' && !process.env['AREA_CODE_FORCE_LIVE']

export async function consumerSignup(data: {
  phone: string
  username: string
  displayName: string
  citySlug: string
  consentAnalytics?: boolean
}) {
  if (DEV_MODE) {
    const userId = `dev-user-${Date.now()}`
    return { userId, message: 'OTP sent (dev mode)' }
  }

  const existing = await repo.findUserByPhone(data.phone)
  if (existing) {
    // Account exists. Re-send OTP so user can complete verification
    await checkOtpRateLimit(data.phone)
    const { session } = await cognito.initiateAuth('consumer', data.phone)
    await kvSet(`otp:session:${data.phone}`, session, 300)
    return { userId: existing.userId, message: 'OTP sent', existingAccount: true }
  }

  const city = await repo.getCityBySlug(data.citySlug)
  if (!city) throw AppError.unprocessable('Invalid city')

  // Check username uniqueness
  const existingUsername = await repo.findUserByUsername(data.username)
  if (existingUsername) throw AppError.conflict('Username already taken')

  await checkOtpRateLimit(data.phone)

  // Create Cognito user
  await cognito.signUpUser('consumer', data.phone)

  // Get the Cognito sub
  const cognitoUser = await cognito.getCognitoUser('consumer', data.phone)
  if (!cognitoUser) throw AppError.internal('Failed to create Cognito user')

  const user = await repo.createUser({
    phone: data.phone,
    username: data.username,
    displayName: data.displayName,
    cityId: city.id,
    cognitoSub: cognitoUser.sub,
  })

  // Store userId as custom attribute in Cognito for JWT claims
  await cognito.updateUserAttributes('consumer', data.phone, {
    userId: user.userId,
    citySlug: data.citySlug,
  })

  // Insert initial consent record with analytics preference from signup
  const consentVersion = process.env['AREA_CODE_CONSENT_VERSION'] ?? 'v1.0'
  await repo.insertConsentRecord(user.userId, consentVersion, data.consentAnalytics ?? false)

  // Initiate auth to send OTP
  const { session } = await cognito.initiateAuth('consumer', data.phone)
  await kvSet(`otp:session:${data.phone}`, session, 300)

  return { userId: user.userId, message: 'OTP sent' }
}

export async function consumerLogin(phone: string) {
  if (DEV_MODE) return

  const user = await repo.findUserByPhone(phone)
  if (!user) {
    // Check if user exists in Cognito (partial signup)
    const cognitoUser = await cognito.getCognitoUser('consumer', phone).catch(() => null)
    if (!cognitoUser) throw AppError.notFound('Account not found')
    // User in Cognito but not DynamoDB, still allow login attempt
  }
  await checkOtpRateLimit(phone)

  const { session } = await cognito.initiateAuth('consumer', phone)
  await kvSet(`otp:session:${phone}`, session, 300)
}

function suggestedUsernameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? 'explorer'
  let slug = local.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24)
  if (slug.length < 3) slug = `go_${slug.padEnd(2, '0')}`.slice(0, 24)
  return slug
}

/** Called once after Hosted UI Google OAuth returns Cognito tokens. Ensures Dynamo user + Cognito custom:userId. */
export async function consumerOAuthSync(opts: {
  cognitoSub: string
  email?: string | undefined
  userAgent: string
}) {
  const { cognitoSub, email: rawEmail, userAgent } = opts

  if (DEV_MODE) {
    const userId = `dev-user-google-${Date.now()}`
    const session = await createLoginSession(userId, userAgent)
    return {
      userId,
      sessionId: session.sessionId,
      username: 'dev_google',
      displayName: 'Dev Google User',
    tier: 'explorer',
  }
}

  let user = await repo.getUserByCognitoSub(cognitoSub)

  if (!user) {
    let email = rawEmail?.toLowerCase().trim()
    if (!email) email = await cognito.getConsumerVerifiedEmailBySub(cognitoSub)
    if (!email) {
      throw AppError.unprocessable(
        'Your Google account has no email. Use another Google account or contact support.',
      )
    }

    const dupEmail = await repo.getUserByEmail(email)
    if (dupEmail && dupEmail.cognitoSub && dupEmail.cognitoSub !== cognitoSub) {
      throw AppError.conflict(
        'This email is already registered. Sign in with the method you used before.',
      )
    }

    const city = await repo.getCityBySlug('johannesburg')
    if (!city) throw AppError.internal('Default city missing')

    let username = suggestedUsernameFromEmail(email)
    let n = 0
    while (await repo.findUserByUsername(username)) {
      n += 1
      username = `${suggestedUsernameFromEmail(email).slice(0, 18)}_${n}`
    }

    const emailLocal = email.split('@')[0] ?? 'Friend'
    const displayName =
      emailLocal.length > 0 ? emailLocal.charAt(0).toUpperCase() + emailLocal.slice(1) : 'Explorer'

    user = await repo.createUser({
      email,
      username,
      displayName,
      cityId: city.id,
      cognitoSub,
    })

    const consentVersion = process.env['AREA_CODE_CONSENT_VERSION'] ?? 'v1.0'
    await repo.insertConsentRecord(user.userId, consentVersion, false)
  }

  await cognito.updateUserAttributesByCognitoSub('consumer', cognitoSub, {
    userId: user.userId,
    citySlug: 'johannesburg',
  })

  const session = await createLoginSession(user.userId, userAgent)

  return {
    userId: user.userId,
    sessionId: session.sessionId,
    username: user.username,
    displayName: user.displayName,
    tier: user.tier ?? 'explorer',
  }
}

export async function consumerVerifyOtp(phone: string, code: string, userAgent?: string) {
  if (DEV_MODE) {
    const userId = `dev-user-${Date.now()}`
    const session = await createLoginSession(userId, userAgent ?? '')
    return {
      accessToken: `dev-access-${userId}`,
      refreshToken: `dev-refresh-${userId}`,
      sessionId: session.sessionId,
      user: { id: userId, username: phone, displayName: 'Dev User', tier: 'explorer' },
    }
  }

  const otpSession = await kvGet(`otp:session:${phone}`)
  if (!otpSession) throw AppError.unauthorized('OTP expired or not requested')

  try {
    const tokens = await cognito.respondToAuthChallenge('consumer', phone, code, otpSession)
    await kvDel(`otp:session:${phone}`)

    // Report successful OTP verification for message feedback tracking
    await reportOtpFeedback(phone, 'consumer', 'RECEIVED')

    const user = await repo.findUserByPhone(phone)
    if (!user) throw AppError.unauthorized('Invalid credentials')

    // Create device session record
    const loginSession = await createLoginSession(user.userId, userAgent ?? '')

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      sessionId: loginSession.sessionId,
      user: { id: user.userId, username: user.username, displayName: user.displayName, tier: user.tier },
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    // Report failed OTP verification
    await reportOtpFeedback(phone, 'consumer', 'FAILED')
    throw AppError.unauthorized('Invalid or expired OTP')
  }
}

export async function businessSignup(data: {
  email: string
  phone: string
  businessName: string
  registrationNumber?: string
}) {
  if (DEV_MODE) {
    return { businessId: `dev-biz-${Date.now()}`, message: 'OTP sent (dev mode)' }
  }

  const existing = await repo.findBusinessByEmail(data.email)
  if (existing) throw AppError.conflict('Email already registered')

  await checkOtpRateLimit(data.phone)

  await cognito.signUpUser('business', data.phone)
  const cognitoUser = await cognito.getCognitoUser('business', data.phone)
  if (!cognitoUser) throw AppError.internal('Failed to create Cognito user')

  const business = await repo.createBusinessAccount({
    email: data.email,
    businessName: data.businessName,
    ...(data.registrationNumber ? { registrationNumber: data.registrationNumber } : {}),
    cognitoSub: cognitoUser.sub,
    phone: data.phone,
  })

  await cognito.updateUserAttributes('business', data.phone, {
    businessId: business.businessId,
  })

  const { session } = await cognito.initiateAuth('business', data.phone)
  await kvSet(`otp:session:${data.phone}`, session, 300)

  return { businessId: business.businessId, message: 'OTP sent' }
}

export async function businessLogin(phone: string) {
  if (DEV_MODE) return

  // Verify business account exists before sending OTP
  const business = await repo.findBusinessByPhone(phone)
  if (!business) {
    // Check Cognito as fallback (partial signup)
    const cognitoUser = await cognito.getCognitoUser('business', phone).catch(() => null)
    if (!cognitoUser) throw AppError.notFound('Business account not found')
  }

  await checkOtpRateLimit(phone)

  const { session } = await cognito.initiateAuth('business', phone)
  await kvSet(`otp:session:${phone}`, session, 300)
}

export async function businessVerifyOtp(phone: string, code: string, userAgent?: string) {
  if (DEV_MODE) {
    const bizId = `dev-biz-${Date.now()}`
    const session = await createLoginSession(bizId, userAgent ?? '')
    return {
      accessToken: `biz-access-${Date.now()}`,
      refreshToken: `biz-refresh-${Date.now()}`,
      sessionId: session.sessionId,
      businessId: bizId,
    }
  }

  const otpSession = await kvGet(`otp:session:${phone}`)
  if (!otpSession) throw AppError.unauthorized('OTP expired or not requested')

  try {
    const tokens = await cognito.respondToAuthChallenge('business', phone, code, otpSession)
    await kvDel(`otp:session:${phone}`)

    // Report successful OTP verification for message feedback tracking
    await reportOtpFeedback(phone, 'business', 'RECEIVED')

    // Look up businessId from Cognito custom attributes
    const cognitoUser = await cognito.getCognitoUser('business', phone)
    const businessId = cognitoUser?.attributes['custom:businessId']
    if (!businessId) throw AppError.internal('Business ID not found in user attributes')

    // Create device session record
    const loginSession = await createLoginSession(businessId, userAgent ?? '')

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      sessionId: loginSession.sessionId,
      businessId,
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    await reportOtpFeedback(phone, 'business', 'FAILED')
    throw AppError.unauthorized('Invalid or expired OTP')
  }
}

export async function staffLogin(phone: string) {
  if (DEV_MODE) return

  const staff = await repo.findStaffByPhone(phone)
  if (!staff)
    throw AppError.notFound(
      'No staff account found for this number. Ask your manager to send you an invite link first.',
    )
  if ((staff as unknown as Record<string, unknown>).isActive === false) {
    throw AppError.forbidden('This staff account has been deactivated. Contact your manager.')
  }
  await checkOtpRateLimit(phone)

  const { session } = await cognito.initiateAuth('staff', phone)
  await kvSet(`otp:session:${phone}`, session, 300)
}

export async function staffVerifyOtp(phone: string, code: string, userAgent?: string) {
  if (DEV_MODE) {
    const staffId = `dev-staff-${Date.now()}`
    const session = await createLoginSession(staffId, userAgent ?? '')
    return {
      accessToken: `dev-staff-access-${Date.now()}`,
      refreshToken: `dev-staff-refresh-${Date.now()}`,
      sessionId: session.sessionId,
      staff: { id: staffId, name: 'Dev Staff', businessId: 'dev-biz-1' },
    }
  }

  const otpSession = await kvGet(`otp:session:${phone}`)
  if (!otpSession) throw AppError.unauthorized('OTP expired or not requested')

  try {
    const tokens = await cognito.respondToAuthChallenge('staff', phone, code, otpSession)
    await kvDel(`otp:session:${phone}`)

    // Report successful OTP verification for message feedback tracking
    await reportOtpFeedback(phone, 'staff', 'RECEIVED')

    const staff = await repo.findStaffByPhone(phone)
    if (!staff) throw AppError.unauthorized('Invalid credentials')

    // Create device session record
    const loginSession = await createLoginSession(staff.staffId, userAgent ?? '')

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      sessionId: loginSession.sessionId,
      staff: { id: staff.staffId, name: staff.name, businessId: staff.businessId },
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    await reportOtpFeedback(phone, 'staff', 'FAILED')
    throw AppError.unauthorized('Invalid or expired OTP')
  }
}

export async function adminLogin(email: string, password: string) {
  if (DEV_MODE) {
    return {
      accessToken: `dev-admin-access-${Date.now()}`,
      refreshToken: `dev-admin-refresh-${Date.now()}`,
      adminId: 'dev-admin-1',
      role: 'super_admin' as const,
    }
  }

  try {
    const tokens = await cognito.adminPasswordAuth(email, password)

    // Extract admin role from ID token claims
    const cognitoUser = await cognito.getCognitoUser('admin', email)
    const role = cognitoUser?.attributes['custom:admin_role'] ?? 'support_agent'
    const adminId = cognitoUser?.sub ?? ''

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      adminId,
      role,
    }
  } catch {
    throw AppError.unauthorized('Invalid credentials')
  }
}

export async function refreshToken(refreshTokenValue: string, pool: string) {
  if (DEV_MODE) {
    return { accessToken: `refreshed-access-${Date.now()}` }
  }

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

// Profile, consent, and account deletion in profile-service.ts
export {
  getUserProfile,
  completeOnboarding,
  updateProfile,
  getCheckInHistory,
  deleteCheckInHistory,
  updateConsent,
  getUserConsent,
  requestAccountDeletion,
} from './profile-service.js'

export async function getAccountType(phone: string): Promise<string> {
  if (DEV_MODE) return 'consumer'

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
  if (DEV_MODE) return
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

// Staff invite and token revocation in auth-utils-service.ts
export { acceptStaffInvite, revokeUserTokens } from './auth-utils-service.js'
// Session management in session-service.ts
export {
  createLoginSession,
  getUserSessions,
  revokeSession,
  revokeAllOtherSessions,
  deleteLoginSession,
} from './session-service.js'
