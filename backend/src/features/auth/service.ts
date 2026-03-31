import { AppError } from '../../shared/errors/AppError.js'
import { redis } from '../../shared/redis/client.js'
import { userConsent, otpCooldown, otpHourlyCount } from '../../shared/redis/keys.js'
import { isDbAvailable } from '../../shared/db/prisma.js'
import * as repo from './repository.js'

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

  // In production: create Cognito user, send OTP via SMS
  const cognitoSub = `consumer-${Date.now()}`
  const user = await repo.createUser({
    phone: data.phone,
    username: data.username,
    displayName: data.displayName,
    cityId: city.id,
    cognitoSub,
  })

  // Insert initial consent record
  const consentVersion = process.env['AREA_CODE_CONSENT_VERSION'] ?? 'v1.0'
  await repo.insertConsentRecord(user.id, consentVersion, false, true)

  return { userId: user.id, message: 'OTP sent' }
}

export async function consumerLogin(phone: string) {
  if (DEV_MODE) {
    // Skip DB/Redis checks in dev mode
    return
  }

  const user = await repo.findUserByPhone(phone)
  if (!user) throw AppError.notFound('Account not found')
  await checkOtpRateLimit(phone)
  // In production: initiate Cognito auth, send OTP
}

export async function consumerVerifyOtp(phone: string, _code: string) {
  if (DEV_MODE) {
    const userId = `dev-user-${Date.now()}`
    return {
      accessToken: `dev-access-${userId}`,
      refreshToken: `dev-refresh-${userId}`,
      user: { id: userId, username: phone, displayName: 'Dev User', tier: 'explorer' },
    }
  }

  const user = await repo.findUserByPhone(phone)
  if (!user) throw AppError.unauthorized('Invalid credentials')
  // In production: verify OTP with Cognito, return real tokens
  return {
    accessToken: `access-${user.id}-${Date.now()}`,
    refreshToken: `refresh-${user.id}-${Date.now()}`,
    user: { id: user.id, username: user.username, displayName: user.displayName, tier: user.tier },
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

  const cognitoSub = `business-${Date.now()}`
  const business = await repo.createBusinessAccount({
    email: data.email,
    businessName: data.businessName,
    registrationNumber: data.registrationNumber,
    cognitoSub,
  })

  return { businessId: business.id, message: 'OTP sent' }
}

export async function businessLogin(phone: string) {
  if (DEV_MODE) return
  await checkOtpRateLimit(phone)
  // In production: initiate Cognito auth for business pool
}

export async function businessVerifyOtp(phone: string, _code: string) {
  // In production: verify OTP with Cognito business pool
  return {
    accessToken: `biz-access-${Date.now()}`,
    refreshToken: `biz-refresh-${Date.now()}`,
  }
}

// ─── Staff Auth ─────────────────────────────────────────────────────────────

export async function staffLogin(phone: string) {
  if (DEV_MODE) return
  const staff = await repo.findStaffByPhone(phone)
  if (!staff) throw AppError.notFound('Staff account not found')
  await checkOtpRateLimit(phone)
  // In production: initiate Cognito auth for staff pool (8hr TTL)
}

export async function staffVerifyOtp(phone: string, _code: string) {
  if (DEV_MODE) {
    return {
      accessToken: `dev-staff-access-${Date.now()}`,
      refreshToken: `dev-staff-refresh-${Date.now()}`,
      staff: { id: `dev-staff-${Date.now()}`, name: 'Dev Staff', businessId: 'dev-biz-1' },
    }
  }
  const staff = await repo.findStaffByPhone(phone)
  if (!staff) throw AppError.unauthorized('Invalid credentials')
  return {
    accessToken: `staff-access-${staff.id}-${Date.now()}`,
    refreshToken: `staff-refresh-${staff.id}-${Date.now()}`,
    staff: { id: staff.id, name: staff.name, businessId: staff.businessId },
  }
}

// ─── Token Refresh ──────────────────────────────────────────────────────────

export async function refreshToken(_refreshToken: string, _pool: string) {
  // In production: call Cognito to refresh tokens
  return {
    accessToken: `refreshed-access-${Date.now()}`,
  }
}

// ─── User Profile ───────────────────────────────────────────────────────────

export async function getUserProfile(cognitoSub: string) {
  if (DEV_MODE) {
    return { id: 'dev-user-1', username: 'dev_user', displayName: 'Dev User', phone: '+27000000000', tier: 'explorer', cityId: null, neighbourhoodId: null, totalCheckIns: 8, avatarUrl: null, cognitoSub, createdAt: new Date().toISOString() }
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
  broadcastLocation: boolean,
) {
  if (DEV_MODE) {
    return { id: `consent-${Date.now()}`, userId, consentVersion, analyticsOptIn, broadcastLocation, consentedAt: new Date().toISOString() }
  }
  const record = await repo.insertConsentRecord(
    userId, consentVersion, analyticsOptIn, broadcastLocation,
  )
  // Invalidate Redis cache
  await redis.del(userConsent(userId))
  return record
}

export async function getUserConsent(userId: string) {
  if (DEV_MODE) {
    return { broadcastLocation: true, analyticsOptIn: false }
  }
  // Check Redis cache first
  const cached = await redis.get(userConsent(userId))
  if (cached) return JSON.parse(cached) as { broadcastLocation: boolean; analyticsOptIn: boolean }

  // Fall back to DB
  const record = await repo.getLatestConsent(userId)
  if (!record) return { broadcastLocation: true, analyticsOptIn: false }

  const consent = {
    broadcastLocation: record.broadcastLocation,
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

  // Business lookup would check Cognito in production
  return 'not_found'
}

// ─── OTP Rate Limiting ──────────────────────────────────────────────────────

export async function checkOtpRateLimit(phone: string) {
  if (DEV_MODE) return // Skip rate limiting in dev mode
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

  // In production, create Cognito user and get sub
  const cognitoSub = `staff-${Date.now()}`
  return repo.createStaffAccount({
    businessId: invite.businessId,
    name,
    phone,
    cognitoSub,
  })
}
