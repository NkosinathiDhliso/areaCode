import * as cognito from '../../shared/cognito/client.js'
import { AppError } from '../../shared/errors/AppError.js'
import { kvGet, kvSet, kvDel } from '../../shared/kv/dynamodb-kv.js'
import { reportOtpFeedback } from '../../shared/sms/feedback.js'
import { findBusinessByCognitoSub } from '../business/repository.js'
import { updateBusiness } from './dynamodb-repository.js'
import * as repo from './repository.js'
import { createLoginSession } from './session-service.js'
import { checkOtpRateLimit } from './shared-service.js'

export async function businessSignup(data: {
  email: string
  phone: string
  businessName: string
  registrationNumber?: string
}) {
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

export async function businessEmailSignup(data: {
  email: string
  password: string
  businessName: string
  registrationNumber?: string
  userAgent?: string
}) {
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
  const loginSession = await createLoginSession(business.businessId, data.userAgent ?? '')

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    sessionId: loginSession.sessionId,
    businessId: business.businessId,
  }
}

export async function businessEmailLogin(emailRaw: string, password: string, userAgent?: string) {
  const email = emailRaw.toLowerCase().trim()
  const tokens = await cognito.passwordAuth('business', email, password)
  const cognitoUser = await cognito.getCognitoUser('business', email)
  const businessId = cognitoUser?.attributes['custom:businessId']
  if (!businessId) throw AppError.unauthorized('Business account is not linked.')

  const loginSession = await createLoginSession(businessId, userAgent ?? '')

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    sessionId: loginSession.sessionId,
    businessId,
  }
}

export async function businessOAuthSync(opts: { cognitoSub: string; userAgent: string }) {
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

  const loginSession = await createLoginSession(businessId, opts.userAgent)

  return {
    needsBusinessProfile: false as const,
    businessId,
    sessionId: loginSession.sessionId,
  }
}

export async function businessOAuthCompleteProfile(opts: {
  cognitoSub: string
  email?: string | undefined
  userAgent: string
  businessName: string
  registrationNumber?: string
}) {
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

  const loginSession = await createLoginSession(business.businessId, opts.userAgent)

  return { businessId: business.businessId, sessionId: loginSession.sessionId }
}
