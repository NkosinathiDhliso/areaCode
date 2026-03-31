import type { RewardRedemption } from '../../types'
import { hoursAgo } from '../helpers'

/**
 * At least 2 unclaimed for current user (mock-user-4), 5+ recent redeemed for staff view.
 * codeExpiresAt is 24h from creation for all entries.
 * Unclaimed entries use AC-XXXXX-NNNN format codes.
 */

/** Helper: ISO timestamp offset from hoursAgo by +24h (i.e. 24h after creation). */
function expiresAfterCreation(createdHoursAgo: number): string {
  return new Date(Date.now() - createdHoursAgo * 60 * 60 * 1000 + 24 * 60 * 60 * 1000).toISOString()
}

export const MOCK_REDEMPTIONS: RewardRedemption[] = [
  // Unclaimed for current user (mock-user-4)
  { id: 'mock-redemption-1', rewardId: 'mock-reward-3', userId: 'mock-user-4',
    redemptionCode: 'AC-KXMRT-4821', codeExpiresAt: expiresAfterCreation(0.5),
    redeemedAt: null, createdAt: hoursAgo(0.5) },
  { id: 'mock-redemption-2', rewardId: 'mock-reward-12', userId: 'mock-user-4',
    redemptionCode: 'AC-PLNWZ-7193', codeExpiresAt: expiresAfterCreation(1),
    redeemedAt: null, createdAt: hoursAgo(1) },
  // Recent redeemed — for staff view (within last 8 hours)
  { id: 'mock-redemption-3', rewardId: 'mock-reward-1', userId: 'mock-user-1',
    redemptionCode: 'AC-BQFHD-5042', codeExpiresAt: expiresAfterCreation(1.5),
    redeemedAt: hoursAgo(1), createdAt: hoursAgo(1.5) },
  { id: 'mock-redemption-4', rewardId: 'mock-reward-5', userId: 'mock-user-2',
    redemptionCode: 'AC-YVTCN-8356', codeExpiresAt: expiresAfterCreation(2.5),
    redeemedAt: hoursAgo(2), createdAt: hoursAgo(2.5) },
  { id: 'mock-redemption-5', rewardId: 'mock-reward-3', userId: 'mock-user-3',
    redemptionCode: 'AC-GJWXS-2617', codeExpiresAt: expiresAfterCreation(3.5),
    redeemedAt: hoursAgo(3), createdAt: hoursAgo(3.5) },
  { id: 'mock-redemption-6', rewardId: 'mock-reward-7', userId: 'mock-user-5',
    redemptionCode: 'AC-HNRQP-9184', codeExpiresAt: expiresAfterCreation(5),
    redeemedAt: hoursAgo(4.5), createdAt: hoursAgo(5) },
  { id: 'mock-redemption-7', rewardId: 'mock-reward-10', userId: 'mock-user-8',
    redemptionCode: 'AC-DWLMF-3729', codeExpiresAt: expiresAfterCreation(7),
    redeemedAt: hoursAgo(6.5), createdAt: hoursAgo(7) },
]
