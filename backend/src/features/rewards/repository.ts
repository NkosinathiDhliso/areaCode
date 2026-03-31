import { prisma } from '../../shared/db/prisma.js'
import { Prisma } from '@prisma/client'

export async function createReward(data: {
  nodeId: string; type: string; title: string;
  description?: string; triggerValue?: number;
  totalSlots?: number; expiresAt?: Date;
}) {
  return prisma.reward.create({ data })
}

export async function getRewardById(id: string) {
  return prisma.reward.findUnique({
    where: { id },
    include: { node: { select: { businessId: true, name: true } } },
  })
}

export async function updateReward(
  id: string,
  data: Partial<{ title: string; description: string; isActive: boolean; expiresAt: Date | null }>,
) {
  return prisma.reward.update({ where: { id }, data })
}

export async function countActiveRewardsForBusiness(businessId: string) {
  return prisma.reward.count({
    where: { node: { businessId }, isActive: true },
  })
}

export async function getRewardsNearMe(lat: number, lng: number) {
  return prisma.$queryRaw<
    Array<{
      id: string; title: string; type: string;
      total_slots: number | null; claimed_count: number;
      node_id: string; node_name: string; node_slug: string;
      distance: number; expires_at: Date | null;
    }>
  >(Prisma.sql`
    SELECT
      r.id, r.title, r.type, r.total_slots, r.claimed_count,
      n.id AS node_id, n.name AS node_name, n.slug AS node_slug,
      ST_Distance(
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        n.location::geography
      ) AS distance,
      r.expires_at
    FROM rewards r
    JOIN nodes n ON n.id = r.node_id
    WHERE r.is_active = true
      AND n.is_active = true
      AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        n.location::geography,
        5000
      )
    ORDER BY (1.0 / NULLIF(ST_Distance(
      ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
      n.location::geography
    ), 0)) * (r.total_slots::float / NULLIF(r.total_slots - r.claimed_count + 1, 0)) DESC
    LIMIT 50
  `)
}

export async function getUnclaimedRewards(userId: string) {
  return prisma.rewardRedemption.findMany({
    where: { userId, redeemedAt: null },
    include: {
      reward: { select: { title: true, type: true, node: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function findRedemptionByCode(code: string) {
  return prisma.rewardRedemption.findFirst({
    where: { redemptionCode: code },
    include: {
      reward: { select: { title: true } },
    },
  })
}

export async function markRedeemed(redemptionId: string) {
  return prisma.rewardRedemption.update({
    where: { id: redemptionId },
    data: { redeemedAt: new Date() },
  })
}

export async function getRecentRedemptions(businessId: string, limit = 20) {
  return prisma.rewardRedemption.findMany({
    where: {
      redeemedAt: { not: null },
      reward: { node: { businessId } },
    },
    orderBy: { redeemedAt: 'desc' },
    take: limit,
    select: {
      redemptionCode: true,
      redeemedAt: true,
    },
  })
}
