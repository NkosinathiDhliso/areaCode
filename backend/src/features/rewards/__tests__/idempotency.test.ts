import { describe, it, expect } from 'vitest'

import { decideMint, REPEAT_WINDOW_MS, type GuardState, type RepeatPolicy } from '../repeat-policy.js'

/**
 * Loyalty Repeat Redemption — Claim_Guard idempotency and policy conditions.
 *
 * The Claim_Guard row (`REWARD_CLAIM#{rewardId}#{userId}`) is the single record
 * of a consumer's claim lifecycle for a reward. Its DynamoDB conditional write
 * (`createRedemption` in `workers/reward-evaluator-repository.ts`) transcribes
 * the accept set of the pure `decideMint` function (`repeat-policy.ts`, R2.5),
 * so these example-level unit tests drive the guard through `decideMint` and
 * assert the mint-idempotency invariants the condition expression enforces:
 *
 *   - at most one live (unredeemed, unexpired) code per (consumer, reward) (R2.1)
 *   - `once` blocks every mint after a redemption (R2.2)
 *   - `per_visit` re-mints only past the Repeat_Window (R2.3)
 *   - legacy guard rows (no redemption stamp) re-mint gated only by expiry (R2.7)
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.7**
 */

const POLICIES: readonly RepeatPolicy[] = ['once', 'per_visit']

const HOUR_MS = 60 * 60 * 1000
const CODE_TTL_MS = 24 * HOUR_MS
const NOW = Date.parse('2025-06-01T12:00:00.000Z')
const iso = (ms: number): string => new Date(ms).toISOString()

/**
 * Model the guard's conditional write under a burst of mint attempts at one
 * instant. The DynamoDB condition serializes concurrent writers: the first
 * admissible attempt writes a fresh live code (clearing `redeemedAt`), and
 * every later attempt re-evaluates against that now-live guard. Returns the
 * number of codes actually minted.
 */
function mintBurst(policy: RepeatPolicy, initial: GuardState | null, nowMs: number, attempts: number): number {
  let guard = initial
  let minted = 0
  for (let i = 0; i < attempts; i++) {
    if (decideMint(policy, guard, nowMs).mint) {
      guard = { codeExpiresAt: iso(nowMs + CODE_TTL_MS) }
      minted += 1
    }
  }
  return minted
}

describe('Feature: loyalty-repeat-redemption, one live code invariant (R2.1)', () => {
  it('a burst of concurrent mints on a fresh (consumer, reward) yields exactly one live code', () => {
    for (const policy of POLICIES) {
      expect(mintBurst(policy, null, NOW, 5)).toBe(1)
    }
  })

  it('never mints while a live unredeemed code exists', () => {
    const liveGuard: GuardState = { codeExpiresAt: iso(NOW + HOUR_MS) }
    for (const policy of POLICIES) {
      expect(decideMint(policy, liveGuard, NOW)).toEqual({ mint: false, code: 'live_code_exists' })
    }
  })
})

describe('Feature: loyalty-repeat-redemption, once blocks after redemption (R2.2)', () => {
  it('refuses to re-mint at any elapsed time after a redemption', () => {
    // A redeemed code under `once`: the entitlement is spent forever.
    const redeemedGuard: GuardState = { codeExpiresAt: iso(NOW - HOUR_MS), redeemedAt: iso(NOW - HOUR_MS) }
    for (const elapsed of [0, HOUR_MS, CODE_TTL_MS, 365 * CODE_TTL_MS]) {
      expect(decideMint('once', redeemedGuard, NOW + elapsed)).toEqual({
        mint: false,
        code: 'already_redeemed',
      })
    }
  })

  it('re-mints after an unredeemed expiry: expiry does not consume the entitlement', () => {
    // Code lapsed without a staff validation, so a new code may be minted.
    const expiredUnredeemed: GuardState = { codeExpiresAt: iso(NOW - 1) }
    expect(decideMint('once', expiredUnredeemed, NOW)).toEqual({ mint: true })
  })
})

describe('Feature: loyalty-repeat-redemption, per_visit re-mints after the Repeat_Window (R2.3)', () => {
  const redeemedAt = NOW
  // Redeemed near the end of the code's life; the code itself is now expired.
  const redeemedGuard: GuardState = { codeExpiresAt: iso(redeemedAt), redeemedAt: iso(redeemedAt) }

  it('blocks a re-mint inside the Repeat_Window even after the code has expired', () => {
    expect(decideMint('per_visit', redeemedGuard, redeemedAt + REPEAT_WINDOW_MS - 1)).toEqual({
      mint: false,
      code: 'repeat_window',
    })
  })

  it('allows a re-mint at the Repeat_Window boundary and beyond', () => {
    expect(decideMint('per_visit', redeemedGuard, redeemedAt + REPEAT_WINDOW_MS)).toEqual({ mint: true })
    expect(decideMint('per_visit', redeemedGuard, redeemedAt + 2 * REPEAT_WINDOW_MS)).toEqual({ mint: true })
  })
})

describe('Feature: loyalty-repeat-redemption, legacy guard rows behave per R2.7', () => {
  // A guard row written before this feature carries `codeExpiresAt` only: no
  // `redeemedAt`, no `lastRedeemedAt`. R2.7: such rows re-mint gated only by
  // `codeExpiresAt` (today's behaviour) until their next redemption stamps them.
  it('blocks while the legacy code is still live, for both policies', () => {
    const liveLegacy: GuardState = { codeExpiresAt: iso(NOW + HOUR_MS) }
    for (const policy of POLICIES) {
      expect(decideMint(policy, liveLegacy, NOW)).toEqual({ mint: false, code: 'live_code_exists' })
    }
  })

  it('re-mints once the legacy code has expired, for both policies', () => {
    const expiredLegacy: GuardState = { codeExpiresAt: iso(NOW - 1) }
    for (const policy of POLICIES) {
      expect(decideMint(policy, expiredLegacy, NOW)).toEqual({ mint: true })
    }
  })

  it('never yields two live codes under a concurrent mint burst', () => {
    const expiredLegacy: GuardState = { codeExpiresAt: iso(NOW - 1) }
    for (const policy of POLICIES) {
      expect(mintBurst(policy, expiredLegacy, NOW, 5)).toBe(1)
    }
  })
})
