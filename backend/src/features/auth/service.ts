import { AppError } from '../../shared/errors/AppError.js'
import { kvGet, kvSet, kvDel, kvIncr, kvTtl } from '../../shared/kv/dynamodb-kv.js'
import * as repo from './repository.js'
import * as cognito from '../../shared/cognito/client.js'
import { reportOtpFeedback } from '../../shared/sms/feedback.js'

const DEV_MODE = process.env['AREA_CODE_ENV'] === 'dev' && !process.env['AREA_CODE_FORCE_LIVE']

// ─── Consumer Auth ──────────────────────────────────────────────────────────

export async function consumerSignup(data: {
  phone: string; username: string; displayName: string; citySlug: string;
  consentAnalytics?: boolean;
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

export async function consumerVerifyOtp(phone: string, code: string) {
  if (DEV_MODE) {
    const userId = `dev-user-${Date.now()}`
    return {
      accessToken: `dev-access-${userId}`,
      refreshToken: `dev-refresh-${userId}`,
      user: { id: userId, username: phone, displayName: 'Dev User', tier: 'explorer' },
    }
  }

  const session = await kvGet(`otp:session:${phone}`)
  if (!session) throw AppError.unauthorized('OTP expired or not requested')

  try {
    const tokens = await cognito.respondToAuthChallenge('consumer', phone, code, session)
    await kvDel(`otp:session:${phone}`)

    // Report successful OTP verification for message feedback tracking
    await reportOtpFeedback(phone, 'consumer', 'RECEIVED')

    const user = await repo.findUserByPhone(phone)
    if (!user) throw AppError.unauthorized('Invalid credentials')

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: { id: user.userId, username: user.username, displayName: user.displayName, tier: user.tier },
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    // Report failed OTP verification
    await reportOtpFeedback(phone, 'consumer', 'FAILED')
    throw AppError.unauthorized('Invalid or expired OTP')
  }
}

// ─── Business Auth ──────────────────────────────────────────────────────────

export async function businessSignup(data: {
  email: string; phone: string; businessName: string; registrationNumber?: string;
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

export async function businessVerifyOtp(phone: string, code: string) {
  if (DEV_MODE) {
    return {
      accessToken: `biz-access-${Date.now()}`,
      refreshToken: `biz-refresh-${Date.now()}`,
      businessId: `dev-biz-${Date.now()}`,
    }
  }

  const session = await kvGet(`otp:session:${phone}`)
  if (!session) throw AppError.unauthorized('OTP expired or not requested')

  try {
    const tokens = await cognito.respondToAuthChallenge('business', phone, code, session)
    await kvDel(`otp:session:${phone}`)

    // Report successful OTP verification for message feedback tracking
    await reportOtpFeedback(phone, 'business', 'RECEIVED')

    // Look up businessId from Cognito custom attributes
    const cognitoUser = await cognito.getCognitoUser('business', phone)
    const businessId = cognitoUser?.attributes['custom:businessId']
    if (!businessId) throw AppError.internal('Business ID not found in user attributes')

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      businessId,
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    await reportOtpFeedback(phone, 'business', 'FAILED')
    throw AppError.unauthorized('Invalid or expired OTP')
  }
}

// ─── Staff Auth ─────────────────────────────────────────────────────────────

export async function staffLogin(phone: string) {
  if (DEV_MODE) return

  const staff = await repo.findStaffByPhone(phone)
  if (!staff) throw AppError.notFound('Staff account not found')
  await checkOtpRateLimit(phone)

  const { session } = await cognito.initiateAuth('staff', phone)
  await kvSet(`otp:session:${phone}`, session, 300)
}

export async function staffVerifyOtp(phone: string, code: string) {
  if (DEV_MODE) {
    return {
      accessToken: `dev-staff-access-${Date.now()}`,
      refreshToken: `dev-staff-refresh-${Date.now()}`,
      staff: { id: `dev-staff-${Date.now()}`, name: 'Dev Staff', businessId: 'dev-biz-1' },
    }
  }

  const session = await kvGet(`otp:session:${phone}`)
  if (!session) throw AppError.unauthorized('OTP expired or not requested')

  try {
    const tokens = await cognito.respondToAuthChallenge('staff', phone, code, session)
    await kvDel(`otp:session:${phone}`)

    // Report successful OTP verification for message feedback tracking
    await reportOtpFeedback(phone, 'staff', 'RECEIVED')

    const staff = await repo.findStaffByPhone(phone)
    if (!staff) throw AppError.unauthorized('Invalid credentials')

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      staff: { id: staff.staffId, name: staff.name, businessId: staff.businessId },
    }
  } catch (err) {
    if (err instanceof AppError) throw err
    await reportOtpFeedback(phone, 'staff', 'FAILED')
    throw AppError.unauthorized('Invalid or expired OTP')
  }
}

// ─── Admin Auth ─────────────────────────────────────────────────────────────

export async function adminLogin(email: string, password: string) {
  if (DEV_MODE) {
    return {
      accessToken: `dev-admin-access-${Date.now()}`,
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
      adminId,
      role,
    }
  } catch {
    throw AppError.unauthorized('Invalid credentials')
  }
}

// ─── Token Refresh ──────────────────────────────────────────────────────────

export async function refreshToken(refreshTokenValue: string, pool: string) {
  if (DEV_MODE) {
    return { accessToken: `refreshed-access-${Date.now()}` }
  }

  const role = pool as 'consumer' | 'business' | 'staff'
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
  }[role]

  if (!poolConfig?.userPoolId) {
    throw AppError.badRequest('Invalid pool for refresh')
  }

  const { CognitoIdentityProviderClient, AdminInitiateAuthCommand } = await import('@aws-sdk/client-cognito-identity-provider')
  const client = new CognitoIdentityProviderClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' })

  const result = await client.send(new AdminInitiateAuthCommand({
    UserPoolId: poolConfig.userPoolId,
    ClientId: poolConfig.clientId,
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    AuthParameters: { REFRESH_TOKEN: refreshTokenValue },
  }))

  if (!result.AuthenticationResult?.AccessToken) {
    throw AppError.unauthorized('Token refresh failed')
  }

  return {
    accessToken: result.AuthenticationResult.AccessToken,
  }
}

// ─── User Profile ───────────────────────────────────────────────────────────

export async function getUserProfile(cognitoSub: string) {
  if (DEV_MODE) {
    return { id: 'dev-user-1', username: 'dev_user', displayName: 'Dev User', phone: '+27000000000', tier: 'explorer', cityId: null, neighbourhoodId: null, totalCheckIns: 8, streakCount: 3, avatarUrl: null, cognitoSub, createdAt: new Date().toISOString(), onboardingComplete: false }
  }
  const user = await repo.getUserByCognitoSub(cognitoSub)
  if (!user) throw AppError.notFound('User not found')
  return user
}

export async function completeOnboarding(userId: string) {
  if (DEV_MODE) return { success: true }
  return repo.updateUserProfile(userId, { onboardingComplete: true } as any)
}

export async function updateProfile(
  userId: string,
  data: { displayName?: string; avatarUrl?: string | null; citySlug?: string },
) {
  if (DEV_MODE) {
    return { id: userId, ...data }
  }
  const updateData: Record<string, unknown> = {}

  if (data.displayName !== undefined) updateData['displayName'] = data.displayName
  if (data.avatarUrl !== undefined) updateData['avatarUrl'] = data.avatarUrl

  if (data.citySlug) {
    const city = await repo.getCityBySlug(data.citySlug)
    if (!city) throw AppError.unprocessable('City not found')
    updateData['cityId'] = city.id
  }

  return repo.updateUserProfile(userId, updateData as { displayName?: string; avatarUrl?: string | null; cityId?: string })
}

export async function getCheckInHistory(
  userId: string,
  cursor: string | undefined,
  limit: number,
) {
  if (DEV_MODE) {
    return {
      items: [
        { id: 'ci-1', nodeId: 'dev-1', checkedInAt: new Date(Date.now() - 3600000).toISOString(), node: { name: 'Father Coffee', slug: 'father-coffee', category: 'coffee' } },
        { id: 'ci-2', nodeId: 'dev-3', checkedInAt: new Date(Date.now() - 86400000).toISOString(), node: { name: "Kitchener's Bar", slug: 'kitcheners-bar', category: 'nightlife' } },
      ],
      nextCursor: null,
      hasMore: false,
    }
  }
  return repo.getUserCheckInHistory(userId, cursor, limit)
}

export async function deleteCheckInHistory(userId: string) {
  if (DEV_MODE) return
  return repo.softDeleteCheckInHistory(userId)
}

// ─── Consent ────────────────────────────────────────────────────────────────

export async function updateConsent(
  userId: string,
  consentVersion: string,
  analyticsOptIn: boolean,
) {
  if (DEV_MODE) {
    return { id: `consent-${Date.now()}`, userId, consentVersion, analyticsOptIn, consentedAt: new Date().toISOString() }
  }
  const record = await repo.insertConsentRecord(
    userId, consentVersion, analyticsOptIn,
  )
  // Invalidate cache
  await kvDel(`user:consent:${userId}`)
  return record
}

export async function getUserConsent(userId: string) {
  if (DEV_MODE) {
    return { analyticsOptIn: false }
  }
  // Check cache first
  const cached = await kvGet(`user:consent:${userId}`)
  if (cached) return JSON.parse(cached) as { analyticsOptIn: boolean }

  // Fall back to DB
  const record = await repo.getLatestConsent(userId)
  if (!record) return { analyticsOptIn: false }

  const consent = {
    analyticsOptIn: record.analyticsOptIn,
  }
  await kvSet(`user:consent:${userId}`, JSON.stringify(consent), 3600)
  return consent
}

// ─── Account Type Lookup ────────────────────────────────────────────────────

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

// ─── OTP Rate Limiting ──────────────────────────────────────────────────────

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

// ─── Account Deletion (POPIA) ────────────────────────────────────────────────

export async function requestAccountDeletion(userId: string) {
  if (DEV_MODE) {
    return { success: true, message: 'Erasure request queued (dev mode)' }
  }
  const hasExisting = await repo.hasActiveErasureRequest(userId)
  if (hasExisting) {
    throw AppError.conflict('Erasure request already pending')
  }
  await repo.createErasureRequest(userId)
  return { success: true, message: 'Your data will be erased within 30 days per POPIA requirements.' }
}

// ─── Staff Invite ───────────────────────────────────────────────────────────

export async function acceptStaffInvite(token: string, name: string, phone: string) {
  if (DEV_MODE) {
    return { id: `dev-staff-${Date.now()}`, businessId: 'dev-biz-1', name, phone, cognitoSub: `staff-${Date.now()}`, isActive: true, createdAt: new Date().toISOString() }
  }
  const invite = await repo.findStaffInviteByToken(token)
  if (!invite) throw AppError.notFound('Invite not found or expired')
  if (invite.accepted) throw AppError.gone('Invite already accepted')
  if (invite.expiresAt && new Date(invite.expiresAt as string) < new Date()) throw AppError.gone('Invite expired')

  // Validate phone matches invited phone if one was specified
  const invitedPhone = invite.invitedPhone as string | null
  if (invitedPhone && invitedPhone !== phone) {
    throw AppError.badRequest('Phone number does not match the invited number')
  }

  // Re-check tier limits at acceptance time (business may have downgraded)
  const businessId = invite.businessId as string
  const { countStaffForBusiness, findBusinessById } = await import('../business/repository.js')
  const biz = await findBusinessById(businessId)
  if (biz) {
    const STAFF_LIMITS: Record<string, number | null> = { free: 2, starter: 2, growth: 5, pro: null, payg: 2 }
    const limit = STAFF_LIMITS[biz.tier ?? 'free']
    if (limit !== null && limit !== undefined) {
      const count = await countStaffForBusiness(businessId)
      if (count >= limit) {
        throw AppError.forbidden(`Staff limit reached for ${biz.tier} tier (max ${limit})`)
      }
    }
  }

  // Mark invite as accepted using the token as key
  await repo.acceptStaffInvite(token)

  // Create Cognito user for staff
  await cognito.signUpUser('staff', phone)
  const cognitoUser = await cognito.getCognitoUser('staff', phone)
  if (!cognitoUser) throw AppError.internal('Failed to create staff Cognito user')

  const staff = await repo.createStaffAccount({
    businessId,
    name,
    phone,
    cognitoSub: cognitoUser.sub,
  })

  await cognito.updateUserAttributes('staff', phone, {
    staffId: staff.staffId,
    businessId,
  })

  return staff
}

// ─── Token Revocation ───────────────────────────────────────────────────────

export async function revokeUserTokens(role: string, cognitoSub: string) {
  if (DEV_MODE) return

  const { CognitoIdentityProviderClient, AdminUserGlobalSignOutCommand } = await import('@aws-sdk/client-cognito-identity-provider')
  const region = process.env['AWS_REGION'] ?? 'us-east-1'

  const poolIdMap: Record<string, string> = {
    consumer: process.env['AREA_CODE_COGNITO_CONSUMER_USER_POOL_ID'] ?? '',
    business: process.env['AREA_CODE_COGNITO_BUSINESS_USER_POOL_ID'] ?? '',
    staff: process.env['AREA_CODE_COGNITO_STAFF_USER_POOL_ID'] ?? '',
    admin: process.env['AREA_CODE_COGNITO_ADMIN_USER_POOL_ID'] ?? '',
  }

  const userPoolId = poolIdMap[role]
  if (!userPoolId) return

  const client = new CognitoIdentityProviderClient({ region })
  await client.send(new AdminUserGlobalSignOutCommand({
    UserPoolId: userPoolId,
    Username: cognitoSub,
  }))
}
