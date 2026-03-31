import { prisma } from '../../shared/db/prisma.js'

// ─── Consumer Management ────────────────────────────────────────────────────

export async function getUserById(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      consentRecords: { orderBy: { consentedAt: 'desc' }, take: 5 },
      pushTokens: { where: { isActive: true } },
      notificationPrefs: true,
    },
  })
}

export async function getUserCheckInHistory(userId: string, take = 50) {
  return prisma.checkIn.findMany({
    where: { userId },
    orderBy: { checkedInAt: 'desc' },
    take,
    include: { node: { select: { name: true, slug: true } } },
  })
}

export async function updateUserTier(userId: string, tier: string) {
  return prisma.user.update({ where: { id: userId }, data: { tier } })
}

export async function resetAbuseFlags(entityId: string) {
  return prisma.abuseFlag.updateMany({
    where: { entityId, reviewed: false },
    data: { reviewed: true },
  })
}

// ─── Business Management ────────────────────────────────────────────────────

export async function getBusinessById(businessId: string) {
  return prisma.businessAccount.findUnique({
    where: { id: businessId },
    include: {
      nodes: { select: { id: true, name: true, slug: true, claimStatus: true } },
      staffAccounts: { where: { isActive: true } },
    },
  })
}

export async function extendBusinessTrial(businessId: string, days: number) {
  const biz = await prisma.businessAccount.findUnique({ where: { id: businessId } })
  if (!biz) return null

  const base = biz.trialEndsAt && biz.trialEndsAt > new Date()
    ? biz.trialEndsAt
    : new Date()
  const newEnd = new Date(base.getTime() + days * 24 * 60 * 60 * 1000)

  return prisma.businessAccount.update({
    where: { id: businessId },
    data: { trialEndsAt: newEnd },
  })
}

// ─── Reports ────────────────────────────────────────────────────────────────

export async function getReportQueue() {
  return prisma.report.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: 50,
    include: {
      node: { select: { id: true, name: true, slug: true } },
    },
  })
}

export async function updateReportStatus(reportId: string, status: string) {
  return prisma.report.update({
    where: { id: reportId },
    data: { status },
  })
}

// ─── Audit Log ──────────────────────────────────────────────────────────────

export async function createAuditLog(data: {
  adminId: string; adminRole: string; action: string;
  entityType: string; entityId: string;
  beforeState?: unknown; afterState?: unknown; note?: string;
}) {
  return prisma.auditLog.create({
    data: {
      adminId: data.adminId,
      adminRole: data.adminRole,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      beforeState: data.beforeState as object ?? undefined,
      afterState: data.afterState as object ?? undefined,
      note: data.note,
    },
  })
}

// ─── Impersonation ──────────────────────────────────────────────────────────

export async function createImpersonationLog(data: {
  adminId: string; targetUserId: string;
  targetAccountType: string; note: string;
}) {
  return prisma.impersonationLog.create({ data })
}

// ─── Admin Messages ─────────────────────────────────────────────────────────

export async function sendAdminMessage(
  adminId: string,
  targetUserId: string,
  message: string,
) {
  return prisma.adminMessage.create({
    data: { adminId, targetUserId, message },
  })
}

// ─── Consent Audit ──────────────────────────────────────────────────────────

export async function getUserConsentHistory(userId: string) {
  return prisma.consentRecord.findMany({
    where: { userId },
    orderBy: { consentedAt: 'desc' },
  })
}

export async function getUsersNeedingReconsent(currentVersion: string) {
  return prisma.user.findMany({
    where: {
      consentRecords: {
        none: { consentVersion: currentVersion },
      },
    },
    select: { id: true, username: true, phone: true },
    take: 100,
  })
}
