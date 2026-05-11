import * as cognito from '../../shared/cognito/client.js'
import { AppError } from '../../shared/errors/AppError.js'
import { kvGet, kvSet, kvDel } from '../../shared/kv/dynamodb-kv.js'
import { reportOtpFeedback } from '../../shared/sms/feedback.js'
import * as repo from './repository.js'
import { createLoginSession } from './session-service.js'
import { checkOtpRateLimit } from './shared-service.js'

export async function getStaffInviteMeta(token: string) {
  const invite = await repo.findStaffInviteByToken(token)
  if (!invite) throw AppError.notFound('Invite not found')

  const expired = Boolean(invite.expiresAt && new Date(invite.expiresAt as unknown as string) < new Date())

  return {
    expired,
    accepted: Boolean(invite.accepted),
    hasGoogleOption: Boolean(invite.invitedEmail),
  }
}

export async function staffLogin(phone: string) {
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

export async function staffOAuthSync(opts: { cognitoSub: string; userAgent: string }) {
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

  const loginSession = await createLoginSession(staff.staffId, opts.userAgent)

  return {
    staff: { id: staff.staffId, name: staff.name, businessId: staff.businessId },
    sessionId: loginSession.sessionId,
  }
}

export async function staffEmailLogin(emailRaw: string, password: string, userAgent?: string) {
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

  const loginSession = await createLoginSession(staff.staffId, userAgent ?? '')

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    sessionId: loginSession.sessionId,
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
  const email = opts.email.toLowerCase().trim()
  const invite = await repo.findStaffInviteByToken(opts.token)
  if (!invite) throw AppError.notFound('Invite not found or expired')
  if (invite.accepted) throw AppError.gone('Invite already accepted')
  if (invite.expiresAt && new Date(invite.expiresAt as unknown as string) < new Date()) {
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

  const staff = await repo.createStaffAccount({
    businessId,
    name: opts.name.trim(),
    email,
    cognitoSub: cognitoUser.sub,
  })

  await cognito.updateUserAttributes('staff', email, {
    staffId: staff.staffId,
    businessId,
  })

  const tokens = await cognito.passwordAuth('staff', email, opts.password)
  const loginSession = await createLoginSession(staff.staffId, opts.userAgent ?? '')

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    sessionId: loginSession.sessionId,
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
  let email = opts.email?.toLowerCase().trim()
  if (!email) email = await cognito.getVerifiedEmailBySub('staff', opts.cognitoSub)
  if (!email) {
    throw AppError.unprocessable('Your Google account has no verified email. Accept the invite with phone instead.')
  }

  const invite = await repo.findStaffInviteByToken(opts.inviteToken)
  if (!invite) throw AppError.notFound('Invite not found or expired')
  if (invite.accepted) throw AppError.gone('Invite already accepted')
  if (invite.expiresAt && new Date(invite.expiresAt as unknown as string) < new Date()) {
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

  const staff = await repo.createStaffAccount({
    businessId,
    name: opts.name.trim(),
    cognitoSub: opts.cognitoSub,
    email,
  })

  await cognito.updateUserAttributesByCognitoSub('staff', opts.cognitoSub, {
    staffId: staff.staffId,
    businessId,
  })

  const loginSession = await createLoginSession(staff.staffId, opts.userAgent)

  return {
    staff: { id: staff.staffId, name: staff.name, businessId: staff.businessId },
    sessionId: loginSession.sessionId,
  }
}
