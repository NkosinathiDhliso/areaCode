/**
 * Loyalty Repeat Redemption — Property 4: Drain counting (mint-site record).
 *
 * The worker-level property test (`drain-counting.property.test.ts`) pins WHEN
 * the drain counter is touched (once per successful mint, never otherwise).
 * This file pins WHAT `recordDrainOnMint` does on each call:
 *
 *   - it increments the per-(consumer, node) counter keyed on `userId`, with the
 *     24h TTL, so omitting `fingerprintHash` can never bypass it (R4.1, R4.4),
 *   - it stays silent at or below the threshold and raises a high-priority
 *     `reward_drain` flag only once the count exceeds it (R4.3),
 *   - the flag payload carries the actual mint timestamps inside the 24h window
 *     as evidence, with out-of-window and other-node redemptions filtered out
 *     (R8.3),
 *   - it never throws: a counter failure is swallowed and logged, so an
 *     already-successful mint is never affected (R4.2 — presence/mint safety).
 *
 * The kv counter, the redemption read, and the shared abuse-flag writer are the
 * only boundaries stubbed. No live AWS.
 *
 * Feature: loyalty-repeat-redemption, Property 4: Drain counting
 * **Validates: Requirements 4.1, 4.2, 4.3**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks (hoisted) ──────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  return {
    kvIncr: vi.fn(async () => 1),
    getRedemptionsByUserId: vi.fn(async () => [] as Array<{ nodeId?: string; createdAt: string }>),
    getActiveRewardsByNodeId: vi.fn(async () => []),
    writeAbuseFlag: vi.fn(
      async (
        _entityId: string,
        _flag: { type: string; evidence: Record<string, unknown>; priority?: 'normal' | 'high' },
      ) => undefined,
    ),
  }
})

vi.mock('../../shared/kv/dynamodb-kv.js', () => ({
  kvIncr: mocks.kvIncr,
}))

vi.mock('../../features/rewards/dynamodb-repository.js', () => ({
  getRedemptionsByUserId: mocks.getRedemptionsByUserId,
  getActiveRewardsByNodeId: mocks.getActiveRewardsByNodeId,
}))

vi.mock('../../features/check-in/abuse.js', () => ({
  writeAbuseFlag: mocks.writeAbuseFlag,
}))

// Import the real repository AFTER mocks so `recordDrainOnMint` picks up the
// stubbed kv / redemption / abuse-flag boundaries.
import { recordDrainOnMint } from '../reward-evaluator-repository'

const USER_ID = 'user-1'
const NODE_ID = 'node-1'
const FINGERPRINT = 'fp-abc123'
const DRAIN_KEY = `abuse:drain:${USER_ID}:${NODE_ID}`
const DRAIN_TTL_SECONDS = 24 * 60 * 60
const HOUR_MS = 60 * 60 * 1000

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ─── The counter is keyed on userId with the 24h TTL ─────────────────────────

describe('Feature: loyalty-repeat-redemption, Property 4: drain counter keying (R4.1, R4.4)', () => {
  it('increments the per-(consumer, node) counter keyed on userId with the 24h TTL', async () => {
    mocks.kvIncr.mockResolvedValue(1)

    await recordDrainOnMint(USER_ID, NODE_ID, FINGERPRINT)

    expect(mocks.kvIncr).toHaveBeenCalledTimes(1)
    expect(mocks.kvIncr).toHaveBeenCalledWith(DRAIN_KEY, DRAIN_TTL_SECONDS)
  })

  it('uses the same userId-keyed counter whether or not a fingerprint is supplied', async () => {
    mocks.kvIncr.mockResolvedValue(1)

    await recordDrainOnMint(USER_ID, NODE_ID)

    // No fingerprint → the counter key is unchanged, so the check still runs (R4.4).
    expect(mocks.kvIncr).toHaveBeenCalledWith(DRAIN_KEY, DRAIN_TTL_SECONDS)
  })
})

// ─── Threshold behaviour: silent at/below, flag above ────────────────────────

describe('Feature: loyalty-repeat-redemption, Property 4: drain threshold (R4.3)', () => {
  it('does not raise a flag at or below the threshold of 3 mints', async () => {
    for (const count of [1, 2, 3]) {
      vi.clearAllMocks()
      mocks.kvIncr.mockResolvedValue(count)

      await recordDrainOnMint(USER_ID, NODE_ID, FINGERPRINT)

      expect(mocks.writeAbuseFlag).not.toHaveBeenCalled()
      // No redemption read is needed when the flag will not be written.
      expect(mocks.getRedemptionsByUserId).not.toHaveBeenCalled()
    }
  })

  it('raises a single high-priority reward_drain flag once the count exceeds 3', async () => {
    mocks.kvIncr.mockResolvedValue(4)
    mocks.getRedemptionsByUserId.mockResolvedValue([])

    await recordDrainOnMint(USER_ID, NODE_ID, FINGERPRINT)

    expect(mocks.writeAbuseFlag).toHaveBeenCalledTimes(1)
    const [entityId, flag] = mocks.writeAbuseFlag.mock.calls[0]!
    expect(entityId).toBe(USER_ID)
    expect(flag.type).toBe('reward_drain')
    expect(flag.priority).toBe('high')
    expect(flag.evidence).toMatchObject({
      userId: USER_ID,
      nodeId: NODE_ID,
      mintCount: 4,
      windowHours: 24,
      fingerprintHash: FINGERPRINT,
    })
  })
})

// ─── Flag evidence carries the in-window mint timestamps (R8.3) ──────────────

describe('Feature: loyalty-repeat-redemption, Property 4: flag evidence timestamps (R8.3)', () => {
  it('carries the mint timestamps inside the 24h window, excluding stale and other-node redemptions', async () => {
    const now = Date.now()
    const inWindowA = new Date(now - 1 * HOUR_MS).toISOString()
    const inWindowB = new Date(now - 2 * HOUR_MS).toISOString()
    const staleOutOfWindow = new Date(now - 25 * HOUR_MS).toISOString()
    const otherNodeRecent = new Date(now - 1000).toISOString()

    mocks.kvIncr.mockResolvedValue(5)
    mocks.getRedemptionsByUserId.mockResolvedValue([
      { nodeId: NODE_ID, createdAt: inWindowA },
      { nodeId: NODE_ID, createdAt: inWindowB },
      { nodeId: NODE_ID, createdAt: staleOutOfWindow },
      { nodeId: 'node-other', createdAt: otherNodeRecent },
    ])

    await recordDrainOnMint(USER_ID, NODE_ID, FINGERPRINT)

    const [, flag] = mocks.writeAbuseFlag.mock.calls[0]!
    const mintTimestamps = (flag.evidence as { mintTimestamps: string[] }).mintTimestamps
    // Only this node's redemptions inside the 24h window are evidence (R8.3).
    expect(mintTimestamps).toEqual([inWindowA, inWindowB])
  })

  it('omits fingerprintHash from evidence when the triggering check-in carried none', async () => {
    mocks.kvIncr.mockResolvedValue(4)
    mocks.getRedemptionsByUserId.mockResolvedValue([])

    await recordDrainOnMint(USER_ID, NODE_ID)

    const [, flag] = mocks.writeAbuseFlag.mock.calls[0]!
    expect(flag.evidence).not.toHaveProperty('fingerprintHash')
  })
})

// ─── Never throws: a counter failure cannot affect the successful mint ───────

describe('Feature: loyalty-repeat-redemption, Property 4: drain is non-blocking (R4.2)', () => {
  it('swallows and logs a counter failure without throwing', async () => {
    mocks.kvIncr.mockRejectedValue(new Error('kv boom'))

    await expect(recordDrainOnMint(USER_ID, NODE_ID, FINGERPRINT)).resolves.toBeUndefined()

    expect(mocks.writeAbuseFlag).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalled()
  })
})
