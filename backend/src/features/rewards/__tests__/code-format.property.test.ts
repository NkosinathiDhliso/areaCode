/**
 * Feature: loyalty-repeat-redemption, Property 6: Code format
 *
 * Every generated Redemption_Code is exactly 8 characters drawn from the
 * 32-character alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, and `redeemBodySchema`
 * accepts exactly that shape (rejecting other lengths). `generateRedemptionCode`
 * is a private helper in `workers/reward-evaluator.ts`, so it is exercised
 * through its only stable seam: the code the evaluator hands to
 * `createRedemption` when it mints. The repository + socket boundaries are
 * stubbed so the mint reaches that call with no live AWS.
 *
 * **Validates: Requirements 5.4**
 */

import * as fc from 'fast-check'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Worker mock harness (mirrors workers/__tests__/reward-evaluator.test.ts) ─

const mocks = vi.hoisted(() => ({
  getActiveRewardsForNode: vi.fn(),
  createRedemption: vi.fn(),
  incrementClaimedCount: vi.fn(async () => ({})),
  countQualifyingVisits: vi.fn(async () => 1),
  getEffectiveThreshold: vi.fn(async () => 1),
  countCheckInsTodayAtNode: vi.fn(async () => 0),
  getRecentCheckInsForStreak: vi.fn(async () => []),
  hasCheckInInWindow: vi.fn(async () => false),
  recordDrainOnMint: vi.fn(async () => undefined),
  emitRewardClaimed: vi.fn(async () => 1),
  emitRewardSlotsUpdate: vi.fn(async () => 1),
  emitToast: vi.fn(async () => 1),
  emitBusinessRewardClaimed: vi.fn(async () => 1),
}))

vi.mock('../../../workers/reward-evaluator-repository.js', () => ({
  getActiveRewardsForNode: mocks.getActiveRewardsForNode,
  createRedemption: mocks.createRedemption,
  incrementClaimedCount: mocks.incrementClaimedCount,
  countQualifyingVisits: mocks.countQualifyingVisits,
  countCheckInsTodayAtNode: mocks.countCheckInsTodayAtNode,
  getRecentCheckInsForStreak: mocks.getRecentCheckInsForStreak,
  hasCheckInInWindow: mocks.hasCheckInInWindow,
  recordDrainOnMint: mocks.recordDrainOnMint,
}))

vi.mock('../threshold-lock.js', () => ({
  getEffectiveThreshold: mocks.getEffectiveThreshold,
}))

vi.mock('../../../shared/socket/events.js', () => ({
  emitRewardClaimed: mocks.emitRewardClaimed,
  emitRewardSlotsUpdate: mocks.emitRewardSlotsUpdate,
  emitToast: mocks.emitToast,
  emitBusinessRewardClaimed: mocks.emitBusinessRewardClaimed,
}))

import { handler } from '../../../workers/reward-evaluator.js'
import { redeemBodySchema } from '../types.js'

// ─── The generated code's contract ──────────────────────────────────────────

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_RE = new RegExp(`^[${ALPHABET}]{8}$`)

/** A minimal qualifying loyalty reward so the evaluator reaches the mint. */
function qualifyingReward(id: string) {
  return {
    id,
    title: `Reward ${id}`,
    getCategory: 'loyalty',
    type: 'nth_checkin',
    triggerValue: 1,
    totalSlots: null,
    claimedCount: 0,
    node: { name: 'Test Venue', businessId: null, city: { slug: 'johannesburg' } },
  }
}

/** Run one mint and return the code the evaluator generated for it. */
async function mintOneCode(userId: string, nodeId: string, rewardId: string): Promise<string> {
  let captured = ''
  mocks.getActiveRewardsForNode.mockResolvedValue([qualifyingReward(rewardId)])
  mocks.createRedemption.mockImplementation(async (input: { redemptionCode: string }) => {
    captured = input.redemptionCode
    return { id: 'redemption-1', redemptionCount: 1 }
  })

  await handler({ Records: [{ body: JSON.stringify({ userId, nodeId, checkInId: 'ci-1' }) }] })
  return captured
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.countQualifyingVisits.mockResolvedValue(1)
  mocks.getEffectiveThreshold.mockResolvedValue(1)
  mocks.incrementClaimedCount.mockResolvedValue({})
  mocks.emitRewardClaimed.mockResolvedValue(1)
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('Feature: loyalty-repeat-redemption, Property 6: Code format', () => {
  it('generateRedemptionCode always yields 8 chars from the 32-char alphabet', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.uuid(), fc.uuid(), async (userId, nodeId, rewardId) => {
        const code = await mintOneCode(userId, nodeId, rewardId)
        expect(code).toHaveLength(8)
        expect(CODE_RE.test(code)).toBe(true)
        // Every character must be a member of the alphabet (no ambiguous 0/O/1/I/L).
        for (const ch of code) {
          expect(ALPHABET.includes(ch)).toBe(true)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('redeemBodySchema accepts every generated code shape', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.uuid(), fc.uuid(), async (userId, nodeId, rewardId) => {
        const code = await mintOneCode(userId, nodeId, rewardId)
        expect(redeemBodySchema.safeParse({ code }).success).toBe(true)
      }),
      { numRuns: 100 },
    )
  })

  it('redeemBodySchema rejects any code whose length is not 8', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 20 }).filter((s) => s.length !== 8),
        (code) => {
          expect(redeemBodySchema.safeParse({ code }).success).toBe(false)
        },
      ),
      { numRuns: 100 },
    )
  })
})
