import { prisma } from '../shared/db/prisma.js'

/**
 * Repository layer for reward-evaluator worker.
 * All Prisma calls isolated here — zero business logic.
 */

export async function getActiveRewardsForNode(nodeId: string) {
  return prisma.reward.findMany({
    where: { nodeId, isActive: true },
    include: { node: { select: { name: true, businessId: true, city: { select: { slug: true } } } } },
  })
}

export async function createRedemption(data: {
  rewardId: string
  userId: string
  redemptionCode: string
  codeExpiresAt: Date
}) {
  return prisma.rewardRedemption.create({ data })
}

export async function incrementClaimedCount(rewardId: string) {
  return prisma.reward.update({
    where: { id: rewardId },
    data: { claimedCount: { increment: 1 } },
  })
}

export async function countUserCheckInsAtNode(
  userId: string,
  nodeId: string,
) {
  return prisma.checkIn.count({
    where: { userId, nodeId, type: 'reward' },
  })
}

export async function countCheckInsTodayAtNode(nodeId: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return prisma.checkIn.count({
    where: { nodeId, checkedInAt: { gte: today } },
  })
}

export async function getRecentCheckInsForStreak(
  userId: string,
  nodeId: string,
  limit: number,
) {
  return prisma.checkIn.findMany({
    where: { userId, nodeId, type: 'reward' },
    orderBy: { checkedInAt: 'desc' },
    take: limit,
    select: { checkedInAt: true },
  })
}
