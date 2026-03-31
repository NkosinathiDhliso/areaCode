import { prisma } from '../../shared/db/prisma.js'
import { randomBytes } from 'node:crypto'

export async function findBusinessById(id: string) {
  return prisma.businessAccount.findUnique({ where: { id } })
}

export async function findBusinessByCognitoSub(sub: string) {
  return prisma.businessAccount.findUnique({ where: { cognitoSub: sub } })
}

export async function updateBusinessTier(
  id: string,
  tier: string,
  trialEndsAt?: Date | null,
) {
  return prisma.businessAccount.update({
    where: { id },
    data: { tier, trialEndsAt },
  })
}

export async function setPaymentGrace(id: string, until: Date | null) {
  return prisma.businessAccount.update({
    where: { id },
    data: { paymentGraceUntil: until },
  })
}

export async function deactivateBusiness(id: string) {
  return prisma.businessAccount.update({
    where: { id },
    data: { tier: 'free', isActive: false },
  })
}

export async function setYocoCustomerId(id: string, yocoId: string) {
  return prisma.businessAccount.update({
    where: { id },
    data: { yocoCustomerId: yocoId },
  })
}

// Staff management
export async function countStaffForBusiness(businessId: string) {
  return prisma.staffAccount.count({
    where: { businessId, isActive: true },
  })
}

export async function createStaffInvite(
  businessId: string,
  phone?: string,
  email?: string,
) {
  const inviteToken = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
  return prisma.staffInvite.create({
    data: {
      businessId,
      inviteToken,
      invitedPhone: phone,
      invitedEmail: email,
      expiresAt,
    },
  })
}

export async function listStaffAccounts(businessId: string) {
  return prisma.staffAccount.findMany({
    where: { businessId, isActive: true },
    orderBy: { createdAt: 'desc' },
  })
}

export async function removeStaffAccount(id: string, businessId: string) {
  return prisma.staffAccount.updateMany({
    where: { id, businessId },
    data: { isActive: false },
  })
}

// Webhook events (Yoco idempotency)
export async function findWebhookEvent(eventId: string) {
  return prisma.webhookEvent.findUnique({ where: { eventId } })
}

export async function createWebhookEvent(eventId: string, eventType: string) {
  return prisma.webhookEvent.create({
    data: { eventId, eventType },
  })
}

// QR token helpers
export async function getNodeForBusiness(nodeId: string, businessId: string) {
  return prisma.node.findFirst({
    where: { id: nodeId, businessId },
  })
}

// Deactivate all rewards for a business
export async function deactivateBusinessRewards(businessId: string) {
  return prisma.reward.updateMany({
    where: { node: { businessId }, isActive: true },
    data: { isActive: false },
  })
}

// ─── Live Stats ─────────────────────────────────────────────────────────────

export async function getLiveStats(businessId: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [checkInsToday, totalCheckIns, rewardsClaimed] = await Promise.all([
    prisma.checkIn.count({
      where: { node: { businessId }, checkedInAt: { gte: today } },
    }),
    prisma.checkIn.count({
      where: { node: { businessId } },
    }),
    prisma.rewardRedemption.count({
      where: { reward: { node: { businessId } }, redeemedAt: { gte: today } },
    }),
  ])

  return { checkInsToday, rewardsClaimed, pulseScore: 0, totalCheckIns }
}

// ─── Business Nodes ─────────────────────────────────────────────────────────

export async function getNodesForBusiness(businessId: string) {
  return prisma.node.findMany({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
  })
}

// ─── Audience Analytics ─────────────────────────────────────────────────────

export async function getAudienceAnalytics(businessId: string) {
  const nodes = await prisma.node.findMany({ where: { businessId }, select: { id: true } })
  const nodeIds = nodes.map((n) => n.id)

  const uniqueUsers = await prisma.checkIn.groupBy({
    by: ['userId'],
    where: { nodeId: { in: nodeIds } },
  })

  return {
    tierDistribution: {},
    repeatVsNew: { repeat: 0, new: uniqueUsers.length },
    totalUniqueVisitors: uniqueUsers.length,
    peakHours: [],
  }
}

// ─── Music Audience ─────────────────────────────────────────────────────────

export async function getMusicAudience(_businessId: string) {
  return {
    totalWithMusicPrefs: 0,
    genreDistribution: {},
    archetypeBreakdown: {},
    peakArchetypeByTime: [],
  }
}

// ─── Recent Redemptions ─────────────────────────────────────────────────────

export async function getRecentRedemptions(businessId: string) {
  return prisma.rewardRedemption.findMany({
    where: { reward: { node: { businessId } }, redeemedAt: { not: null } },
    orderBy: { redeemedAt: 'desc' },
    take: 20,
    include: {
      reward: { select: { title: true } },
      user: { select: { displayName: true } },
    },
  })
}

// ─── Business Rewards ───────────────────────────────────────────────────────

export async function getRewardsForBusiness(businessId: string) {
  return prisma.reward.findMany({
    where: { node: { businessId } },
    orderBy: { createdAt: 'desc' },
  })
}
