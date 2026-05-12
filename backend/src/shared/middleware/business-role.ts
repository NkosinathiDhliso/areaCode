import type { FastifyRequest, FastifyReply } from 'fastify'
import { AppError } from '../errors/AppError.js'
import { getAuth } from './auth.js'
import { getBusinessById } from '../../features/auth/dynamodb-repository.js'
import { getStaffById } from '../../features/auth/dynamodb-repository.js'
import type { BusinessMemberRole } from '../../features/business/types.js'
import { hasPermission } from '../../features/business/types.js'

const DEV_MODE = process.env['AREA_CODE_ENV'] === 'dev' && !process.env['AREA_CODE_FORCE_LIVE']

export interface BusinessRolePayload {
  businessId: string
  memberRole: BusinessMemberRole
}

/**
 * Middleware that resolves the authenticated user's role within their business
 * and checks if they have the required permission.
 *
 * Must be used AFTER requireAuth('business').
 * Attaches `request.businessRole` with the resolved role info.
 *
 * Usage:
 *   preHandler: [requireAuth('business'), requireBusinessPermission('manage_rewards')]
 */
export function requireBusinessPermission(permission: string) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const auth = getAuth(request)

    let role: BusinessMemberRole = 'owner'

    if (!DEV_MODE) {
      // The auth.userId for business tokens is the businessId (owner).
      // For managers who log in via the business portal, we need to check
      // if they're the owner or a manager.
      const business = await getBusinessById(auth.userId)
      if (business) {
        // This is the owner — their businessId matches auth.userId
        role = 'owner'
      } else {
        // Not found as a business — might be a manager (staff with elevated role)
        // Managers authenticate via the business Cognito pool but their userId
        // resolves to a manager record, not the business itself.
        const staff = await getStaffById(auth.userId)
        if (staff && staff.role === 'manager') {
          role = 'manager'
        } else {
          throw AppError.forbidden('You do not have access to this business.')
        }
      }
    }

    if (!hasPermission(role, permission)) {
      throw AppError.forbidden(`This action requires ${permission} permission.`)
    }

    // Attach role to request for downstream use
    ;(request as FastifyRequest & { businessRole: BusinessRolePayload }).businessRole = {
      businessId: auth.userId,
      memberRole: role,
    }
  }
}

/**
 * Helper to get the business role payload from a request.
 */
export function getBusinessRole(request: FastifyRequest): BusinessRolePayload {
  const payload = (request as FastifyRequest & { businessRole?: BusinessRolePayload }).businessRole
  if (!payload) {
    // Fallback: if middleware wasn't used, assume owner (backward compat)
    const auth = getAuth(request)
    return { businessId: auth.userId, memberRole: 'owner' }
  }
  return payload
}
