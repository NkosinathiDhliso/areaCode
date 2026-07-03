import * as cognito from '../../shared/cognito/client.js'
import { sendEmailVerificationEmail } from '../../shared/email/ses.js'
import { AppError } from '../../shared/errors/AppError.js'
import { kvGet, kvSet, kvDel, kvIncr } from '../../shared/kv/dynamodb-kv.js'
import { reportOtpFeedback } from '../../shared/sms/feedback.js'
import { findBusinessByCognitoSub } from '../business/repository.js'
import { updateBusiness } from './dynamodb-repository.js'

import * as repo from './repository.js'

import { LEGAL_CLAUSES_VERSION } from '@area-code/shared/constants/legal'

import { randomBytes } from 'node:crypto'

import { AWS_REGION, DEV_MODE } from '../../shared/config/env.js'
/**
 * Canonical consent version. Falls back to `LEGAL_CLAUSES_VERSION` from
 * the shared constants module if the env var isn't set, so a misconfigured
 * deploy still records consent under the version that matches the clauses
 * the user was actually shown.
 */
function currentConsentVersion(): string {
  return process.env['AREA_CODE_CONSENT_VERSION'] ?? LEGAL_CLAUSES_VERSION
}

/**
 * Redeem a guest-claim token (Churn-defences spec, Req 6) for a newly
 * signed-up consumer. Token-based — no PII at the till. Idempotent and
 * non-fatal: callers should swallow errors so signup never fails on
 * conversion bookkeeping.
 *
 * Returns true if a credit was applied, false otherwise.
 */
export async function redeemGuestToken(token: string, userId: string): Promise<boolean> {
  if (DEV_MODE) return false
  const { redeemTokenForUser, GuestClaimAbuseError } = await import('../rewards/guest-claim.js')
  try {
    await redeemTokenForUser(token, userId)
    const { documentClient, TableNames } = await import('../../shared/db/dynamodb.js')
    const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb')
    await documentClient.send(
      new UpdateCommand({
        TableName: TableNames.users,
        Key: { userId },
        UpdateExpression: 'SET totalCheckIns = if_not_exists(totalCheckIns, :zero) + :one',
        ExpressionAttributeValues: { ':zero': 0, ':one': 1 },
      }),
    )
    return true
  } catch (err) {
    if (err instanceof GuestClaimAbuseError) {
      // Token invalid / already used / expired — log and move on.
      console.warn(`[auth] guest-token redemption skipped: ${err.code}`)
      return false
    }
    throw err
  }
}

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
  const consentVersion = currentConsentVersion()
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
  let slug = local
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 24)
  if (slug.length < 3) slug = `go_${slug.padEnd(2, '0')}`.slice(0, 24)
  return slug
}

/** Called once after Hosted UI Google OAuth returns Cognito tokens. Ensures Dynamo user + Cognito custom:userId. */
export async function consumerOAuthSync(opts: { cognitoSub: string; email?: string | undefined; userAgent: string }) {
  const { cognitoSub, email: rawEmail, userAgent } = opts

  if (DEV_MODE) {
    const userId = `dev-user-google-${Date.now()}`
    return {
      userId,
      username: 'dev_google',
      displayName: 'Dev Google User',
      tier: 'explorer',
    }
  }

  let user = await repo.getUserByCognitoSub(cognitoSub)
  let isNewUser = false

  if (!user) {
    isNewUser = true
    let email = rawEmail?.toLowerCase().trim()
    if (!email) email = await cognito.getVerifiedEmailBySub('consumer', cognitoSub)
    if (!email) {
      throw AppError.unprocessable('Your Google account has no email. Use another Google account or contact support.')
    }

    const dupEmail = await repo.getUserByEmail(email)
    if (dupEmail) {
      if (dupEmail.cognitoSub && dupEmail.cognitoSub !== cognitoSub) {
        // The row points at a *different* Cognito sub for this email. Within the
        // live consumer pool an email maps to exactly one sub, so the mismatch
        // means the row still carries a sub from the decommissioned v1 pool: the
        // v1->v2 migration re-pooled auth but left user rows linked to old subs.
        // The email is Cognito-verified (we only reach here via a federated
        // sign-in token or a verified-email lookup), so the caller owns it.
        // Migrate the row onto the new sub rather than stranding the account.
        const relinked = await repo.relinkCognitoSub(dupEmail.userId, dupEmail.cognitoSub, cognitoSub)
        user = relinked ?? dupEmail
        isNewUser = false
      } else {
        // The existing row has no linked Cognito sub — it's an orphan left by a
        // partially-failed signup. Atomically adopt it (link the sub + claim the
        // sub lock) instead of creating a duplicate row, which would strand the
        // user's history/rewards on the old userId and read as "I lost my account".
        const adopted = await repo.linkCognitoSub(dupEmail.userId, cognitoSub)
        user = adopted ?? dupEmail
        isNewUser = false
      }
    } else {
      const city = await repo.getCityBySlug('johannesburg')
      if (!city) throw AppError.internal('Default city missing')

      let username = suggestedUsernameFromEmail(email)
      let n = 0
      while (await repo.findUserByUsername(username)) {
        n += 1
        username = `${suggestedUsernameFromEmail(email).slice(0, 18)}_${n}`
      }

      const emailLocal = email.split('@')[0] ?? 'Friend'
      const displayName = emailLocal.length > 0 ? emailLocal.charAt(0).toUpperCase() + emailLocal.slice(1) : 'Explorer'

      user = await repo.createUser({
        email,
        username,
        displayName,
        cityId: city.id,
        cognitoSub,
        emailVerified: true,
      })

      const consentVersion = currentConsentVersion()
      await repo.insertConsentRecord(user.userId, consentVersion, false)
    }
  }

  await cognito.updateUserAttributesByCognitoSub('consumer', cognitoSub, {
    userId: user.userId,
    citySlug: 'johannesburg',
  })

  return {
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    tier: user.tier ?? 'explorer',
    isNewUser,
  }
}

export async function consumerVerifyOtp(phone: string, code: string, userAgent?: string) {
  if (DEV_MODE) {
    const userId = `dev-user-${Date.now()}`
    return {
      accessToken: `dev-access-${userId}`,
      refreshToken: `dev-refresh-${userId}`,
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

    // Convert any open guest claims now that this phone is a real account.
    // (Churn-defences spec, Requirement 6.4) — non-fatal on failure.
    // NOTE: This call is dead code in prod (phone-OTP path is disabled).
    // Kept here for the dev fixture path only.

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

/**
 * Create the consumer's Cognito email/password user, or recover an orphan.
 *
 * `createEmailPasswordUser` throws `UsernameTakenError` when a Cognito user
 * already exists for this email. Callers invoke this only AFTER confirming no
 * DynamoDB account owns the email, so an existing Cognito user must be an
 * orphan from a previously-failed signup — safe to recover by setting the new
 * password. This never resets a live account's password.
 */
const EMAIL_VERIFY_TTL_SECONDS = 24 * 60 * 60

function webBaseUrl(): string {
  return process.env['AREA_CODE_WEB_URL'] ?? 'https://areacode.co.za'
}

/**
 * Issue a single-use, TTL-bound verification token and email the link.
 * Best-effort by design — signup and login must never fail because email
 * delivery hiccupped. Users who don't get the mail can trigger a resend from
 * the in-app banner.
 */
export async function sendConsumerEmailVerification(userId: string, email: string): Promise<void> {
  try {
    const token = randomBytes(24).toString('base64url')
    await kvSet(`email-verify:${token}`, userId, EMAIL_VERIFY_TTL_SECONDS)
    const url = `${webBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`
    await sendEmailVerificationEmail(email, url)
  } catch (err) {
    console.error('email verification send failed', { userId, error: (err as Error).message })
  }
}

/** Confirm an email from the verification link's token. */
export async function verifyConsumerEmail(token: string): Promise<{ verified: boolean }> {
  if (DEV_MODE) return { verified: true }
  const userId = await kvGet(`email-verify:${token}`)
  if (!userId) {
    throw AppError.badRequest('This verification link is invalid or has expired. Request a new one.')
  }
  await repo.updateUser(userId, { emailVerified: true })
  await kvDel(`email-verify:${token}`)
  return { verified: true }
}

/** Re-issue a verification email for the signed-in consumer. */
export async function resendConsumerEmailVerification(
  userId: string,
): Promise<{ sent: boolean; alreadyVerified?: boolean }> {
  if (DEV_MODE) return { sent: true }
  const user = await repo.getUserById(userId)
  if (!user) throw AppError.notFound('User not found')
  if (user.emailVerified) return { sent: false, alreadyVerified: true }
  if (!user.email) throw AppError.unprocessable('No email on file to verify.')
  await sendConsumerEmailVerification(userId, user.email)
  return { sent: true }
}

async function createOrRecoverConsumerCognitoUser(email: string, password: string) {
  try {
    return await cognito.createEmailPasswordUser('consumer', email, password)
  } catch (err) {
    if (err instanceof cognito.UsernameTakenError) {
      // Re-check the authoritative store. If a DynamoDB row now owns this email
      // (e.g. a concurrent signup won the race), this is a real duplicate, not
      // an orphan — refuse rather than reset a live account's password.
      const existing = await repo.getUserByEmail(email)
      if (existing) throw AppError.conflict('Email already registered')
      return cognito.recoverOrphanEmailUser('consumer', email, password)
    }
    throw err
  }
}

export async function consumerEmailSignup(data: {
  email: string
  password: string
  consentAnalytics?: boolean
  userAgent?: string
}) {
  if (DEV_MODE) {
    const userId = `dev-user-${Date.now()}`
    return {
      accessToken: `dev-access-${userId}`,
      refreshToken: `dev-refresh-${userId}`,
      user: { id: userId, username: 'dev_user', displayName: 'Dev User', tier: 'explorer' },
    }
  }

  const email = data.email.toLowerCase().trim()
  const existing = await repo.getUserByEmail(email)
  if (existing) throw AppError.conflict('Email already registered')

  const city = await repo.getCityBySlug('johannesburg')
  if (!city) throw AppError.internal('Default city missing')

  let username = suggestedUsernameFromEmail(email)
  let n = 0
  while (await repo.findUserByUsername(username)) {
    n += 1
    username = `${suggestedUsernameFromEmail(email).slice(0, 18)}_${n}`
  }

  const emailLocal = email.split('@')[0] ?? 'Friend'
  const displayName = emailLocal.length > 0 ? emailLocal.charAt(0).toUpperCase() + emailLocal.slice(1) : 'Explorer'

  const cognitoUser = await createOrRecoverConsumerCognitoUser(email, data.password)

  // Cognito user now exists. Everything after this point must either fully
  // succeed or be rolled back — otherwise we leave an orphaned Cognito user
  // (no DynamoDB row) or a DynamoDB row with no linked `custom:userId`, which
  // is the root cause of "I signed up but can't log in / lost my account".
  let user: Awaited<ReturnType<typeof repo.createUser>> | undefined
  try {
    user = await repo.createUser({
      email,
      username,
      displayName,
      cityId: city.id,
      cognitoSub: cognitoUser.sub,
      emailVerified: false,
    })

    await cognito.updateUserAttributes('consumer', email, {
      userId: user.userId,
      citySlug: 'johannesburg',
    })

    const consentVersion = currentConsentVersion()
    await repo.insertConsentRecord(user.userId, consentVersion, data.consentAnalytics ?? false)
  } catch (err) {
    // Compensating cleanup so the user can retry from a clean slate. Releasing
    // the DynamoDB row also releases its email/sub locks (see deleteUser).
    if (user?.userId) {
      await repo.deleteUser(user.userId).catch(() => undefined)
    }
    // If the failure was a 409 the email belongs to a different (concurrent)
    // signup that won the race — leave their Cognito user alone. Otherwise we
    // own the freshly-created Cognito user and must remove it.
    if (!(err instanceof AppError && err.statusCode === 409)) {
      await cognito.deleteUserByUsername('consumer', email).catch(() => undefined)
    }
    throw err
  }

  const tokens = await cognito.passwordAuth('consumer', email, data.password)

  // Fire off the (non-blocking) verification email. The account is already
  // usable; verification only unlocks gated actions like reward redemption.
  await sendConsumerEmailVerification(user.userId, email)

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    user: {
      id: user.userId,
      username: user.username,
      displayName: user.displayName,
      tier: user.tier,
      emailVerified: false,
    },
  }
}

export async function consumerEmailLogin(emailRaw: string, password: string, userAgent?: string) {
  if (DEV_MODE) {
    const userId = `dev-user-${Date.now()}`
    return {
      accessToken: `dev-access-${userId}`,
      refreshToken: `dev-refresh-${userId}`,
      user: { id: userId, username: 'dev_user', displayName: 'Dev User', tier: 'explorer' },
    }
  }

  const email = emailRaw.toLowerCase().trim()
  const tokens = await cognito.passwordAuth('consumer', email, password)
  const cognitoUser = await cognito.getCognitoUser('consumer', email)
  let userId = cognitoUser?.attributes['custom:userId']

  const user = userId ? await repo.getUserById(userId) : await repo.getUserByEmail(email)
  if (!user) throw AppError.unauthorized('User account is not linked.')

  userId = user.userId
  await cognito.updateUserAttributes('consumer', email, {
    userId,
    citySlug: 'johannesburg',
  })

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    user: {
      id: user.userId,
      username: user.username,
      displayName: user.displayName,
      tier: user.tier,
      emailVerified: user.emailVerified ?? false,
    },
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
    return {
      accessToken: `biz-access-${Date.now()}`,
      refreshToken: `biz-refresh-${Date.now()}`,
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

export async function businessEmailSignup(data: {
  email: string
  password: string
  businessName: string
  registrationNumber?: string
  userAgent?: string
}) {
  if (DEV_MODE) {
    const businessId = `dev-biz-${Date.now()}`
    return {
      accessToken: `dev-business-access-${Date.now()}`,
      refreshToken: `dev-business-refresh-${Date.now()}`,
      businessId,
    }
  }

  const email = data.email.toLowerCase().trim()
  const existing = await repo.findBusinessByEmail(email)
  if (existing) throw AppError.conflict('Email already registered')

  const cognitoUser = await cognito.createEmailPasswordUser('business', email, data.password)

  const business = await repo.createBusinessAccount({
    email,
    businessName: data.businessName.trim(),
    ...(data.registrationNumber ? { registrationNumber: data.registrationNumber.trim() } : {}),
    cognitoSub: cognitoUser.sub,
  })

  await cognito.updateUserAttributes('business', email, {
    businessId: business.businessId,
  })

  const tokens = await cognito.passwordAuth('business', email, data.password)

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    businessId: business.businessId,
  }
}

export async function businessEmailLogin(emailRaw: string, password: string, userAgent?: string) {
  if (DEV_MODE) {
    const businessId = `dev-biz-${Date.now()}`
    return {
      accessToken: `dev-business-access-${Date.now()}`,
      refreshToken: `dev-business-refresh-${Date.now()}`,
      businessId,
    }
  }

  const email = emailRaw.toLowerCase().trim()
  const tokens = await cognito.passwordAuth('business', email, password)
  const cognitoUser = await cognito.getCognitoUser('business', email)
  const businessId = cognitoUser?.attributes['custom:businessId']
  if (!businessId) throw AppError.unauthorized('Business account is not linked.')

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    businessId,
  }
}

export async function businessOAuthSync(opts: { cognitoSub: string; userAgent: string }) {
  if (DEV_MODE) {
    const bizId = `dev-biz-google-${Date.now()}`
    return { needsBusinessProfile: false, businessId: bizId }
  }

  const row = await findBusinessByCognitoSub(opts.cognitoSub)
  let businessId = row?.businessId as string | undefined

  // If not found by cognitoSub, try by email (handles email signup → Google OAuth)
  if (!businessId) {
    const email = await cognito.getVerifiedEmailBySub('business', opts.cognitoSub)
    if (email) {
      const byEmail = await repo.findBusinessByEmail(email)
      if (byEmail) {
        businessId = byEmail.id
        // Link the Cognito sub to the existing business
        await updateBusiness(businessId!, { cognitoSub: opts.cognitoSub } as any)
      }
    }
  }

  if (!businessId) {
    return { needsBusinessProfile: true as const }
  }

  await cognito.updateUserAttributesByCognitoSub('business', opts.cognitoSub, {
    businessId,
  })

  return {
    needsBusinessProfile: false as const,
    businessId,
  }
}

export async function businessOAuthCompleteProfile(opts: {
  cognitoSub: string
  email?: string | undefined
  userAgent: string
  businessName: string
  registrationNumber?: string
}) {
  if (DEV_MODE) {
    const bizId = `dev-biz-${Date.now()}`
    return { businessId: bizId }
  }

  const existingRow = await findBusinessByCognitoSub(opts.cognitoSub)
  if (existingRow?.businessId) {
    throw AppError.conflict('Business already linked to this Google account. Sign in again.')
  }

  let email = opts.email?.toLowerCase().trim()
  if (!email) email = await cognito.getVerifiedEmailBySub('business', opts.cognitoSub)
  if (!email) {
    throw AppError.unprocessable('Your Google account has no verified email. Use another account or contact support.')
  }

  const dup = await repo.findBusinessByEmail(email)
  if (dup) {
    throw AppError.conflict('An account with this email already exists. Sign in instead.')
  }

  const business = await repo.createBusinessAccount({
    email,
    businessName: opts.businessName.trim(),
    ...(opts.registrationNumber ? { registrationNumber: opts.registrationNumber.trim() } : {}),
    cognitoSub: opts.cognitoSub,
  })

  await cognito.updateUserAttributesByCognitoSub('business', opts.cognitoSub, {
    businessId: business.businessId,
  })

  return { businessId: business.businessId }
}

export async function staffOAuthSync(opts: { cognitoSub: string; userAgent: string }) {
  if (DEV_MODE) {
    const staffId = `dev-staff-google-${Date.now()}`
    return {
      staff: { id: staffId, name: 'Dev Staff', businessId: 'dev-biz-1' },
    }
  }

  const staff = await repo.findStaffByCognitoSub(opts.cognitoSub)
  if (!staff) {
    throw AppError.notFound('No staff profile for this Google account. Use your invite link or sign in with phone.')
  }
  if ((staff as unknown as Record<string, unknown>).isActive === false) {
    throw AppError.forbidden('This staff account has been deactivated. Contact your manager.')
  }

  await cognito.updateUserAttributesByCognitoSub('staff', opts.cognitoSub, {
    staffId: staff.staffId,
    businessId: staff.businessId,
  })

  return {
    staff: { id: staff.staffId, name: staff.name, businessId: staff.businessId },
  }
}

export async function staffEmailLogin(emailRaw: string, password: string, userAgent?: string) {
  if (DEV_MODE) {
    const staffId = `dev-staff-${Date.now()}`
    return {
      accessToken: `dev-staff-access-${Date.now()}`,
      refreshToken: `dev-staff-refresh-${Date.now()}`,
      staff: { id: staffId, name: 'Dev Staff', businessId: 'dev-biz-1' },
    }
  }

  const email = emailRaw.toLowerCase().trim()
  const tokens = await cognito.passwordAuth('staff', email, password)
  const cognitoUser = await cognito.getCognitoUser('staff', email)
  const staffId = cognitoUser?.attributes['custom:staffId']
  if (!staffId) throw AppError.unauthorized('Staff account is not linked.')

  const staff = await repo.getStaffById(staffId)
  if (!staff) throw AppError.unauthorized('Staff profile not found.')
  if ((staff as unknown as Record<string, unknown>).isActive === false) {
    throw AppError.forbidden('This staff account has been deactivated. Contact your manager.')
  }

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    staff: { id: staff.staffId, name: staff.name, businessId: staff.businessId },
  }
}

export async function acceptStaffInviteEmail(opts: {
  token: string
  name: string
  email: string
  password: string
  userAgent?: string
}) {
  if (DEV_MODE) {
    const staffId = `dev-staff-${Date.now()}`
    return {
      accessToken: `dev-staff-access-${Date.now()}`,
      refreshToken: `dev-staff-refresh-${Date.now()}`,
      staff: { id: staffId, name: opts.name, businessId: 'dev-biz-1' },
    }
  }

  const email = opts.email.toLowerCase().trim()
  const invite = await repo.findStaffInviteByToken(opts.token)
  if (!invite) throw AppError.notFound('Invite not found or expired')
  if (invite.accepted) throw AppError.gone('Invite already accepted')
  if (invite.expiresAt && new Date(invite.expiresAt as string) < new Date()) {
    throw AppError.gone('Invite expired')
  }

  const invitedEmail = (invite.invitedEmail as string | null)?.toLowerCase().trim()
  if (invitedEmail && invitedEmail !== email) {
    throw AppError.forbidden('Use the email address this invite was sent to.')
  }

  const businessId = invite.businessId as string
  const { countStaffForBusiness, findBusinessById } = await import('../business/repository.js')
  const biz = await findBusinessById(businessId)
  if (biz) {
    const STAFF_LIMITS: Record<string, number | null> = {
      free: 2,
      starter: 2,
      growth: 5,
      pro: null,
      payg: 2,
    }
    const limit = STAFF_LIMITS[biz.tier ?? 'free']
    if (limit !== null && limit !== undefined) {
      const count = await countStaffForBusiness(businessId)
      if (count >= limit) {
        throw AppError.forbidden(`Staff limit reached for ${biz.tier} tier (max ${limit})`)
      }
    }
  }

  const cognitoUser = await cognito.createEmailPasswordUser('staff', email, opts.password)
  await repo.acceptStaffInvite(opts.token)

  const inviteRole = (invite.role as string) ?? 'staff'
  const staff = await repo.createStaffAccount({
    businessId,
    name: opts.name.trim(),
    email,
    cognitoSub: cognitoUser.sub,
    role: inviteRole as 'manager' | 'staff',
  })

  await cognito.updateUserAttributes('staff', email, {
    staffId: staff.staffId,
    businessId,
  })

  const tokens = await cognito.passwordAuth('staff', email, opts.password)

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    staff: { id: staff.staffId, name: staff.name, businessId: staff.businessId },
  }
}

export async function staffOAuthAcceptInvite(opts: {
  cognitoSub: string
  email?: string | undefined
  inviteToken: string
  name: string
  userAgent: string
}) {
  if (DEV_MODE) {
    const staffId = `dev-staff-${Date.now()}`
    return {
      staff: { id: staffId, name: opts.name, businessId: 'dev-biz-1' },
    }
  }

  let email = opts.email?.toLowerCase().trim()
  if (!email) email = await cognito.getVerifiedEmailBySub('staff', opts.cognitoSub)
  if (!email) {
    throw AppError.unprocessable('Your Google account has no verified email. Accept the invite with phone instead.')
  }

  const invite = await repo.findStaffInviteByToken(opts.inviteToken)
  if (!invite) throw AppError.notFound('Invite not found or expired')
  if (invite.accepted) throw AppError.gone('Invite already accepted')
  if (invite.expiresAt && new Date(invite.expiresAt as string) < new Date()) {
    throw AppError.gone('Invite expired')
  }

  const invitedEmail = (invite.invitedEmail as string | null)?.toLowerCase().trim()
  if (!invitedEmail) {
    throw AppError.badRequest('This invite does not include an email. Accept it with the phone flow instead.')
  }
  if (invitedEmail !== email) {
    throw AppError.forbidden('Sign in with the Google account that matches the invited email.')
  }

  const linked = await repo.findStaffByCognitoSub(opts.cognitoSub)
  if (linked) {
    throw AppError.conflict('This Google account is already linked to a staff profile.')
  }

  const businessId = invite.businessId as string
  const { countStaffForBusiness, findBusinessById } = await import('../business/repository.js')
  const biz = await findBusinessById(businessId)
  if (biz) {
    const STAFF_LIMITS: Record<string, number | null> = {
      free: 2,
      starter: 2,
      growth: 5,
      pro: null,
      payg: 2,
    }
    const limit = STAFF_LIMITS[biz.tier ?? 'free']
    if (limit !== null && limit !== undefined) {
      const count = await countStaffForBusiness(businessId)
      if (count >= limit) {
        throw AppError.forbidden(`Staff limit reached for ${biz.tier} tier (max ${limit})`)
      }
    }
  }

  await repo.acceptStaffInvite(opts.inviteToken)

  const inviteRole = (invite.role as string) ?? 'staff'
  const staff = await repo.createStaffAccount({
    businessId,
    name: opts.name.trim(),
    cognitoSub: opts.cognitoSub,
    email,
    role: inviteRole as 'manager' | 'staff',
  })

  await cognito.updateUserAttributesByCognitoSub('staff', opts.cognitoSub, {
    staffId: staff.staffId,
    businessId,
  })

  return {
    staff: { id: staff.staffId, name: staff.name, businessId: staff.businessId },
  }
}

export async function adminOAuthSync(opts: { cognitoSub: string }) {
  if (DEV_MODE) {
    return { adminId: opts.cognitoSub, role: 'super_admin' as const }
  }

  const attrs = await cognito.getCognitoUserAttrsBySub('admin', opts.cognitoSub)
  if (!attrs) {
    throw AppError.unauthorized('Admin user not found in pool.')
  }

  const role = attrs['custom:admin_role'] ?? 'support_agent'

  return { adminId: opts.cognitoSub, role }
}

export async function getStaffInviteMeta(token: string) {
  if (DEV_MODE) {
    return { expired: false, accepted: false, hasGoogleOption: true }
  }

  const invite = await repo.findStaffInviteByToken(token)
  if (!invite) throw AppError.notFound('Invite not found')

  const expired = Boolean(invite.expiresAt && new Date(invite.expiresAt as string) < new Date())

  return {
    expired,
    accepted: Boolean(invite.accepted),
    hasGoogleOption: Boolean(invite.invitedEmail),
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
    return {
      accessToken: `dev-staff-access-${Date.now()}`,
      refreshToken: `dev-staff-refresh-${Date.now()}`,
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
    const outcome = await cognito.adminBeginAuth(email, password)

    // MFA already enrolled — ask the client for the 6-digit TOTP code.
    if (outcome.challengeName === 'SOFTWARE_TOKEN_MFA') {
      return {
        mfaRequired: true as const,
        challenge: 'SOFTWARE_TOKEN_MFA' as const,
        session: outcome.session ?? '',
        email: email.toLowerCase().trim(),
      }
    }

    // MFA required but not yet set up — hand back a TOTP secret to enrol.
    if (outcome.challengeName === 'MFA_SETUP') {
      const assoc = await cognito.adminAssociateSoftwareToken(outcome.session ?? '')
      const normalizedEmail = email.toLowerCase().trim()
      return {
        mfaRequired: true as const,
        challenge: 'MFA_SETUP' as const,
        session: assoc.session,
        email: normalizedEmail,
        secretCode: assoc.secretCode,
        otpauthUri: buildTotpUri(normalizedEmail, assoc.secretCode),
      }
    }

    if (!outcome.tokens) throw AppError.unauthorized('Invalid credentials')
    return finalizeAdminLogin(email, outcome.tokens)
  } catch (err) {
    if (err instanceof AppError) throw err
    throw AppError.unauthorized('Invalid credentials')
  }
}

/** Respond to the SOFTWARE_TOKEN_MFA challenge for an already-enrolled admin. */
export async function adminMfaRespond(opts: { email: string; session: string; code: string }) {
  if (DEV_MODE) {
    return {
      accessToken: `dev-admin-access-${Date.now()}`,
      refreshToken: `dev-admin-refresh-${Date.now()}`,
      adminId: 'dev-admin-1',
      role: 'super_admin' as const,
    }
  }
  try {
    const tokens = await cognito.adminRespondToMfaChallenge({
      email: opts.email,
      session: opts.session,
      challengeName: 'SOFTWARE_TOKEN_MFA',
      code: opts.code,
    })
    return finalizeAdminLogin(opts.email, tokens)
  } catch (err) {
    if (err instanceof AppError) throw err
    throw AppError.unauthorized('That code was incorrect or expired. Try again.')
  }
}

/** Verify the first TOTP code and complete the MFA_SETUP challenge. */
export async function adminMfaCompleteSetup(opts: { email: string; session: string; code: string }) {
  if (DEV_MODE) {
    return {
      accessToken: `dev-admin-access-${Date.now()}`,
      refreshToken: `dev-admin-refresh-${Date.now()}`,
      adminId: 'dev-admin-1',
      role: 'super_admin' as const,
    }
  }
  try {
    const verified = await cognito.adminVerifySoftwareToken(opts.session, opts.code)
    const tokens = await cognito.adminRespondToMfaChallenge({
      email: opts.email,
      session: verified.session,
      challengeName: 'MFA_SETUP',
    })
    return finalizeAdminLogin(opts.email, tokens)
  } catch (err) {
    if (err instanceof AppError) throw err
    throw AppError.unauthorized('That code was incorrect or expired. Try again.')
  }
}

/** Build an otpauth:// URI for authenticator-app QR codes. */
function buildTotpUri(email: string, secret: string): string {
  const issuer = 'Area Code Admin'
  const label = `${issuer}:${email}`
  const params = new URLSearchParams({ secret, issuer })
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`
}

/**
 * Shared tail of every admin login path: confirm the admin still exists/enabled
 * in the pool and resolve their role. Defence in depth — Cognito issues tokens
 * before we look the user up, so a disabled admin is rejected here.
 */
async function finalizeAdminLogin(
  email: string,
  tokens: { accessToken: string; refreshToken: string },
): Promise<{ accessToken: string; refreshToken: string; adminId: string; role: string }> {
  const cognitoUser = await cognito.getCognitoUser('admin', email)
  if (!cognitoUser?.sub) {
    throw AppError.unauthorized('Account not found or has been disabled')
  }
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    adminId: cognitoUser.sub,
    role: cognitoUser.attributes['custom:admin_role'] ?? 'support_agent',
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
  const client = new CognitoIdentityProviderClient({ region: AWS_REGION })

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
  getVisitedNodes,
  deleteCheckInHistory,
  updateConsent,
  getUserConsent,
  requestAccountDeletion,
  getFullDataExport,
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

// ─── Password Reset (Consumer) ──────────────────────────────────────────────

export async function requestPasswordReset(email: string) {
  const normalizedEmail = email.toLowerCase().trim()
  const user = await repo.getUserByEmail(normalizedEmail)
  // Always return success to prevent email enumeration
  if (!user) return { success: true }

  await checkOtpRateLimit(`reset:${normalizedEmail}`)

  // Generate 6-digit code
  const code = String(Math.floor(100000 + Math.random() * 900000))
  await kvSet(`password-reset:${normalizedEmail}`, code, 600) // 10 min expiry

  // Send email via SES (or log in dev mode)
  if (DEV_MODE) {
    console.log(`[DEV] Password reset code for ${normalizedEmail}: ${code}`)
  } else {
    const { sendPasswordResetEmail } = await import('../../shared/email/ses.js')
    await sendPasswordResetEmail(normalizedEmail, code)
  }

  return { success: true }
}

export async function confirmPasswordReset(email: string, code: string, newPassword: string) {
  const normalizedEmail = email.toLowerCase().trim()
  const storedCode = await kvGet(`password-reset:${normalizedEmail}`)
  if (!storedCode || storedCode !== code) {
    throw AppError.badRequest('Invalid or expired reset code.')
  }

  // Set new password in Cognito
  await cognito.adminSetUserPassword('consumer', normalizedEmail, newPassword)
  await kvDel(`password-reset:${normalizedEmail}`)

  return { success: true }
}

// Staff invite and token revocation in auth-utils-service.ts
export { acceptStaffInvite, revokeUserTokens } from './auth-utils-service.js'
