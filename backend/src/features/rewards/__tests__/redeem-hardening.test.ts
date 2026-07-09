/**
 * Staff redemption hardening — `redeemReward` branch unit tests (R5.1, R5.2).
 *
 * The redeem path (`features/rewards/service.ts`) must FAIL CLOSED: it resolves
 * the code's reward and owning node BEFORE any redemption write, refuses a code
 * whose reward/node cannot be resolved (400 `invalid_code`), refuses a code for
 * a deactivated reward (400 `reward_inactive`), and always runs the
 * staff-to-business ownership check when a `staffId` is present. This suite
 * drives the real service against a mocked repository + auth layer and asserts
 * each branch.
 *
 * `redeemReward` short-circuits in DEV_MODE (returns a canned success), so the
 * suite runs with DEV_MODE OFF: env stays `dev` (so `requireEnv` keeps its
 * local defaults and nothing crashes at init) and `AREA_CODE_FORCE_LIVE` is set.
 * The service is imported dynamically AFTER the env is set because `DEV_MODE` is
 * a module-level const captured at import time (same pattern as the business
 * webhook/handler suites).
 *
 * The 8-character `redeemBodySchema` acceptance/rejection is a pure check and
 * needs no DEV_MODE handling; it is asserted at the end.
 *
 * **Validates: Requirements 5.1, 5.2, 5.4**
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'

// ─── Hoisted repository/auth mocks (spies exist before the factories run) ────

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

// `getStaffById` is dynamically imported inside `redeemReward`; vi.mock
// intercepts dynamic imports too.
vi.mock('../../auth/dynamodb-repository.js', () => ({
  getStaffById: mocks.getStaffById,
}))

// Dynamically imported on the success path only — stub so no cache work runs.
vi.mock('../../business/staff-leaderboard.js', () => ({
  clearLeaderboardCache: mocks.clearLeaderboardCache,
}))

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CODE = 'ABCD2345'
const BUSINESS_ID = 'biz-1'

/** A live, unredeemed, unexpired redemption row as `findRedemptionByCode` returns it. */
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

/** A resolvable reward with a valid owning node, as `repo.getRewardById` returns it. */
function resolvableReward(overrides: Record<string, unknown> = {}) {
  return {
    rewardId: 'reward-1',
    id: 'reward-1',
    nodeId: 'node-1',
    type: 'nth_checkin',
    title: 'Free Coffee',
    isActive: true,
    node: { businessId: BUSINESS_ID, name: 'Father Coffee' },
    ...overrides,
  }
}

// ─── Import the service with DEV_MODE OFF ────────────────────────────────────

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
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ─── R5.1: fail closed when the reward or node cannot be resolved ────────────

describe('redeemReward fails closed on an unresolvable reward/node (R5.1)', () => {
  it('rejects with 400 invalid_code when the reward row is gone', async () => {
    mocks.findRedemptionByCode.mockResolvedValue(liveRedemption())
    mocks.getRewardById.mockResolvedValue(null)

    await expect(redeemReward(CODE, 'staff-1')).rejects.toMatchObject({
      statusCode: 400,
      message: 'invalid_code',
    })

    // Fail closed: no redemption write when the reward cannot be resolved.
    expect(mocks.markRedeemed).not.toHaveBeenCalled()
  })

  it('rejects with 400 invalid_code when the reward has no owning node/business', async () => {
    mocks.findRedemptionByCode.mockResolvedValue(liveRedemption())
    mocks.getRewardById.mockResolvedValue(resolvableReward({ node: null }))

    await expect(redeemReward(CODE, 'staff-1')).rejects.toMatchObject({
      statusCode: 400,
      message: 'invalid_code',
    })
    expect(mocks.markRedeemed).not.toHaveBeenCalled()
  })

  it('rejects unknown codes with 400 invalid_code before any lookup', async () => {
    mocks.findRedemptionByCode.mockResolvedValue(null)

    await expect(redeemReward(CODE, 'staff-1')).rejects.toMatchObject({
      statusCode: 400,
      message: 'invalid_code',
    })
    expect(mocks.getRewardById).not.toHaveBeenCalled()
    expect(mocks.markRedeemed).not.toHaveBeenCalled()
  })
})

// ─── R5.2: reject codes for a deactivated reward ─────────────────────────────

describe('redeemReward rejects a deactivated reward (R5.2)', () => {
  it('rejects with 400 reward_inactive when isActive === false', async () => {
    mocks.findRedemptionByCode.mockResolvedValue(liveRedemption())
    mocks.getRewardById.mockResolvedValue(resolvableReward({ isActive: false }))

    await expect(redeemReward(CODE, 'staff-1')).rejects.toMatchObject({
      statusCode: 400,
      message: 'reward_inactive',
    })
    expect(mocks.markRedeemed).not.toHaveBeenCalled()
  })
})

// ─── Staff-ownership check always runs when staffId is present ───────────────

describe('redeemReward always runs the staff-ownership check when staffId is present', () => {
  it('rejects staff from another business with 403 (never skipped)', async () => {
    mocks.findRedemptionByCode.mockResolvedValue(liveRedemption())
    mocks.getRewardById.mockResolvedValue(resolvableReward())
    mocks.getStaffById.mockResolvedValue({ businessId: 'other-biz', isActive: true, name: 'Sipho' })

    await expect(redeemReward(CODE, 'staff-1')).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(mocks.markRedeemed).not.toHaveBeenCalled()
  })

  it('rejects a removed staff member (isActive === false) even with a valid token', async () => {
    mocks.findRedemptionByCode.mockResolvedValue(liveRedemption())
    mocks.getRewardById.mockResolvedValue(resolvableReward())
    mocks.getStaffById.mockResolvedValue({ businessId: BUSINESS_ID, isActive: false, name: 'Sipho' })

    await expect(redeemReward(CODE, 'staff-1')).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(mocks.markRedeemed).not.toHaveBeenCalled()
  })

  it('redeems when the staff member belongs to the reward business', async () => {
    mocks.findRedemptionByCode.mockResolvedValue(liveRedemption())
    mocks.getRewardById.mockResolvedValue(resolvableReward())
    mocks.getStaffById.mockResolvedValue({ businessId: BUSINESS_ID, isActive: true, name: 'Sipho' })

    const result = await redeemReward(CODE, 'staff-1')

    expect(result).toMatchObject({ success: true, rewardTitle: 'Free Coffee' })
    expect(mocks.markRedeemed).toHaveBeenCalledWith('redemption-1', 'staff-1', 'Sipho')
  })

  it('redeems without a staffId (self-serve path) once the reward resolves and is active', async () => {
    mocks.findRedemptionByCode.mockResolvedValue(liveRedemption())
    mocks.getRewardById.mockResolvedValue(resolvableReward())

    const result = await redeemReward(CODE)

    expect(result).toMatchObject({ success: true })
    expect(mocks.getStaffById).not.toHaveBeenCalled()
    expect(mocks.markRedeemed).toHaveBeenCalledWith('redemption-1', undefined, undefined)
  })
})

// ─── R5.4: the 8-character redeem schema ─────────────────────────────────────

describe('redeemBodySchema requires exactly 8 characters (R5.4)', () => {
  it('accepts an 8-character code', async () => {
    const { redeemBodySchema } = await import('../types.js')
    expect(redeemBodySchema.safeParse({ code: 'ABCD2345' }).success).toBe(true)
  })

  it('rejects codes shorter or longer than 8 characters (no dual-length window)', async () => {
    const { redeemBodySchema } = await import('../types.js')
    // The retired 6-character length is now rejected outright.
    expect(redeemBodySchema.safeParse({ code: 'ABC234' }).success).toBe(false)
    expect(redeemBodySchema.safeParse({ code: 'ABCD234' }).success).toBe(false)
    expect(redeemBodySchema.safeParse({ code: 'ABCD23456' }).success).toBe(false)
    expect(redeemBodySchema.safeParse({ code: '' }).success).toBe(false)
  })
})
