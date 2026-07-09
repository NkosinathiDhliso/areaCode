/**
 * Loyalty Repeat Redemption — Property 4: Drain counting (worker mint-site).
 *
 * The Reward_Drain counter now lives at the mint site: the worker calls
 * `recordDrainOnMint` exactly once, and only, after a mint has fully succeeded
 * (the Claim_Guard conditional write landed AND the atomic slot-cap increment
 * held). This file pins the worker half of Property 4:
 *
 *   - the counter is touched exactly once per SUCCESSFUL mint,
 *   - a rejected mint (Claim_Guard `ConditionalCheckFailedException`) never
 *     touches it,
 *   - a slot-full rollback never touches it,
 *   - an evaluation that qualifies nothing (the shape of a presence check-in
 *     that earns no code) never touches it,
 *   - the triggering check-in's `fingerprintHash` is threaded through as
 *     evidence.
 *
 * The per-call increment itself (that one call == +1 on the DynamoDB counter,
 * keyed on `userId`) plus the flag-evidence payload are covered at the
 * repository level in `drain-flag-evidence.test.ts`. Together the two files
 * give the design's Property 4 claim: "the drain counter equals the number of
 * successful mints; presence check-ins and rejected mint attempts never change
 * it."
 *
 * Only the repository and socket I/O boundaries are stubbed; the real
 * `isConditionalCheckFailedError` (`shared/db/dynamodb.ts`) runs unmocked so the
 * mint / reject branch decision is exercised end to end. No live AWS.
 *
 * Feature: loyalty-repeat-redemption, Property 4: Drain counting
 * **Validates: Requirements 4.1, 4.2, 4.3**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'

// ─── Module mocks (hoisted so the factory spies exist before import) ─────────

const mocks = vi.hoisted(() => {
  return {
    getActiveRewardsForNode: vi.fn(),
    createRedemption: vi.fn(async (_args: { rewardId: string }) => ({ id: 'r', redemptionCount: 1 })),
    incrementClaimedCount: vi.fn(async (_rewardId: string, _slots?: number | null) => ({})),
    deleteRedemption: vi.fn(async () => undefined),
    recordDrainOnMint: vi.fn(async () => undefined),
    getClaimGuard: vi.fn(async () => null),
    countQualifyingVisits: vi.fn(async () => 0),
    getEffectiveThreshold: vi.fn(async (_userId: string, _rewardId: string) => 1),
    countCheckInsTodayAtNode: vi.fn(async () => 0),
    getRecentCheckInsForStreak: vi.fn(async () => []),
    hasCheckInInWindow: vi.fn(async () => false),
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
  deleteRedemption: mocks.deleteRedemption,
  recordDrainOnMint: mocks.recordDrainOnMint,
  getClaimGuard: mocks.getClaimGuard,
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

// Import AFTER mocks. Real `isConditionalCheckFailedError` stays unmocked.
import { handler } from '../reward-evaluator'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER_ID = 'user-1'
const NODE_ID = 'node-1'
const FINGERPRINT = 'fp-abc123'

/**
 * The four outcomes a single reward can drive through the mint site.
 *   - `mint`          qualifies, guard write lands, slot increment holds → +1
 *   - `not_qualified` visits fall short of the Effective_Threshold        → 0
 *   - `guard_reject`  qualifies but the Claim_Guard condition fails       → 0
 *   - `slot_full`     qualifies and mints, but the slot-cap increment loses → 0
 */
type Outcome = 'mint' | 'not_qualified' | 'guard_reject' | 'slot_full'

const outcomeArb = fc.constantFrom<Outcome>('mint', 'not_qualified', 'guard_reject', 'slot_full')

const QUALIFYING_VISITS = 5

function makeReward(id: string, outcome: Outcome) {
  return {
    id,
    outcome,
    title: `Reward ${id}`,
    getCategory: 'loyalty',
    type: 'nth_checkin',
    triggerValue: 1,
    // `slot_full` needs a real cap it can pass the early-out on, then lose the
    // atomic increment race. Everyone else is uncapped.
    totalSlots: outcome === 'slot_full' ? 100 : null,
    claimedCount: 0,
    node: { name: 'Test Venue', businessId: null, city: { slug: 'johannesburg' } },
  }
}

function conditionalCheckError() {
  const err = new Error('The conditional request failed')
  err.name = 'ConditionalCheckFailedException'
  return err
}

function sqsEvent(fingerprintHash?: string) {
  const body: Record<string, unknown> = { userId: USER_ID, nodeId: NODE_ID, checkInId: 'ci-1' }
  if (fingerprintHash) body['fingerprintHash'] = fingerprintHash
  return { Records: [{ body: JSON.stringify(body) }] }
}

/**
 * Wire the shared mocks to honour each reward's `outcome` tag. Qualification is
 * steered per reward via the Effective_Threshold: a fixed visit count of 5 vs a
 * threshold of 1 (qualifies) or 999 (falls short).
 */
function configureMocks(rewards: ReturnType<typeof makeReward>[]) {
  const byId = new Map(rewards.map((r) => [r.id, r.outcome]))

  mocks.getActiveRewardsForNode.mockResolvedValue(rewards)
  mocks.countQualifyingVisits.mockResolvedValue(QUALIFYING_VISITS)
  mocks.getEffectiveThreshold.mockImplementation(async (_userId: string, rewardId: string) => {
    return byId.get(rewardId) === 'not_qualified' ? 999 : 1
  })
  mocks.createRedemption.mockImplementation(async ({ rewardId }: { rewardId: string }) => {
    if (byId.get(rewardId) === 'guard_reject') throw conditionalCheckError()
    return { id: `redemption-${rewardId}`, redemptionCount: 1 }
  })
  mocks.incrementClaimedCount.mockImplementation(async (rewardId: string) => {
    if (byId.get(rewardId) === 'slot_full') throw conditionalCheckError()
    return {}
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

// ─── Property: counter fires exactly once per successful mint ────────────────

describe('Feature: loyalty-repeat-redemption, Property 4: Drain counting', () => {
  it('records the drain exactly once per successful mint, never on a rejected or rolled-back mint', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(outcomeArb, { minLength: 0, maxLength: 8 }), async (outcomes) => {
        vi.clearAllMocks()
        const rewards = outcomes.map((outcome, i) => makeReward(`reward-${i}`, outcome))
        configureMocks(rewards)

        await handler(sqsEvent(FINGERPRINT))

        const successfulMints = outcomes.filter((o) => o === 'mint').length
        // The counter is touched once per successful mint and never otherwise:
        // guard rejections and slot-full rollbacks contribute nothing (R4.1).
        expect(mocks.recordDrainOnMint).toHaveBeenCalledTimes(successfulMints)
        // Every recorded drain is keyed on the real (consumer, node) and carries
        // the triggering check-in's fingerprint as evidence (R4.1).
        for (const call of mocks.recordDrainOnMint.mock.calls) {
          expect(call).toEqual([USER_ID, NODE_ID, FINGERPRINT])
        }
      }),
      { numRuns: 300 },
    )
  })

  it('never records a drain when the evaluation qualifies nothing (presence-shaped check-in)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constant<Outcome>('not_qualified'), { minLength: 0, maxLength: 6 }),
        async (outcomes) => {
          vi.clearAllMocks()
          const rewards = outcomes.map((outcome, i) => makeReward(`reward-${i}`, outcome))
          configureMocks(rewards)

          await handler(sqsEvent(FINGERPRINT))

          // A check-in that earns no code (the observable shape of a presence
          // check-in at the mint site) never advances the drain counter (R4.2).
          expect(mocks.recordDrainOnMint).not.toHaveBeenCalled()
        },
      ),
      { numRuns: 200 },
    )
  })

  it('threads an absent fingerprint through as undefined without disabling the drain record', async () => {
    const rewards = [makeReward('reward-0', 'mint')]
    configureMocks(rewards)

    await handler(sqsEvent())

    // The drain still fires on a successful mint even with no fingerprint: the
    // check is keyed on userId, so omitting the fingerprint cannot bypass it (R4.4).
    expect(mocks.recordDrainOnMint).toHaveBeenCalledTimes(1)
    expect(mocks.recordDrainOnMint).toHaveBeenCalledWith(USER_ID, NODE_ID, undefined)
  })
})
