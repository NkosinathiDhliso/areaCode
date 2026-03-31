import { AppError } from '../../shared/errors/AppError.js'
import * as repo from './repository.js'
import type { AdminRole } from './types.js'

// Role permissions
const ROLE_PERMISSIONS: Record<AdminRole, Set<string>> = {
  super_admin: new Set([
    'view_user', 'disable_user', 'reset_flags', 'recalculate_tier',
    'override_streak', 'process_erasure', 'send_message', 'impersonate',
    'view_business', 'extend_trial', 'revoke_staff', 'deactivate_rewards',
    'override_cipc', 'view_reports', 'action_reports', 'view_consent',
  ]),
  support_agent: new Set([
    'view_user', 'send_message', 'view_business', 'extend_trial', 'view_consent',
  ]),
  content_moderator: new Set([
    'view_reports', 'action_reports', 'override_cipc',
  ]),
}

function checkPermission(role: AdminRole, action: string) {
  if (!ROLE_PERMISSIONS[role]?.has(action)) {
    throw AppError.forbidden(`Role ${role} cannot perform ${action}`)
  }
}

// ─── Consumer Management ────────────────────────────────────────────────────

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

export async function resetAbuseFlags(
  adminId: string, adminRole: AdminRole, userId: string,
) {
  checkPermission(adminRole, 'reset_flags')
  await repo.resetAbuseFlags(userId)
  await repo.createAuditLog({
    adminId, adminRole, action: 'reset_abuse_flags',
    entityType: 'user', entityId: userId,
  })
}

export async function sendMessage(
  adminId: string, adminRole: AdminRole,
  targetUserId: string, message: string,
) {
  checkPermission(adminRole, 'send_message')
  const msg = await repo.sendAdminMessage(adminId, targetUserId, message)
  await repo.createAuditLog({
    adminId, adminRole, action: 'send_message',
    entityType: 'user', entityId: targetUserId,
    afterState: { message },
  })
  return msg
}

// ─── Business Management ────────────────────────────────────────────────────

export async function getBusiness(adminRole: AdminRole, businessId: string) {
  checkPermission(adminRole, 'view_business')
  const biz = await repo.getBusinessById(businessId)
  if (!biz) throw AppError.notFound('Business not found')
  return biz
}

export async function extendTrial(
  adminId: string, adminRole: AdminRole,
  businessId: string, days: number,
) {
  checkPermission(adminRole, 'extend_trial')
  const result = await repo.extendBusinessTrial(businessId, days)
  if (!result) throw AppError.notFound('Business not found')
  await repo.createAuditLog({
    adminId, adminRole, action: 'extend_trial',
    entityType: 'business', entityId: businessId,
    afterState: { days, newTrialEnd: result.trialEndsAt },
  })
  return result
}

// ─── Reports ────────────────────────────────────────────────────────────────

export async function getReportQueue(adminRole: AdminRole) {
  checkPermission(adminRole, 'view_reports')
  return repo.getReportQueue()
}

export async function actionReport(
  adminId: string, adminRole: AdminRole,
  reportId: string, action: string,
) {
  checkPermission(adminRole, 'action_reports')
  const report = await repo.updateReportStatus(reportId, action)
  await repo.createAuditLog({
    adminId, adminRole, action: `report_${action}`,
    entityType: 'report', entityId: reportId,
    afterState: { status: action },
  })
  return report
}

// ─── Impersonation ──────────────────────────────────────────────────────────

export async function startImpersonation(
  adminId: string, adminRole: AdminRole,
  targetUserId: string, targetAccountType: string, note: string,
) {
  checkPermission(adminRole, 'impersonate')
  if (!note) throw AppError.badRequest('Note is mandatory for impersonation')
  return repo.createImpersonationLog({
    adminId, targetUserId, targetAccountType, note,
  })
}

// ─── Consent Audit ──────────────────────────────────────────────────────────

export async function getConsentHistory(adminRole: AdminRole, userId: string) {
  checkPermission(adminRole, 'view_consent')
  return repo.getUserConsentHistory(userId)
}

export async function getReconsentList(adminRole: AdminRole) {
  checkPermission(adminRole, 'view_consent')
  const version = process.env['AREA_CODE_CONSENT_VERSION'] ?? 'v1.0'
  return repo.getUsersNeedingReconsent(version)
}
