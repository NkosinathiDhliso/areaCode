// Admin Moderation Service — reports, abuse flags, consent, erasure
import { AppError } from '../../shared/errors/AppError.js'
import * as repo from './repository.js'
import { checkPermission } from './permissions.js'
import type { AdminRole } from './types.js'
import { resetAbuseFlags, disableUser } from './consumer-service.js'

export async function getReportQueue(adminRole: AdminRole) {
  checkPermission(adminRole, 'view_reports')
  const rawItems = await repo.getReportQueue()

  const typeCounts: Record<string, number> = {}
  for (const r of rawItems as Record<string, unknown>[]) {
    const t = (r['type'] as string) ?? 'other'
    typeCounts[t] = (typeCounts[t] ?? 0) + 1
  }

  const items = rawItems.map((r: Record<string, unknown>) => {
    const node = r['node'] as Record<string, unknown> | null
    const nodeName =
      (node?.['name'] as string | undefined) ??
      (r['nodeId'] ? `Node ${(r['nodeId'] as string).slice(0, 8)}…` : 'Unknown node')
    const type = (r['type'] as string) ?? 'other'
    return {
      ...r,
      nodeName,
      nodeSlug: node?.['slug'] as string | undefined,
      sameTypeCount: typeCounts[type] ?? 0,
    }
  })

  return { items }
}

export async function actionReport(adminId: string, adminRole: AdminRole, reportId: string, action: string) {
  checkPermission(adminRole, 'action_reports', adminId)
  const report = await repo.updateReportStatus(reportId, action)
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: `report_${action}`,
    entityType: 'report',
    entityId: reportId,
    afterState: { status: action },
  })
  return report
}

export async function startImpersonation(
  adminId: string,
  adminRole: AdminRole,
  targetUserId: string,
  targetAccountType: string,
  note: string,
) {
  checkPermission(adminRole, 'impersonate', adminId)
  if (!note) throw AppError.badRequest('Note is mandatory for impersonation')
  return repo.createImpersonationLog({
    adminId,
    targetUserId,
    targetAccountType,
    note,
  })
}

export async function getConsentHistory(adminRole: AdminRole, userId: string) {
  checkPermission(adminRole, 'view_consent')
  return repo.getUserConsentHistory(userId)
}

export async function getReconsentList(adminRole: AdminRole) {
  checkPermission(adminRole, 'view_consent')
  const version = process.env['AREA_CODE_CONSENT_VERSION'] ?? 'v1.0'
  return repo.getUsersNeedingReconsent(version)
}

export async function listConsents(adminRole: AdminRole) {
  checkPermission(adminRole, 'view_consent')
  const items = await repo.listConsents()
  return { items }
}

export async function getErasureQueue(adminRole: AdminRole) {
  checkPermission(adminRole, 'view_consent')
  const items = await repo.getErasureQueue()
  return { items }
}

export async function getAbuseFlags(adminRole: AdminRole) {
  checkPermission(adminRole, 'view_user')
  const items = await repo.getUnreviewedAbuseFlags()
  return { items }
}

export async function reviewAbuseFlag(adminId: string, adminRole: AdminRole, flagId: string) {
  checkPermission(adminRole, 'reset_flags', adminId)
  const flag = await repo.reviewAbuseFlag(flagId)
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: 'review_abuse_flag',
    entityType: 'abuse_flag',
    entityId: flagId,
  })
  return flag
}

export async function actionAbuseFlag(adminId: string, adminRole: AdminRole, flagId: string, action: string) {
  checkPermission(adminRole, 'reset_flags', adminId)
  if (action === 'disable_user') {
    const flags = await repo.getUnreviewedAbuseFlags()
    const flag = flags.find((f) => (f.id ?? (f as Record<string, unknown>)['flagId']) === flagId)
    if (flag) {
      const entityId = (flag as Record<string, unknown>)['entityId'] as string
      if (entityId) {
        await disableUser(adminId, adminRole, entityId)
      }
    }
  } else if (action === 'reset_flags') {
    const flags = await repo.getUnreviewedAbuseFlags()
    const flag = flags.find((f) => (f.id ?? (f as Record<string, unknown>)['flagId']) === flagId)
    if (flag) {
      const entityId = (flag as Record<string, unknown>)['entityId'] as string
      if (entityId) {
        await resetAbuseFlags(adminId, adminRole, entityId)
      }
    }
  }
  await repo.reviewAbuseFlag(flagId)
  await repo.createAuditLog({
    adminId,
    adminRole,
    action: `abuse_flag_${action}`,
    entityType: 'abuse_flag',
    entityId: flagId,
    afterState: { action },
  })
  return { success: true }
}
