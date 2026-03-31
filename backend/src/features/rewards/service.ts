import { AppError } from '../../shared/errors/AppError.js'
import * as repo from './repository.js'

const TIER_REWARD_LIMITS: Record<string, number | null> = {
  free: 3, starter: 3, growth: 10, pro: null, payg: 3,
}

export async function createReward(
  businessId: string,
  data: {
    nodeId: string; type: string; title: string;
    description?: string | undefined; triggerValue?: number | undefined;
    totalSlots?: number | undefined; expiresAt?: string | undefined;
  },
) {
  const count = await repo.countActiveRewardsForBusiness(businessId)
  const limit = TIER_REWARD_LIMITS['growth']
  if (limit !== undefined && limit !== null && count >= limit) {
    throw AppError.forbidden('Active reward limit reached for your tier')
  }

  const createData: Parameters<typeof repo.createReward>[0] = {
    nodeId: data.nodeId,
    type: data.type,
    title: data.title,
  }
  if (data.description !== undefined) createData.description = data.description
  if (data.triggerValue !== undefined) createData.triggerValue = data.triggerValue
  if (data.totalSlots !== undefined) createData.totalSlots = data.totalSlots
  if (data.expiresAt !== undefined) createData.expiresAt = new Date(data.expiresAt)

  return repo.createReward(createData)
}

export async function updateReward(
  rewardId: string,
  businessId: string,
  data: {
    title?: string | undefined;
    description?: string | undefined;
    isActive?: boolean | undefined;
    expiresAt?: string | null | undefined;
  },
) {
  const reward = await repo.getRewardById(rewardId)
  if (!reward) throw AppError.notFound('Reward not found')
  if (reward.node.businessId !== businessId) {
    throw AppError.forbidden('You do not own this reward')
  }

  const updateData: Parameters<typeof repo.updateReward>[1] = {}
  if (data.title !== undefined) updateData.title = data.title
  if (data.description !== undefined) updateData.description = data.description
  if (data.isActive !== undefined) updateData.isActive = data.isActive
  if (data.expiresAt === null) {
    updateData.expiresAt = null
  } else if (data.expiresAt !== undefined) {
    updateData.expiresAt = new Date(data.expiresAt)
  }

  return repo.updateReward(rewardId, updateData)
}

export async function getRewardsNearMe(lat: number, lng: number) {
  const raw = await repo.getRewardsNearMe(lat, lng)
  return raw.map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    totalSlots: r.total_slots,
    claimedCount: r.claimed_count,
    nodeId: r.node_id,
    nodeName: r.node_name,
    nodeSlug: r.node_slug,
    distance: Math.round(r.distance),
    expiresAt: r.expires_at?.toISOString() ?? null,
  }))
}

export async function getUnclaimedRewards(userId: string) {
  return repo.getUnclaimedRewards(userId)
}

export async function redeemReward(code: string) {
  const redemption = await repo.findRedemptionByCode(code)
  if (!redemption) throw AppError.badRequest('invalid_code')
  if (redemption.redeemedAt) throw AppError.badRequest('already_redeemed')
  if (redemption.codeExpiresAt < new Date()) throw AppError.badRequest('expired_code')

  const updated = await repo.markRedeemed(redemption.id)
  return {
    success: true,
    rewardTitle: redemption.reward.title,
    redeemedAt: updated.redeemedAt?.toISOString(),
  }
}

export async function getRecentRedemptions(businessId: string) {
  const items = await repo.getRecentRedemptions(businessId)
  return {
    items: items.map((r) => ({
      code: r.redemptionCode,
      redeemedAt: r.redeemedAt?.toISOString(),
    })),
  }
}
