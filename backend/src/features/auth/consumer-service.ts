import * as cognito from '../../shared/cognito/client.js'
import { AppError } from '../../shared/errors/AppError.js'
import { kvGet, kvSet, kvDel } from '../../shared/kv/dynamodb-kv.js'
import { reportOtpFeedback } from '../../shared/sms/feedback.js'
import * as repo from './repository.js'
import { createLoginSession } from './session-service.js'
import { checkOtpRateLimit, suggestedUsernameFromEmail } from './shared-service.js'

export async function consumerSignup(data: {
  phone: string
  username: string
  displayName: string
  citySlug: string
  consentAnalytics?: boolean
}) {
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

/** Called once after Hosted UI Google OAuth returns Cognito tokens. Ensures Dynamo user + Cognito custom:userId. */
export async function consumerOAuthSync(opts: { cognitoSub: string; email?: string | undefined; userAgent: string }) {
  const { cognitoSub, email: rawEmail, userAgent } = opts

  let user = await repo.getUserByCognitoSub(cognitoSub)

  if (!user) {
    let email = rawEmail?.toLowerCase().trim()
    if (!email) email = await cognito.getConsumerVerifiedEmailBySub(cognitoSub)
    if (!email) {
      throw AppError.unprocessable('Your Google account has no email. Use another Google account or contact support.')
    }

    const dupEmail = await repo.getUserByEmail(email)
    if (dupEmail && dupEmail.cognitoSub && dupEmail.cognitoSub !== cognitoSub) {
      throw AppError.conflict('This email is already registered. Sign in with the method you used before.')
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
    const displayName = emailLocal.length > 0 ? emailLocal.charAt(0).toUpperCase() + emailLocal.slice(1) : 'Explorer'

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

export async function consumerEmailSignup(data: {
  email: string
  password: string
  consentAnalytics?: boolean
  userAgent?: string
}) {
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

  const cognitoUser = await cognito.createEmailPasswordUser('consumer', email, data.password)

  const user = await repo.createUser({
    email,
    username,
    displayName,
    cityId: city.id,
    cognitoSub: cognitoUser.sub,
  })

  await cognito.updateUserAttributes('consumer', email, {
    userId: user.userId,
    citySlug: 'johannesburg',
  })

  const consentVersion = process.env['AREA_CODE_CONSENT_VERSION'] ?? 'v1.0'
  await repo.insertConsentRecord(user.userId, consentVersion, data.consentAnalytics ?? false)

  const tokens = await cognito.passwordAuth('consumer', email, data.password)
  const loginSession = await createLoginSession(user.userId, data.userAgent ?? '')

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    sessionId: loginSession.sessionId,
    user: { id: user.userId, username: user.username, displayName: user.displayName, tier: user.tier },
  }
}

export async function consumerEmailLogin(emailRaw: string, password: string, userAgent?: string) {
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

  const loginSession = await createLoginSession(user.userId, userAgent ?? '')

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    sessionId: loginSession.sessionId,
    user: { id: user.userId, username: user.username, displayName: user.displayName, tier: user.tier },
  }
}
