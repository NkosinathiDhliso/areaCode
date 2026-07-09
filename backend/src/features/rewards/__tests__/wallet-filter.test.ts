/**
 * Wallet dead-code filter — `getUnclaimedRewards` unit tests (R5.3).
 *
 * The consumer wallet (`GET /v1/users/me/unclaimed-rewards`) must never show a
 * code the staff validator will refuse. `getUnclaimedRewards`
 * (`features/rewards/repository.ts`) therefore reuses the reward-enrichment
 * lookup to DROP any redemption whose reward is deleted (no row) or deactivated
 * (`isActive === false`), on top of the existing not-redeemed / not-expired
 * filter.
 *
 * The real repository runs against a mocked DynamoDB layer
 * (`dynamodb-repository.js`), so the filter logic is exercised without any live
 * AWS. Node lookups are stubbed to a valid name so the enrichment path never
 * falls through to a real read.
 *
 * **Validates: Requirement 5.3**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRedemptionsByUserId: vi.fn(),
  getRewardById: vi.fn(),
  getNodeById: vi.fn(async () => ({ name: 'Father Coffee' })),
}))

// Partially mock the low-level dynamo repository the real repository.js
// delegates to: override only the two reads `getUnclaimedRewards` uses, and
// keep the rest real so repository.js's module-load re-exports (e.g.
// `getActiveRewardsByNodeId`) still resolve.
vi.mock('../dynamodb-repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../dynamodb-repository.js')>()
  return {
    ...actual,
    getRedemptionsByUserId: mocks.getRedemptionsByUserId,
    getRewardById: mocks.getRewardById,
  }
})

// `getNodeById` is re-exported from repository.js via the nodes repo.
vi.mock('../../nodes/dynamodb-repository.js', () => ({
  getNodeById: mocks.getNodeById,
}))

import { getUnclaimedRewards } from '../repository.js'

const USER_ID = 'user-1'
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

/** An active (unredeemed, unexpired) redemption row keyed to a reward. */
function redemption(id: string, rewardId: string, overrides: Record<string, unknown> = {}) {
  return {
    redemptionId: id,
    rewardId,
    redemptionCode: `CODE${id}`,
    codeExpiresAt: FUTURE,
    redeemedAt: null,
    rewardTitle: `Reward ${rewardId}`,
    nodeName: 'Father Coffee',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getNodeById.mockResolvedValue({ name: 'Father Coffee' })
})

describe('getUnclaimedRewards excludes codes for dead rewards (R5.3)', () => {
  it('drops a code whose reward was deleted (no reward row)', async () => {
    mocks.getRedemptionsByUserId.mockResolvedValue([redemption('a', 'reward-gone')])
    mocks.getRewardById.mockResolvedValue(null)

    const wallet = await getUnclaimedRewards(USER_ID)

    expect(wallet).toEqual([])
  })

  it('drops a code whose reward is deactivated (isActive === false)', async () => {
    mocks.getRedemptionsByUserId.mockResolvedValue([redemption('a', 'reward-off')])
    mocks.getRewardById.mockResolvedValue({
      rewardId: 'reward-off',
      title: 'Free Coffee',
      type: 'nth_checkin',
      nodeId: 'node-1',
      isActive: false,
    })

    const wallet = await getUnclaimedRewards(USER_ID)

    expect(wallet).toEqual([])
  })

  it('keeps a code whose reward is live and active', async () => {
    mocks.getRedemptionsByUserId.mockResolvedValue([redemption('a', 'reward-live')])
    mocks.getRewardById.mockResolvedValue({
      rewardId: 'reward-live',
      title: 'Free Coffee',
      type: 'nth_checkin',
      nodeId: 'node-1',
      isActive: true,
    })

    const wallet = await getUnclaimedRewards(USER_ID)

    expect(wallet).toHaveLength(1)
    expect(wallet[0]).toMatchObject({ id: 'a', redemptionCode: 'CODEa' })
  })

  it('keeps only the live-reward codes out of a mixed set', async () => {
    mocks.getRedemptionsByUserId.mockResolvedValue([
      redemption('live', 'reward-live'),
      redemption('deleted', 'reward-gone'),
      redemption('inactive', 'reward-off'),
    ])
    mocks.getRewardById.mockImplementation(async (rewardId: string) => {
      if (rewardId === 'reward-live') {
        return { rewardId, title: 'Live', type: 'nth_checkin', nodeId: 'node-1', isActive: true }
      }
      if (rewardId === 'reward-off') {
        return { rewardId, title: 'Off', type: 'nth_checkin', nodeId: 'node-1', isActive: false }
      }
      return null // reward-gone: deleted
    })

    const wallet = await getUnclaimedRewards(USER_ID)

    expect(wallet.map((w) => w.id)).toEqual(['live'])
  })
})
