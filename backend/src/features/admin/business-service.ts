// Admin Business Service — business management operations
import { AppError } from '../../shared/errors/AppError.js'
import * as repo from './repository.js'
import { checkPermission } from './permissions.js'
import type { AdminRole } from './types.js'

export async function getBusiness(adminRole: AdminRole, businessId: string) {
  checkPermission(adminRole, 'view_business')
  const biz = await repo.getBusinessById(businessId)
  if (!biz) throw AppError.notFound('Business not found')
  return biz
}

export async function extendTrial(adminId: string, adminRole: AdminRole, businessId: string, days: number) {
  checkPermission(adminRole, 'extend_trial', adminId)
  const result = await repo.extendBusinessTrial(businessId, days)
  if (!result) throw AppError.notFound('Business not found')
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: 'extend_trial',
    entityType: 'business',
    entityId: businessId,
    afterState: { days, newTrialEnd: result.trialEndsAt },
  })
  return result
}

export async function setBusinessTier(
  adminId: string,
  adminRole: AdminRole,
  businessId: string,
  tier: 'starter' | 'growth' | 'pro',
  reason: string,
  trialEndsAt?: string,
) {
  checkPermission(adminRole, 'manage_business', adminId)
  const { updateBusinessTier } = await import('../business/repository.js')
  await updateBusinessTier(businessId, tier, trialEndsAt)
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: 'set_tier',
    entityType: 'business',
    entityId: businessId,
    afterState: { tier, reason, trialEndsAt },
  })
  return { success: true, tier, trialEndsAt }
}

export async function getBusinessStaff(adminRole: AdminRole, businessId: string) {
  checkPermission(adminRole, 'view_business')
  const { listStaffAccounts } = await import('../business/repository.js')
  const items = await listStaffAccounts(businessId)
  return { items }
}

export async function revokeStaffAccess(adminId: string, adminRole: AdminRole, businessId: string, staffId: string) {
  checkPermission(adminRole, 'revoke_staff', adminId)
  const { removeStaffAccount } = await import('../business/repository.js')
  await removeStaffAccount(staffId, businessId)
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: 'revoke_staff',
    entityType: 'staff',
    entityId: staffId,
    afterState: { businessId, revokedBy: adminId },
  })
  return { success: true }
}

export async function searchBusinesses(adminRole: AdminRole, query: string) {
  checkPermission(adminRole, 'view_business')
  const items = await repo.searchBusinesses(query)
  return { items, nextCursor: null, hasMore: false }
}

export async function businessAction(adminId: string, adminRole: AdminRole, businessId: string, action: string) {
  switch (action) {
    case 'extend-trial':
      return extendTrial(adminId, adminRole, businessId, 14)
    case 'disable':
      return disableBusiness(adminId, adminRole, businessId)
    default: {
      const destructiveActions = ['deactivate', 'revoke', 'delete', 'downgrade', 'deactivate-rewards']
      const requiredPermission = destructiveActions.includes(action) ? 'manage_business' : 'view_business'
      checkPermission(adminRole, requiredPermission, adminId)
      await repo.createAuditLog({
        adminId,
        adminRole,
        action: `business_${action}`,
        entityType: 'business',
        entityId: businessId,
      })
      return { success: true }
    }
  }
}

export async function disableBusiness(adminId: string, adminRole: AdminRole, businessId: string) {
  checkPermission(adminRole, 'disable_user', adminId)
  const biz = await repo.getBusinessById(businessId)
  if (!biz) throw AppError.notFound('Business not found')

  const { getNodesByBusinessId, updateNode } = await import('../nodes/dynamodb-repository.js')
  const nodes = await getNodesByBusinessId(businessId)
  for (const node of nodes) {
    await updateNode(node.nodeId, { isActive: false })
  }

  await repo.createAuditLog({
    adminId,
    adminRole,
    action: 'disable_business',
    entityType: 'business',
    entityId: businessId,
    afterState: { isActive: false, nodesDeactivated: nodes.length },
  })

  return { success: true, businessId, nodesDeactivated: nodes.length }
}
