// Admin role permissions and permission checking
import { AppError } from '../../shared/errors/AppError.js'
import { logger } from '../../shared/monitoring/logger.js'
import type { AdminRole } from './types.js'

/**
 * Admin role hierarchy levels.
 * Higher number = more permissions.
 * super_admin (3) > support_agent (2) > content_moderator (1)
 */
export const ADMIN_ROLE_LEVELS: Record<AdminRole, number> = {
  super_admin: 3,
  support_agent: 2,
  content_moderator: 1,
}

/**
 * Minimum role level required for destructive actions.
 * Actions not listed here default to content_moderator (level 1).
 */
export const DESTRUCTIVE_ACTION_MIN_ROLES: Record<string, AdminRole> = {
  disable_user: 'super_admin',
  process_erasure: 'super_admin',
  impersonate: 'super_admin',
  revoke_staff: 'super_admin',
  deactivate_rewards: 'super_admin',
  override_cipc: 'super_admin',
  manage_business: 'super_admin',
  override_streak: 'super_admin',
  reset_flags: 'support_agent',
  extend_trial: 'support_agent',
  send_message: 'support_agent',
  manage_user: 'support_agent',
  action_reports: 'content_moderator',
  view_reports: 'content_moderator',
  view_user: 'content_moderator',
  view_business: 'content_moderator',
  view_consent: 'content_moderator',
}

export const ROLE_PERMISSIONS: Record<AdminRole, Set<string>> = {
  super_admin: new Set([
    'view_user',
    'disable_user',
    'reset_flags',
    'recalculate_tier',
    'override_streak',
    'process_erasure',
    'send_message',
    'impersonate',
    'view_business',
    'extend_trial',
    'revoke_staff',
    'deactivate_rewards',
    'override_cipc',
    'view_reports',
    'action_reports',
    'view_consent',
    'manage_user',
    'manage_business',
    'view_dashboard',
  ]),
  support_agent: new Set(['view_user', 'send_message', 'view_business', 'extend_trial', 'view_consent', 'manage_user', 'view_dashboard']),
  content_moderator: new Set(['view_reports', 'action_reports', 'override_cipc']),
}

/**
 * Get the numeric level for an admin role.
 */
export function getRoleLevel(role: string): number {
  return ADMIN_ROLE_LEVELS[role as AdminRole] ?? 0
}

/**
 * Check if a role has permission to perform an action.
 * Uses both the permission set AND role hierarchy for destructive actions.
 * Logs all authorization failures with userId, resource, and timestamp.
 */
export function checkPermission(role: AdminRole, action: string, userId?: string) {
  if (!ROLE_PERMISSIONS[role]?.has(action)) {
    logger.warn('Admin authorization failure', {
      userId: userId ?? 'unknown',
      role,
      action,
      resource: action,
      timestamp: new Date().toISOString(),
    })
    throw AppError.forbidden(`Role ${role} cannot perform ${action}`)
  }

  // Additionally verify role hierarchy for destructive actions
  const minRole = DESTRUCTIVE_ACTION_MIN_ROLES[action]
  if (minRole) {
    const userLevel = ADMIN_ROLE_LEVELS[role]
    const requiredLevel = ADMIN_ROLE_LEVELS[minRole]
    if (userLevel < requiredLevel) {
      logger.warn('Admin role hierarchy authorization failure', {
        userId: userId ?? 'unknown',
        role,
        requiredMinimumRole: minRole,
        action,
        resource: action,
        timestamp: new Date().toISOString(),
      })
      throw AppError.forbidden(`Role ${role} does not have sufficient privileges for ${action}`)
    }
  }
}
