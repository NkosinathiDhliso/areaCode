// Prisma-backed auth orchestration repository.
// Re-exports primitive lookups from the data-layer module and adds composite
// queries (check-in history with node enrichment, consent records, erasure
// requests) that span multiple tables.

import { prisma } from '../../shared/db/prisma.js'
import {
  getStaffById,
  getStaffByCognitoSub,
  getStaffByPhone,
  getUserByCognitoSub,
  getUserById,
  getUserByEmail,
  getUserByPhone,
  getBusinessByEmail,
  createUser as createUserDb,
  createBusiness as createBusinessDb,
  createStaff as createStaffDb,
  updateUser,
} from './dynamodb-repository.js'

export {
  getStaffById,
  getUserByCognitoSub,
  getUserById,
  getUserByEmail,
  getUserByPhone as findUserByPhone,
  getBusinessByEmail as findBusinessByEmail,
  getStaffByPhone as findStaffByPhone,
}

// ─── User Profile ───────────────────────────────────────────────────────────

export async function updateUserProfile(
  userId: string,
  data: Partial<{ displayName: string; avatarUrl: string | null; cityId: string }>,
) {
  return updateUser(userId, data)
}

export async function getUserCheckInHistory(
  userId: string,
  cursor: string | undefined,
  limit: number,
) {
  // Cursor format: ISO timestamp of the last item from the previous page.
  const cursorDate = cursor ? new Date(cursor) : null

  const rows = await prisma.checkIn.findMany({
    where: {
      userId,
      ...(cursorDate ? { checkedInAt: { lt: cursorDate } } : {}),
    },
    include: {
      node: { select: { name: true, slug: true, category: true } },
    },
    orderBy: { checkedInAt: 'desc' },
    take: limit + 1,
  })

  const hasMore = rows.length > limit
  const sliced = hasMore ? rows.slice(0, limit) : rows

  const items = sliced.map((c) => ({
    id: c.id,
    userId: c.userId,
    nodeId: c.nodeId,
    type: c.type,
    checkedInAt: c.checkedInAt.toISOString(),
    node: c.node ? { name: c.node.name, slug: c.node.slug, category: c.node.category } : null,
  }))

  const nextCursor = hasMore && sliced.length > 0 ? sliced[sliced.length - 1]!.checkedInAt.toISOString() : null

  return { items, nextCursor, hasMore }
}

// ─── Consent ────────────────────────────────────────────────────────────────

export async function insertConsentRecord(
  userId: string,
  consentVersion: string,
  analyticsOptIn: boolean,
) {
  await prisma.consentRecord.create({
    data: {
      userId,
      consentVersion,
      analyticsOptIn,
      broadcastLocation: true,
    },
  })
  return { userId, consentVersion, analyticsOptIn }
}

export async function getLatestConsent(userId: string) {
  return prisma.consentRecord.findFirst({
    where: { userId },
    orderBy: { consentedAt: 'desc' },
  })
}

// ─── Auth Lookups ───────────────────────────────────────────────────────────

export async function findStaffByCognitoSub(cognitoSub: string) {
  return getStaffByCognitoSub(cognitoSub)
}

export async function findUserByUsername(username: string) {
  if (!username) return null
  const row = await prisma.user.findUnique({ where: { username } })
  return row
}

export async function findBusinessByPhone(phone: string) {
  if (!phone) return null
  return prisma.businessAccount.findFirst({ where: { phone } })
}

// ─── User & Business Creation ───────────────────────────────────────────────

export async function createUser(data: {
  phone?: string
  email?: string
  username: string
  displayName: string
  cityId: string
  cognitoSub: string
}) {
  return createUserDb({
    phone: data.phone,
    username: data.username,
    displayName: data.displayName,
    cityId: data.cityId,
    cognitoSub: data.cognitoSub,
    musicGenres: [],
  } as Parameters<typeof createUserDb>[0])
}

export async function createBusinessAccount(data: {
  email: string
  businessName: string
  registrationNumber?: string
  cognitoSub: string
  phone?: string
}) {
  return createBusinessDb(data as Parameters<typeof createBusinessDb>[0])
}

// ─── Staff Invites ──────────────────────────────────────────────────────────

export async function findStaffInviteByToken(token: string) {
  return prisma.staffInvite.findUnique({ where: { inviteToken: token } })
}

export async function acceptStaffInvite(inviteToken: string) {
  await prisma.staffInvite.update({
    where: { inviteToken },
    data: { accepted: true },
  })
  return { accepted: true }
}

export async function createStaffAccount(data: {
  businessId: string
  name: string
  phone?: string
  email?: string
  cognitoSub: string
}) {
  return createStaffDb({ ...data, isActive: true } as Parameters<typeof createStaffDb>[0])
}

// ─── Cities ─────────────────────────────────────────────────────────────────

export async function getCityBySlug(slug: string) {
  const row = await prisma.city.findUnique({ where: { slug } })
  return row ? { id: row.id, slug: row.slug, name: row.name } : null
}

// ─── Soft Delete History (POPIA prep) ───────────────────────────────────────

export async function softDeleteCheckInHistory(userId: string) {
  // Hard-delete is preferred under Postgres because we have FK cascade and
  // ACID. The "soft delete with TTL" pattern was a DDB workaround.
  const result = await prisma.checkIn.deleteMany({ where: { userId } })
  return { count: result.count }
}

// ─── Erasure Requests ───────────────────────────────────────────────────────

export async function createErasureRequest(userId: string) {
  const row = await prisma.erasureRequest.create({
    data: { userId, status: 'pending' },
  })
  return { id: row.id, userId: row.userId, status: row.status }
}

export async function hasActiveErasureRequest(userId: string) {
  const found = await prisma.erasureRequest.findFirst({
    where: { userId, status: 'pending' },
    select: { id: true },
  })
  return !!found
}
