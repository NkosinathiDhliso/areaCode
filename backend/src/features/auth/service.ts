import { AppError } from '../../shared/errors/AppError.js'
import { redis } from '../../shared/redis/client.js'
import { userConsent, otpCooldown, otpHourlyCount, otpSession } from '../../shared/redis/keys.js'
import { isDbAvailable } from '../../shared/db/prisma.js'
import * as repo from './repository.js'
import * as cognito from '../../shared/cognito/client.js'

const DEV_MODE = !isDbAvailable

// ─── Consumer Auth ──────────────────────────────────────────────────────────

export async function consumerSignup(data: {
  phone: string; username: string; displayName: string; citySlug: string;
}) {
  if (DEV_MODE) {
    const userId = `dev-user-${Date.now()}`
    return { userId, message: 'OTP sent (dev mode)' }
  }

  const existing = await repo.findUserByPhone(data.phone)
  if (existing) throw AppError.conflict('Phone number already registered')

  const city = await repo.getCityBySlug(data.citySlug)
  if (!city) throw AppError.unprocessable('Invalid city')

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
    userId: user.id,
    citySlug: data.citySlug,
  })

  // Insert initial consent record
  const consentVersion = process.env['AREA_CODE_CONSENT_VERSION'] ?? 'v1.0'
  await repo.insertConsentRecord(user.id, consentVersion, false)

  // Initiate auth to send OTP
  const { session } = await cognito.initiateAuth('consumer', data.phone)
  await redis.set(otpSession(data.phone), session, 'EX', 300)

  return { userId: user.id, message: 'OTP sent' }
}

export async function consumerLogin(phone: string) {
  if (DEV_MODE) return

  const user = await repo.findUserByPhone(phone)
  if (!user) throw AppError.notFound('Account not found')
  await checkOtpRateLimit(phone)

  const { session } = await cognito.initiateAuth('consumer', phone)
  await redis.set(otpSession(phone), session, 'EX', 300)
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

  const session = await redis.get(otpSession(phone))
  if (!session) throw AppError.unauthorized('OTP expired or not requested')

  try {
    const tokens = await cognito.respondToAuthChallenge('consumer', phone, code, session)
    await redis.del(otpSession(phone))

    const user = await repo.findUserByPhone(phone)
    if (!user) throw AppError.unauthorized('Invalid credentials')

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: { id: user.id, username: user.username, displayName: user.displayName, tier: user.tier },
    }
  } catch (err) {
    if (err instanceof AppError) throw err
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
    businessId: business.id,
  })

  const { session } = await cognito.initiateAuth('business', data.phone)
  await redis.set(otpSession(data.phone), session, 'EX', 300)

  return { businessId: business.id, message: 'OTP sent' }
}

export async function businessLogin(phone: string) {
  if (DEV_MODE) return
  await checkOtpRateLimit(phone)

  const { session } = await cognito.initiateAuth('business', phone)
  await redis.set(otpSession(phone), session, 'EX', 300)
}

export async function businessVerifyOtp(phone: string, code: string) {
  if (DEV_MODE) {
    return {
      accessToken: `biz-access-${Date.now()}`,
      refreshToken: `biz-refresh-${Date.now()}`,
      businessId: `dev-biz-${Date.now()}`,
    }
  }

  const session = await redis.get(otpSession(phone))
  if (!session) throw AppError.unauthorized('OTP expired or not requested')

  try {
    const tokens = await cognito.respondToAuthChallenge('business', phone, code, session)
    await redis.del(otpSession(phone))

    // Look up businessId from Cognito custom attributes
    const cognitoUser = await cognito.getCognitoUser('business', phone)
    const businessId = cognitoUser?.attributes['custom:businessId'] ?? ''

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      businessId,
    }
  } catch (err) {
    if (err instanceof AppError) throw err
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
  await redis.set(otpSession(phone), session, 'EX', 300)
}

export async function staffVerifyOtp(phone: string, code: string) {
  if (DEV_MODE) {
    return {
      accessToken: `dev-staff-access-${Date.now()}`,
      refreshToken: `dev-staff-refresh-${Date.now()}`,
      staff: { id: `dev-staff-${Date.now()}`, name: 'Dev Staff', businessId: 'dev-biz-1' },
    }
  }

  const session = await redis.get(otpSession(phone))
  if (!session) throw AppError.unauthorized('OTP expired or not requested')

  try {
    const tokens = await cognito.respondToAuthChallenge('staff', phone, code, session)
    await redis.del(otpSession(phone))

    const staff = await repo.findStaffByPhone(phone)
    if (!staff) throw AppError.unauthorized('Invalid credentials')

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      staff: { id: staff.id, name: staff.name, businessId: staff.businessId },
    }
  } catch (err) {
    if (err instanceof AppError) throw err
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

export async function refreshToken(_refreshToken: string, _pool: string) {
  if (DEV_MODE) {
    return { accessToken: `refreshed-access-${Date.now()}` }
  }
  // In production: call Cognito AdminInitiateAuth with REFRESH_TOKEN_AUTH flow
  // For now, return a placeholder — full implementation requires storing which pool
  // the refresh token belongs to
  return {
    accessToken: `refreshed-access-${Date.now()}`,
  }
}

// ─── User Profile ───────────────────────────────────────────────────────────

export async function getUserProfile(cognitoSub: string) {
  if (DEV_MODE) {
    return { id: 'dev-user-1', username: 'dev_user', displayName: 'Dev User', phone: '+27000000000', tier: 'explorer', cityId: null, neighbourhoodId: null, totalCheckIns: 8, streakCount: 3, avatarUrl: null, cognitoSub, createdAt: new Date().toISOString() }
  }
  const user = await repo.getUserByCognitoSub(cognitoSub)
  if (!user) throw AppError.notFound('User not found')
  return user
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
  // Invalidate Redis cache
  await redis.del(userConsent(userId))
  return record
}

export async function getUserConsent(userId: string) {
  if (DEV_MODE) {
    return { analyticsOptIn: false }
  }
  // Check Redis cache first
  const cached = await redis.get(userConsent(userId))
  if (cached) return JSON.parse(cached) as { analyticsOptIn: boolean }

  // Fall back to DB
  const record = await repo.getLatestConsent(userId)
  if (!record) return { analyticsOptIn: false }

  const consent = {
    analyticsOptIn: record.analyticsOptIn,
  }
  await redis.set(userConsent(userId), JSON.stringify(consent), 'EX', 3600)
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
  const cooldownKey = otpCooldown(phone)
  const cooldown = await redis.get(cooldownKey)
  if (cooldown) {
    throw AppError.tooManyRequests('Please wait before requesting another OTP')
  }

  // 3/hour limit
  const hourlyKey = otpHourlyCount(phone)
  const count = await redis.incr(hourlyKey)
  if (count === 1) await redis.expire(hourlyKey, 3600)
  if (count > 3) {
    throw AppError.tooManyRequests('OTP rate limit exceeded. Try again later.')
  }

  // Set 60s cooldown
  await redis.set(cooldownKey, '1', 'EX', 60)
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
  if (!invite) throw AppError.notFound('Invite not found')
  if (invite.accepted) throw AppError.gone('Invite already accepted')
  if (invite.expiresAt < new Date()) throw AppError.gone('Invite expired')

  await repo.acceptStaffInvite(invite.id)

  // Create Cognito user for staff
  await cognito.signUpUser('staff', phone)
  const cognitoUser = await cognito.getCognitoUser('staff', phone)
  if (!cognitoUser) throw AppError.internal('Failed to create staff Cognito user')

  const staff = await repo.createStaffAccount({
    businessId: invite.businessId,
    name,
    phone,
    cognitoSub: cognitoUser.sub,
  })

  await cognito.updateUserAttributes('staff', phone, {
    staffId: staff.id,
    businessId: invite.businessId,
  })

  return staff
}
