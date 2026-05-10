/**
 * Ownership verification middleware for business endpoints.
 *
 * Ensures that the authenticated business can only access resources
 * that belong to them (resource.businessId === authenticatedBusiness.id).
 *
 * Returns HTTP 403 on ownership violations.
 */
import { AppError } from '../errors/AppError.js'
import { logger } from '../monitoring/logger.js'

/**
 * Verify that a resource belongs to the authenticated business.
 * Throws AppError.forbidden() if the resource's businessId does not match.
 */
export function verifyBusinessOwnership(resourceBusinessId: string, authenticatedBusinessId: string): void {
  if (resourceBusinessId !== authenticatedBusinessId) {
    logger.warn('Business ownership verification failed', {
      authenticatedBusinessId,
      resourceBusinessId,
      timestamp: new Date().toISOString(),
    })
    throw AppError.forbidden('You do not have access to this resource')
  }
}

/**
 * Verify that a staff member belongs to the same business as the node.
 * Throws AppError.forbidden() if the staff member's businessId does not match the node's businessId.
 */
export function verifyStaffBusinessLinkage(staffBusinessId: string, nodeBusinessId: string): void {
  if (staffBusinessId !== nodeBusinessId) {
    logger.warn('Staff-to-business linkage verification failed', {
      staffBusinessId,
      nodeBusinessId,
      timestamp: new Date().toISOString(),
    })
    throw AppError.forbidden('Staff member does not have access to this node')
  }
}

/**
 * Admin role hierarchy levels.
 * Higher number = more permissions.
 */
export const ADMIN_ROLE_LEVELS: Record<string, number> = {
  super_admin: 3,
  support_agent: 2,
  content_moderator: 1,
}

/**
 * Get the numeric level for an admin role.
 */
export function getRoleLevel(role: string): number {
  if (Object.prototype.hasOwnProperty.call(ADMIN_ROLE_LEVELS, role)) {
    return ADMIN_ROLE_LEVELS[role] ?? 0
  }
  return 0
}

/**
 * Verify that an admin user has sufficient role level for a destructive action.
 * Logs all authorization failures with userId, resource, and timestamp.
 * Throws AppError.forbidden() if the role level is insufficient.
 */
export function verifyAdminRoleLevel(
  userId: string,
  userRole: string,
  requiredMinimumRole: string,
  resource: string,
): void {
  const userLevel = getRoleLevel(userRole)
  const requiredLevel = getRoleLevel(requiredMinimumRole)

  if (userLevel < requiredLevel) {
    logger.warn('Admin role authorization failed', {
      userId,
      userRole,
      requiredMinimumRole,
      resource,
      timestamp: new Date().toISOString(),
    })
    throw AppError.forbidden(`Role ${userRole} does not have permission for this action`)
  }
}
