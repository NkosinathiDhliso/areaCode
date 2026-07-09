/**
 * Earned_Code_Policy — redeem side (cross-portal-lifecycle-alignment task 3.3).
 *
 * Decided policy (R3.2): a redemption code earned while its node was active stays
 * redeemable through its existing validity window even after the node and its
 * business go inactive (a non-payment demotion sets both flags but never touches
 * the reward or the already-issued code). This turns today's accidental behaviour
 * — `redeemReward` reads `reward.isActive` and staff state, never node/business
 * active flags — into a pinned contract so it cannot silently regress.
 *
 * The validity window still bounds it: an expired code is refused, and an
 * explicitly deactivated reward (a different, deliberate admin action) is refused.
 *
 * Reuses the redeem-hardening harness: DEV_MODE OFF, real service against a mocked
 * repository + auth layer.
 *
 * **Validates: Requirements 3.2, 3.3**
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'

const mocks = vi.hoisted(() => ({
  findRedemptionByCode: vi.fn(),
  getRewardById: vi.fn(),
  markRedeemed: vi.fn(async () => undefined),
  getStaffById: vi.fn(),
  clearLeaderboardCache: vi.fn(),
}))

vi.mock('../repository.js', () => ({
  findRedemptionByCode: mocks.findRedemptionByCode,
  getRewardById: mocks.getRewardById,
  markRedeemed: mocks.markRedeemed,
}))

vi.mock('../../auth/dynamodb-repository.js', () => ({
  getStaffById: mocks.getStaffById,
}))

vi.mock('../../business/staff-leaderboard.js', () => ({
  clearLeaderboardCache: mocks.clearLeaderboardCache,
}))

const CODE = 'ABCD2345'
const BUSINESS_ID = 'biz-1'

function liveRedemption(overrides: Record<string, unknown> = {}) {
  return {
    id: 'redemption-1',
    rewardId: 'reward-1',
    redemptionCode: CODE,
    codeExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    redeemedAt: null,
    userId: 'user-1',
    reward: { title: 'Free Coffee' },
    ...overrides,
  }
}

// A reward whose OWNING NODE and BUSINESS are inactive, but whose reward row is
// still active (the lapse path deactivates the business + nodes, never rewards).
function rewardAtLapsedVenue(overrides: Record<string, unknown> = {}) {
  return {
    rewardId: 'reward-1',
    id: 'reward-1',
    nodeId: 'node-1',
    type: 'nth_checkin',
    title: 'Free Coffee',
    isActive: true,
    node: { businessId: BUSINESS_ID, name: 'Father Coffee', isActive: false, businessIsActive: false },
    ...overrides,
  }
}

let redeemReward: (typeof import('../service.js'))['redeemReward']

beforeAll(async () => {
  process.env['AREA_CODE_ENV'] = 'dev'
  process.env['AREA_CODE_FORCE_LIVE'] = '1'
  ;({ redeemReward } = await import('../service.js'))
})

afterAll(() => {
  delete process.env['AREA_CODE_FORCE_LIVE']
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Earned_Code_Policy: earned codes redeem at a lapsed venue (R3.2)', () => {
  it('redeems a still-valid code even though the node and business are inactive', async () => {
    mocks.findRedemptionByCode.mockResolvedValue(liveRedemption())
    mocks.getRewardById.mockResolvedValue(rewardAtLapsedVenue())
    mocks.getStaffById.mockResolvedValue({ businessId: BUSINESS_ID, isActive: true, name: 'Sipho' })

    const result = await redeemReward(CODE, 'staff-1')

    expect(result).toMatchObject({ success: true, rewardTitle: 'Free Coffee' })
    expect(mocks.markRedeemed).toHaveBeenCalledWith('redemption-1', 'staff-1', 'Sipho')
  })

  it('redeems on the self-serve path (no staff) at a lapsed venue', async () => {
    mocks.findRedemptionByCode.mockResolvedValue(liveRedemption())
    mocks.getRewardById.mockResolvedValue(rewardAtLapsedVenue())

    const result = await redeemReward(CODE)
    expect(result).toMatchObject({ success: true })
    expect(mocks.markRedeemed).toHaveBeenCalled()
  })
})

describe('Earned_Code_Policy: the validity window still bounds redemption (R3.2)', () => {
  it('refuses an expired code even at an otherwise-fine venue', async () => {
    mocks.findRedemptionByCode.mockResolvedValue(
      liveRedemption({ codeExpiresAt: new Date(Date.now() - 60 * 1000).toISOString() }),
    )

    await expect(redeemReward(CODE, 'staff-1')).rejects.toMatchObject({ message: 'expired_code' })
    expect(mocks.markRedeemed).not.toHaveBeenCalled()
  })

  it('refuses a code whose reward was explicitly deactivated (distinct from a lapse)', async () => {
    mocks.findRedemptionByCode.mockResolvedValue(liveRedemption())
    mocks.getRewardById.mockResolvedValue(rewardAtLapsedVenue({ isActive: false }))

    await expect(redeemReward(CODE, 'staff-1')).rejects.toMatchObject({ message: 'reward_inactive' })
    expect(mocks.markRedeemed).not.toHaveBeenCalled()
  })
})
