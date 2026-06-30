import type { FastifyRequest, FastifyReply } from 'fastify'
import { AppError } from '../errors/AppError.js'
import { getAuth } from './auth.js'
import { getBusinessById, getStaffById } from '../../features/auth/dynamodb-repository.js'
import type { BusinessMemberRole } from '../../features/business/types.js'
import { hasPermission } from '../../features/business/types.js'
import { DEV_MODE } from '../config/env.js'

export interface BusinessRolePayload {
  businessId: string
  memberRole: BusinessMemberRole
}

/**
 * Middleware that resolves the authenticated user's role within their business
 * and checks if they have the required permission.
 *
 * Must be used AFTER requireAuth('business', 'staff').
 * Attaches `request.businessRole` with the resolved role info.
 *
 * For owners: auth.userId = businessId (from business Cognito pool)
 * For managers: auth.userId = staffId (from staff Cognito pool), resolved to businessId via staff record
 *
 * Usage:
 *   preHandler: [requireAuth('business', 'staff'), requireBusinessPermission('manage_rewards')]
 */
export function requireBusinessPermission(permission: string) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const auth = getAuth(request)

    let role: BusinessMemberRole = 'owner'
    let businessId = auth.userId

    if (!DEV_MODE) {
      if (auth.role === 'business') {
        // Authenticated via business pool — this is the owner
        const business = await getBusinessById(auth.userId)
        if (!business) throw AppError.forbidden('Business account not found.')
        role = 'owner'
        businessId = auth.userId
      } else if (auth.role === 'staff') {
        // Authenticated via staff pool — check if they're a manager
        const staff = await getStaffById(auth.userId)
        if (!staff) throw AppError.forbidden('Staff account not found.')
        if (staff.role === 'manager') {
          role = 'manager'
          businessId = staff.businessId
        } else {
          throw AppError.forbidden('Staff members must use the staff portal.')
        }
      } else {
        throw AppError.forbidden('You do not have access to this business.')
      }
    }

    if (!hasPermission(role, permission)) {
      throw AppError.forbidden(`This action requires ${permission} permission.`)
    }

    // Attach role to request for downstream use
    ;(request as FastifyRequest & { businessRole: BusinessRolePayload }).businessRole = {
      businessId,
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
