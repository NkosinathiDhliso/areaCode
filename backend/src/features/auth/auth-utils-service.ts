import { AppError } from '../../shared/errors/AppError.js'
import * as repo from './repository.js'
import * as cognito from '../../shared/cognito/client.js'

// ─── Staff Invite ───────────────────────────────────────────────────────────

export async function acceptStaffInvite(token: string, name: string, phone: string) {
  const invite = await repo.findStaffInviteByToken(token)
  if (!invite) throw AppError.notFound('Invite not found or expired')
  if (invite.accepted) throw AppError.gone('Invite already accepted')
  if (invite.expiresAt && new Date(invite.expiresAt as string) < new Date()) {
    throw AppError.gone('Invite expired')
  }

  const invitedPhone = invite.invitedPhone as string | null
  if (invitedPhone && invitedPhone !== phone) {
    throw AppError.badRequest('Phone number does not match the invited number')
  }

  // Re-check tier limits at acceptance time (business may have downgraded)
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

  await repo.acceptStaffInvite(token)

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
  const { CognitoIdentityProviderClient, AdminUserGlobalSignOutCommand } =
    await import('@aws-sdk/client-cognito-identity-provider')
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
  await client.send(
    new AdminUserGlobalSignOutCommand({
      UserPoolId: userPoolId,
      Username: cognitoSub,
    }),
  )
}
