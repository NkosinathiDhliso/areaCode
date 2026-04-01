import type { BusinessTier, Tier } from '../types'

const TIER_ORDER: Tier[] = ['local', 'regular', 'fixture', 'institution', 'legend']

function tierAtLeast(tier: Tier | null, minTier: Tier): boolean {
  if (!tier) return false
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(minTier)
}

// Consumer feature gates
export function canCheckIn(tier: Tier | null): boolean {
  return tier !== null // Must be authenticated (any tier)
}

export function canClaimRewards(tier: Tier | null): boolean {
  return tier !== null
}

export function canViewWhoIsHere(tier: Tier | null): boolean {
  return tierAtLeast(tier, 'regular')
}

export function canParticipateInLeaderboard(tier: Tier | null): boolean {
  return tier !== null
}

export function canFollowUsers(tier: Tier | null): boolean {
  return tier !== null
}

// Business feature gates
export function getMaxNodes(tier: BusinessTier): number {
  switch (tier) {
    case 'pro': return Infinity
    case 'growth': return 5
    default: return 1
  }
}

export function getMaxActiveRewards(tier: BusinessTier): number {
  switch (tier) {
    case 'pro': return Infinity
    case 'growth': return 10
    default: return 3
  }
}

export function getMaxStaffAccounts(tier: BusinessTier): number {
  switch (tier) {
    case 'pro': return Infinity
    case 'growth': return 5
    default: return 2
  }
}

export function hasAudienceAnalytics(tier: BusinessTier): boolean {
  return tier === 'growth' || tier === 'pro'
}

export function hasExportAnalytics(tier: BusinessTier): boolean {
  return tier === 'pro'
}

export function getIncludedBoosts(tier: BusinessTier): number {
  switch (tier) {
    case 'pro': return Infinity
    case 'growth': return 3
    default: return 0
  }
}
