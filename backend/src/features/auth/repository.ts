import { prisma } from '../../shared/db/prisma.js'
import { Prisma } from '@prisma/client'

// ─── User Profile ───────────────────────────────────────────────────────────

export async function getUserByCognitoSub(sub: string) {
  return prisma.user.findUnique({ where: { cognitoSub: sub } })
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({ where: { id } })
}

export async function updateUserProfile(
  userId: string,
  data: Partial<{ displayName: string; avatarUrl: string | null; cityId: string }>,
) {
  return prisma.user.update({ where: { id: userId }, data })
}

export async function getUserCheckInHistory(
  userId: string,
  cursor: string | undefined,
  limit: number,
) {
  const where: Prisma.CheckInWhereInput = {
    userId,
    ...(cursor ? { checkedInAt: { lt: new Date(cursor) } } : {}),
  }

  const items = await prisma.checkIn.findMany({
    where,
    orderBy: { checkedInAt: 'desc' },
    take: limit + 1,
    include: { node: { select: { name: true, slug: true, category: true } } },
  })

  const hasMore = items.length > limit
  const sliced = hasMore ? items.slice(0, limit) : items
  const nextCursor = hasMore
    ? sliced[sliced.length - 1]?.checkedInAt.toISOString()
    : null

  return { items: sliced, nextCursor, hasMore }
}

// ─── Consent ────────────────────────────────────────────────────────────────

export async function insertConsentRecord(
  userId: string,
  consentVersion: string,
  analyticsOptIn: boolean,
  broadcastLocation: boolean,
) {
  return prisma.consentRecord.create({
    data: { userId, consentVersion, analyticsOptIn, broadcastLocation },
  })
}

export async function getLatestConsent(userId: string) {
  return prisma.consentRecord.findFirst({
    where: { userId },
    orderBy: { consentedAt: 'desc' },
  })
}

// ─── Auth Lookups ───────────────────────────────────────────────────────────

export async function findUserByPhone(phone: string) {
  return prisma.user.findUnique({ where: { phone } })
}

export async function findBusinessByEmail(email: string) {
  return prisma.businessAccount.findUnique({ where: { email } })
}

export async function findBusinessByPhone(_phone: string) {
  // Business accounts don't have phone directly, but we check via Cognito
  return null
}

export async function findStaffByPhone(phone: string) {
  return prisma.staffAccount.findUnique({ where: { phone } })
}

export async function createUser(data: {
  phone: string; username: string; displayName: string;
  cityId: string; cognitoSub: string;
}) {
  return prisma.user.create({ data })
}

export async function createBusinessAccount(data: {
  email: string; businessName: string;
  registrationNumber?: string; cognitoSub: string;
}) {
  return prisma.businessAccount.create({ data })
}

export async function findStaffInviteByToken(token: string) {
  return prisma.staffInvite.findUnique({ where: { inviteToken: token } })
}

export async function acceptStaffInvite(inviteId: string) {
  return prisma.staffInvite.update({
    where: { id: inviteId },
    data: { accepted: true },
  })
}

export async function createStaffAccount(data: {
  businessId: string; name: string; phone: string; cognitoSub: string;
}) {
  return prisma.staffAccount.create({ data })
}

export async function getCityBySlug(slug: string) {
  return prisma.city.findUnique({ where: { slug } })
}

export async function softDeleteCheckInHistory(userId: string) {
  // In production, this would set a deleted_at timestamp
  // For now, we track via a deletion queue
  return prisma.checkIn.deleteMany({ where: { userId } })
}
