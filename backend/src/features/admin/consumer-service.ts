// Admin Consumer Service — consumer management operations
import { AppError } from '../../shared/errors/AppError.js'
import * as repo from './repository.js'
import { checkPermission } from './permissions.js'
import type { AdminRole } from './types.js'

export async function getUser(adminRole: AdminRole, userId: string) {
  checkPermission(adminRole, 'view_user')
  const user = await repo.getUserById(userId)
  if (!user) throw AppError.notFound('User not found')
  return user
}

export async function getUserCheckInHistory(adminRole: AdminRole, userId: string) {
  checkPermission(adminRole, 'view_user')
  return repo.getUserCheckInHistory(userId)
}

export async function resetAbuseFlags(adminId: string, adminRole: AdminRole, userId: string) {
  checkPermission(adminRole, 'reset_flags', adminId)
  await repo.resetAbuseFlags(userId)
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: 'reset_abuse_flags',
    entityType: 'user',
    entityId: userId,
  })
}

export async function sendMessage(adminId: string, adminRole: AdminRole, targetUserId: string, message: string) {
  checkPermission(adminRole, 'send_message', adminId)
  const msg = await repo.sendAdminMessage(adminId, targetUserId, message)
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: 'send_message',
    entityType: 'user',
    entityId: targetUserId,
    afterState: { message },
  })
  return msg
}

export async function searchConsumers(adminRole: AdminRole, query: string) {
  checkPermission(adminRole, 'view_user')
  const items = await repo.searchConsumers(query)
  return { items, nextCursor: null, hasMore: false }
}

export async function consumerAction(
  adminId: string,
  adminRole: AdminRole,
  userId: string,
  action: string,
  note?: string,
) {
  switch (action) {
    case 'reset-flags':
      return resetAbuseFlags(adminId, adminRole, userId)
    case 'send-message':
      if (!note) throw AppError.badRequest('Message text is required')
      return sendMessage(adminId, adminRole, userId, note)
    case 'disable':
      return disableUser(adminId, adminRole, userId)
    default: {
      const destructiveActions = ['override-streak', 'recalculate-tier', 'process-erasure']
      const requiredPermission =
        action === 'process-erasure'
          ? 'process_erasure'
          : destructiveActions.includes(action)
            ? 'manage_user'
            : 'view_user'
      checkPermission(adminRole, requiredPermission)
      await repo.createAuditLog({
        adminId,
        adminRole,
        action: `consumer_${action}`,
        entityType: 'user',
        entityId: userId,
        afterState: { note },
      })
      return { success: true }
    }
  }
}

export async function disableUser(adminId: string, adminRole: AdminRole, userId: string) {
  checkPermission(adminRole, 'disable_user', adminId)
  const user = await repo.getUserById(userId)
  if (!user) throw AppError.notFound('User not found')

  const { updateUser } = await import('../auth/dynamodb-repository.js')
  await updateUser(userId, {
    isDisabled: true,
    disabledAt: new Date().toISOString(),
  } as Parameters<typeof updateUser>[1])

  const cognitoSub = (user as Record<string, unknown>)['cognitoSub'] as string | undefined
  if (cognitoSub) {
    try {
      const { CognitoIdentityProviderClient, AdminUserGlobalSignOutCommand } =
        await import('@aws-sdk/client-cognito-identity-provider')
      const region = process.env['AWS_REGION'] ?? 'us-east-1'
      const userPoolId = process.env['AREA_CODE_COGNITO_CONSUMER_USER_POOL_ID'] ?? ''
      if (userPoolId) {
        const client = new CognitoIdentityProviderClient({ region })
        await client.send(
          new AdminUserGlobalSignOutCommand({
            UserPoolId: userPoolId,
            Username: cognitoSub,
          }),
        )
      }
    } catch {
      // Cognito sign-out failure is non-critical
    }
  }

  await repo.createAuditLog({
    adminId,
    adminRole,
    action: 'disable_user',
    entityType: 'user',
    entityId: userId,
    afterState: { isDisabled: true },
  })

  return { success: true, userId, isDisabled: true }
}
