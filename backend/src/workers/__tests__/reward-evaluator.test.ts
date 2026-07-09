/**
 * Unit tests for the reward-evaluator's `createRedemption` error handling
 * (data-integrity-ops-hardening task 3.1 / M5).
 *
 * The narrowed catch has two branches, exercised here through the exported
 * SQS `handler` (the observable boundary):
 *
 *   Branch A — `createRedemption` throws a `ConditionalCheckFailedException`
 *     (the legitimate "already claimed" signal). The evaluator treats it as
 *     already-minted and CONTINUES: the handler does NOT throw, remaining
 *     qualifying rewards are still processed, and no claimed-count increment or
 *     socket emit fires for the conflicting reward (R3.1).
 *
 *   Branch B — `createRedemption` throws any NON-conditional error (a real,
 *     likely transient fault). The evaluator does NOT silently continue: it
 *     logs and lets the error PROPAGATE so the SQS message fails and is retried
 *     — an earned reward is never silently dropped (R3.2).
 *
 * The real shared detector `isConditionalCheckFailedError`
 * (`shared/db/dynamodb.ts`) runs unmocked so the branch decision is exercised
 * end to end; only the repository and socket I/O boundaries are stubbed. No
 * live AWS.
 *
 * Validates: Requirements 3.1, 3.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks (hoisted so the factory spies exist before import) ─────────

const mocks = vi.hoisted(() => {
  return {
    getActiveRewardsForNode: vi.fn(),
    createRedemption: vi.fn(),
    incrementClaimedCount: vi.fn(async () => ({})),
    recordDrainOnMint: vi.fn(async () => undefined),
    countQualifyingVisits: vi.fn(async () => 1),
    getEffectiveThreshold: vi.fn(async () => 1),
    countCheckInsTodayAtNode: vi.fn(async () => 0),
    getRecentCheckInsForStreak: vi.fn(async () => []),
    hasCheckInInWindow: vi.fn(async () => false),
    // Socket event emitters resolve to the number of connections reached;
    // 1 = socket delivery succeeded, so the push fallback stays untouched.
    emitRewardClaimed: vi.fn(async () => 1),
    emitRewardSlotsUpdate: vi.fn(async () => 1),
    emitToast: vi.fn(async () => 1),
    emitBusinessRewardClaimed: vi.fn(async () => 1),
  }
})

vi.mock('../reward-evaluator-repository.js', () => ({
  getActiveRewardsForNode: mocks.getActiveRewardsForNode,
  createRedemption: mocks.createRedemption,
  incrementClaimedCount: mocks.incrementClaimedCount,
  recordDrainOnMint: mocks.recordDrainOnMint,
  countQualifyingVisits: mocks.countQualifyingVisits,
  countCheckInsTodayAtNode: mocks.countCheckInsTodayAtNode,
  getRecentCheckInsForStreak: mocks.getRecentCheckInsForStreak,
  hasCheckInInWindow: mocks.hasCheckInInWindow,
}))

vi.mock('../../features/rewards/threshold-lock.js', () => ({
  getEffectiveThreshold: mocks.getEffectiveThreshold,
}))

vi.mock('../../shared/socket/events.js', () => ({
  emitRewardClaimed: mocks.emitRewardClaimed,
  emitRewardSlotsUpdate: mocks.emitRewardSlotsUpdate,
  emitToast: mocks.emitToast,
  emitBusinessRewardClaimed: mocks.emitBusinessRewardClaimed,
}))

// Import AFTER mocks so the module picks up the stubbed dependencies. The real
// `isConditionalCheckFailedError` (shared/db/dynamodb.ts) is intentionally NOT
// mocked — the branch decision under test relies on the genuine detector.
import { handler } from '../reward-evaluator'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER_ID = 'user-1'
const NODE_ID = 'node-1'

/** A minimal qualifying loyalty reward: `nth_checkin` with trigger 1, and the
 *  mocked `countQualifyingVisits` returns 1, so `checkQualification` passes
 *  and the evaluator reaches the `createRedemption` call. */
function makeReward(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Reward ${id}`,
    getCategory: 'loyalty',
    type: 'nth_checkin',
    triggerValue: 1,
    totalSlots: null,
    claimedCount: 0,
    node: { name: 'Test Venue', businessId: null, city: { slug: 'johannesburg' } },
    ...overrides,
  }
}

function sqsEvent() {
  return { Records: [{ body: JSON.stringify({ userId: USER_ID, nodeId: NODE_ID, checkInId: 'ci-1' }) }] }
}

function conditionalCheckError() {
  const err = new Error('The conditional request failed')
  err.name = 'ConditionalCheckFailedException'
  return err
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.emitRewardClaimed.mockResolvedValue(1)
  mocks.countQualifyingVisits.mockResolvedValue(1)
  mocks.getEffectiveThreshold.mockResolvedValue(1)
  mocks.incrementClaimedCount.mockResolvedValue({})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

// ─── Branch A: conditional-check failure → continue (already claimed) ────────

describe('Branch A: ConditionalCheckFailedException is treated as already-claimed (R3.1)', () => {
  it('does NOT throw when createRedemption reports a conditional-check conflict', async () => {
    mocks.getActiveRewardsForNode.mockResolvedValue([makeReward('reward-a')])
    mocks.createRedemption.mockRejectedValue(conditionalCheckError())

    await expect(handler(sqsEvent())).resolves.toBeUndefined()

    // The conflicting reward is skipped: no claimed-count increment, no emit.
    expect(mocks.createRedemption).toHaveBeenCalledTimes(1)
    expect(mocks.incrementClaimedCount).not.toHaveBeenCalled()
    expect(mocks.emitRewardClaimed).not.toHaveBeenCalled()
  })

  it('continues to the next qualifying reward after a conditional conflict', async () => {
    // First reward conflicts (already claimed); the second mints cleanly.
    mocks.getActiveRewardsForNode.mockResolvedValue([makeReward('reward-a'), makeReward('reward-b')])
    mocks.createRedemption.mockRejectedValueOnce(conditionalCheckError()).mockResolvedValueOnce({ id: 'redemption-b' })

    await expect(handler(sqsEvent())).resolves.toBeUndefined()

    // Both rewards were attempted; the second one was minted (not dropped).
    expect(mocks.createRedemption).toHaveBeenCalledTimes(2)
    expect(mocks.incrementClaimedCount).toHaveBeenCalledTimes(1)
  })
})

// ─── Effective_Threshold at mint time (R3.1, R3.4) ───────────────────────────

describe('nth_checkin qualifies against the Effective_Threshold, not raw triggerValue (R3.1, R3.4)', () => {
  it('mints when visits meet the grandfathered lock even after the venue raised triggerValue', async () => {
    // Venue raised the threshold to 10, but the consumer's lock says 5.
    mocks.getActiveRewardsForNode.mockResolvedValue([makeReward('reward-a', { triggerValue: 10 })])
    mocks.countQualifyingVisits.mockResolvedValue(5)
    mocks.getEffectiveThreshold.mockResolvedValue(5)
    mocks.createRedemption.mockResolvedValue({ id: 'redemption-a' })

    await expect(handler(sqsEvent())).resolves.toBeUndefined()

    // Effective_Threshold (5) governs: 5 visits qualify, so a code is minted.
    expect(mocks.getEffectiveThreshold).toHaveBeenCalledWith(USER_ID, 'reward-a')
    expect(mocks.createRedemption).toHaveBeenCalledTimes(1)
  })

  it('does not mint when visits fall short of the Effective_Threshold', async () => {
    mocks.getActiveRewardsForNode.mockResolvedValue([makeReward('reward-a', { triggerValue: 10 })])
    mocks.countQualifyingVisits.mockResolvedValue(4)
    mocks.getEffectiveThreshold.mockResolvedValue(5)

    await expect(handler(sqsEvent())).resolves.toBeUndefined()

    expect(mocks.createRedemption).not.toHaveBeenCalled()
  })
})

// ─── Branch B: non-conditional error → propagate (SQS retries) ───────────────

describe('Branch B: a non-conditional error propagates so the message is retried (R3.2)', () => {
  it('rethrows a transient error rather than silently continuing', async () => {
    const transient = new Error('ProvisionedThroughputExceededException')
    transient.name = 'ProvisionedThroughputExceededException'
    mocks.getActiveRewardsForNode.mockResolvedValue([makeReward('reward-a')])
    mocks.createRedemption.mockRejectedValue(transient)

    await expect(handler(sqsEvent())).rejects.toThrow('ProvisionedThroughputExceededException')

    // The earned reward was NOT silently dropped: no increment, and the error
    // was logged loudly before propagating.
    expect(mocks.incrementClaimedCount).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalled()
  })

  it('propagates on the first non-conditional error without processing later rewards', async () => {
    const transient = new Error('boom')
    mocks.getActiveRewardsForNode.mockResolvedValue([makeReward('reward-a'), makeReward('reward-b')])
    mocks.createRedemption.mockRejectedValue(transient)

    await expect(handler(sqsEvent())).rejects.toThrow('boom')

    // Stopped at the first reward — the loop did not swallow-and-continue.
    expect(mocks.createRedemption).toHaveBeenCalledTimes(1)
  })
})
