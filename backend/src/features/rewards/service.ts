import { AppError } from '../../shared/errors/AppError.js'
import { findBusinessById } from '../business/repository.js'
import * as repo from './repository.js'
import { notifyNewRewardConsumers } from '../notifications/service.js'

const DEV_REWARDS = [
  {
    id: 'rew-1',
    title: 'Free Coffee',
    type: 'freebie',
    totalSlots: 50,
    claimedCount: 12,
    nodeId: 'dev-1',
    nodeName: 'Father Coffee',
    nodeSlug: 'father-coffee',
    distance: 150,
    expiresAt: null,
  },
  {
    id: 'rew-2',
    title: '20% Off Cocktails',
    type: 'discount',
    totalSlots: 30,
    claimedCount: 8,
    nodeId: 'dev-3',
    nodeName: "Kitchener's Bar",
    nodeSlug: 'kitcheners-bar',
    distance: 800,
    expiresAt: null,
  },
  {
    id: 'rew-3',
    title: 'Free Starter',
    type: 'freebie',
    totalSlots: 20,
    claimedCount: 5,
    nodeId: 'dev-7',
    nodeName: "Nando's Rosebank",
    nodeSlug: 'nandos-rosebank',
    distance: 1200,
    expiresAt: null,
  },
  {
    id: 'rew-4',
    title: 'Buy 1 Get 1 Free',
    type: 'bogo',
    totalSlots: 100,
    claimedCount: 45,
    nodeId: 'dev-9',
    nodeName: 'The Grillhouse',
    nodeSlug: 'the-grillhouse',
    distance: 600,
    expiresAt: null,
  },
  {
    id: 'rew-5',
    title: 'Free Day Pass',
    type: 'freebie',
    totalSlots: 10,
    claimedCount: 3,
    nodeId: 'dev-10',
    nodeName: 'Virgin Active Sandton',
    nodeSlug: 'virgin-active-sandton',
    distance: 2000,
    expiresAt: null,
  },
]

const TIER_REWARD_LIMITS: Record<string, number | null> = {
  free: 3,
  starter: 3,
  growth: 10,
  pro: null,
  payg: 3,
}

export async function createReward(
  businessId: string,
  data: {
    nodeId: string
    type: string
    title: string
    description?: string | undefined
    triggerValue?: number | undefined
    totalSlots?: number | undefined
    expiresAt?: string | undefined
  },
) {
  // Verify the node belongs to this business
  const node = await repo.getNodeById(data.nodeId)
  if (!node || node.businessId !== businessId) {
    throw AppError.forbidden('Node does not belong to your business')
  }

  const business = await findBusinessById(businessId)
  const tier = business?.tier ?? 'free'
  const count = await repo.countActiveRewardsForBusiness(businessId)
  const limit = TIER_REWARD_LIMITS[tier] ?? TIER_REWARD_LIMITS['free']
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
  if (data.expiresAt !== undefined) createData.expiresAt = data.expiresAt

  const reward = await repo.createReward(createData)

  // Fire-and-forget: notify consumers who checked in at this node recently
  // This runs asynchronously so it doesn't slow down the reward creation response
  const nodeName = node.name ?? ''
  notifyNewRewardConsumers(data.nodeId, nodeName, reward.rewardId, data.title).catch(() => {
    // Silently ignore — fire-and-forget
  })

  return reward
}

export async function updateReward(
  rewardId: string,
  businessId: string,
  data: {
    title?: string | undefined
    description?: string | undefined
    isActive?: boolean | undefined
    expiresAt?: string | null | undefined
  },
) {
  const reward = await repo.getRewardById(rewardId)
  if (!reward) throw AppError.notFound('Reward not found')
  if (reward.node?.businessId !== businessId) {
    throw AppError.forbidden('You do not own this reward')
  }

  const updateData: Parameters<typeof repo.updateReward>[1] = {}
  if (data.title !== undefined) updateData.title = data.title
  if (data.description !== undefined) updateData.description = data.description
  if (data.isActive !== undefined) updateData.isActive = data.isActive
  if (data.expiresAt === null) {
    updateData.expiresAt = null
  } else if (data.expiresAt !== undefined) {
    updateData.expiresAt = data.expiresAt
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

export async function redeemReward(code: string, staffId?: string) {
  const redemption = await repo.findRedemptionByCode(code)
  if (!redemption) throw AppError.badRequest('invalid_code')
  if (redemption.redeemedAt) throw AppError.badRequest('already_redeemed')
  if (redemption.codeExpiresAt && redemption.codeExpiresAt < new Date().toISOString())
    throw AppError.badRequest('expired_code')

  // Validate staff belongs to the business that owns this reward
  const rewardId = redemption.rewardId ?? redemption.id
  let staffName: string | undefined
  if (staffId) {
    const rewardDetail = await repo.getRewardById(rewardId)
    if (rewardDetail?.node?.businessId) {
      const { getStaffById } = await import('../auth/dynamodb-repository.js')
      const staff = await getStaffById(staffId)
      if (!staff || staff.businessId !== rewardDetail.node.businessId) {
        throw AppError.forbidden('You cannot redeem rewards for this business')
      }
      staffName = staff?.name
    }
  }

  await repo.markRedeemed(redemption.id as string, staffId, staffName)
  return {
    success: true,
    rewardTitle: redemption.reward?.title ?? '',
    redeemedAt: new Date().toISOString(),
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

// ─── Staff Recent Redemptions ───────────────────────────────────────────────

export async function getStaffRecentRedemptions(staffId: string) {
  const rawItems = await repo.getStaffRecentRedemptions(staffId)
  const items = rawItems.map((r: Record<string, unknown>) => ({
    code: (r['redemptionCode'] ?? r['code'] ?? '') as string,
    rewardTitle: (r['rewardTitle'] ?? '') as string,
    displayName: (r['displayName'] ?? '') as string,
    redeemedAt: (r['redeemedAt'] ?? '') as string,
  }))
  return { items }
}
