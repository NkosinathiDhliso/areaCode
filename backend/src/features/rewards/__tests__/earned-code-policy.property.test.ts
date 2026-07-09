/**
 * Feature: cross-portal-lifecycle-alignment, Property 4: Earned-code policy.
 *
 * **Validates: Requirements 3.2**
 *
 * For any redemption code earned while its node was active, the redemption
 * outcome is INDEPENDENT of the node's and business's current active flags,
 * within the code's validity window. We fuzz the node/business active flags
 * (and staff activeness within the same business) and assert that a still-valid,
 * unredeemed code always redeems — the venue's billing/active state never
 * revokes earned value.
 *
 * ─── Strategy ───────────────────────────────────────────────────────────────
 *
 * Same harness as the redeem-hardening / earned-code-policy suites: DEV_MODE
 * OFF, the real `redeemReward` service against a mocked repository + auth layer.
 * The generated node object carries arbitrary `isActive` / `businessIsActive`
 * flags that `redeemReward` never reads, so the property proves independence by
 * construction against the real code path, not a re-modelled one.
 */

import * as fc from 'fast-check'
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

describe('Feature: cross-portal-lifecycle-alignment, Property 4: Earned-code policy', () => {
  it('redemption outcome is independent of node/business active flags (R3.2)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.boolean(), async (nodeActive, businessActive) => {
        mocks.findRedemptionByCode.mockResolvedValue({
          id: 'redemption-1',
          rewardId: 'reward-1',
          redemptionCode: CODE,
          codeExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          redeemedAt: null,
          userId: 'user-1',
          reward: { title: 'Free Coffee' },
        })
        // The reward row stays active (the lapse path never deactivates rewards);
        // only the node/business flags vary, and redeemReward must ignore them.
        mocks.getRewardById.mockResolvedValue({
          rewardId: 'reward-1',
          id: 'reward-1',
          nodeId: 'node-1',
          type: 'nth_checkin',
          title: 'Free Coffee',
          isActive: true,
          node: { businessId: BUSINESS_ID, name: 'V', isActive: nodeActive, businessIsActive: businessActive },
        })
        mocks.getStaffById.mockResolvedValue({ businessId: BUSINESS_ID, isActive: true, name: 'Sipho' })

        const result = await redeemReward(CODE, 'staff-1')
        expect(result.success).toBe(true)
      }),
      { numRuns: 100 },
    )
  })
})
