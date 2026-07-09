import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import {
  decideMint,
  REPEAT_WINDOW_MS,
  type RepeatPolicy,
  type GuardState,
  type MintDecision,
} from '../repeat-policy.js'

/**
 * Loyalty Repeat Redemption — pure mint-decision property tests.
 *
 * Covers Property 1 (Mint decision truth table) and Property 2 (Redemption
 * spacing) from the design doc. `decideMint` is the tested source of truth the
 * DynamoDB condition expression transcribes.
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
 */

// ─── Shared generators ──────────────────────────────────────────────────────

/** Bound epoch-ms generation to a sane real-world range so ISO strings parse. */
const EPOCH_MIN = Date.parse('2000-01-01T00:00:00.000Z')
const EPOCH_MAX = Date.parse('2100-01-01T00:00:00.000Z')

const epochMsArb = fc.integer({ min: EPOCH_MIN, max: EPOCH_MAX })

const policyArb = fc.constantFrom<RepeatPolicy>('once', 'per_visit')

/** ISO-8601 UTC ms string from epoch ms, matching how the guard stores them. */
const iso = (ms: number): string => new Date(ms).toISOString()

/**
 * A guard-state shape carried in epoch ms so the test can reason numerically,
 * plus a builder that renders it into the ISO-string `GuardState` decideMint
 * consumes. `null` models "no guard row".
 */
interface GuardFacts {
  expiresMs: number
  redeemedMs?: number
}

const guardFactsArb = fc.option(
  fc.record({
    expiresMs: epochMsArb,
    redeemedMs: fc.option(epochMsArb, { nil: undefined }),
  }),
  { nil: null },
)

const toGuardState = (facts: GuardFacts | null): GuardState | null => {
  if (facts === null) return null
  const guard: GuardState = { codeExpiresAt: iso(facts.expiresMs) }
  if (facts.redeemedMs !== undefined) guard.redeemedAt = iso(facts.redeemedMs)
  return guard
}

/**
 * Independent re-derivation of the design truth table straight from the raw
 * facts. This is deliberately NOT a copy of decideMint's control flow: it reads
 * the table row by row so a drift in the implementation is caught.
 */
const expectedDecision = (policy: RepeatPolicy, facts: GuardFacts | null, nowMs: number): MintDecision => {
  if (facts === null) return { mint: true }
  if (facts.redeemedMs !== undefined) {
    if (policy === 'once') return { mint: false, code: 'already_redeemed' }
    return nowMs - facts.redeemedMs >= REPEAT_WINDOW_MS ? { mint: true } : { mint: false, code: 'repeat_window' }
  }
  return nowMs < facts.expiresMs ? { mint: false, code: 'live_code_exists' } : { mint: true }
}

// ─── Property 1: Mint decision truth table ──────────────────────────────────

describe('Feature: loyalty-repeat-redemption, Property 1: Mint decision truth table', () => {
  it('matches the design truth table across the full (policy, guard, now) cross product', () => {
    fc.assert(
      fc.property(policyArb, guardFactsArb, epochMsArb, (policy, facts, nowMs) => {
        const actual = decideMint(policy, toGuardState(facts), nowMs)
        expect(actual).toEqual(expectedDecision(policy, facts, nowMs))
      }),
      { numRuns: 500 },
    )
  })

  it('never mints while a live unredeemed code exists (R2.1)', () => {
    // Force a live, never-redeemed code: expiry strictly after now.
    const liveGuard = fc
      .tuple(epochMsArb, fc.integer({ min: 1, max: 24 * 60 * 60 * 1000 }))
      .map(([nowMs, remainingMs]) => ({ nowMs, expiresMs: nowMs + remainingMs }))

    fc.assert(
      fc.property(policyArb, liveGuard, (policy, { nowMs, expiresMs }) => {
        const decision = decideMint(policy, { codeExpiresAt: iso(expiresMs) }, nowMs)
        expect(decision).toEqual({ mint: false, code: 'live_code_exists' })
      }),
      { numRuns: 200 },
    )
  })

  it('once never mints after any redemption, regardless of elapsed time (R2.2)', () => {
    // A redeemed code under `once`: any expiry, any redeem time, any clock.
    fc.assert(
      fc.property(epochMsArb, epochMsArb, epochMsArb, (expiresMs, redeemedMs, nowMs) => {
        const decision = decideMint('once', { codeExpiresAt: iso(expiresMs), redeemedAt: iso(redeemedMs) }, nowMs)
        expect(decision).toEqual({ mint: false, code: 'already_redeemed' })
      }),
      { numRuns: 200 },
    )
  })

  it('per_visit respects the Repeat_Window even after codeExpiresAt has passed (R2.3)', () => {
    // Redeemed near the end of the code's life, code already expired, but the
    // redemption is still inside the Repeat_Window: mint must be blocked.
    const insideWindow = fc
      .tuple(epochMsArb, fc.integer({ min: 0, max: REPEAT_WINDOW_MS - 1 }))
      .map(([redeemedMs, sinceRedeemMs]) => ({ redeemedMs, nowMs: redeemedMs + sinceRedeemMs }))

    fc.assert(
      fc.property(insideWindow, ({ redeemedMs, nowMs }) => {
        // Expiry strictly before now: the code is expired, yet the window guards.
        const guard: GuardState = { codeExpiresAt: iso(nowMs - 1), redeemedAt: iso(redeemedMs) }
        expect(decideMint('per_visit', guard, nowMs)).toEqual({ mint: false, code: 'repeat_window' })
      }),
      { numRuns: 200 },
    )
  })

  it('per_visit mints once the Repeat_Window has fully elapsed since redemption (R2.3)', () => {
    const pastWindow = fc
      .tuple(epochMsArb, fc.integer({ min: REPEAT_WINDOW_MS, max: 30 * 24 * 60 * 60 * 1000 }))
      .map(([redeemedMs, sinceRedeemMs]) => ({ redeemedMs, nowMs: redeemedMs + sinceRedeemMs }))

    fc.assert(
      fc.property(pastWindow, ({ redeemedMs, nowMs }) => {
        const guard: GuardState = { codeExpiresAt: iso(redeemedMs), redeemedAt: iso(redeemedMs) }
        expect(decideMint('per_visit', guard, nowMs)).toEqual({ mint: true })
      }),
      { numRuns: 200 },
    )
  })
})

// ─── Property 2: Redemption spacing ─────────────────────────────────────────

/**
 * Event-sequence model. The guard evolves exactly as the design's conditional
 * writes describe: a successful mint clears `redeemedAt` and sets a fresh
 * expiry; a staff redemption stamps `redeemedAt` onto the current live code.
 * `decideMint` gates every mint, so the model can only reach admissible states.
 */
type SimEvent = { kind: 'mint' | 'redeem' | 'advance'; deltaMs: number }

const CODE_TTL_MS = 24 * 60 * 60 * 1000

const eventArb = fc.record({
  kind: fc.constantFrom<'mint' | 'redeem' | 'advance'>('mint', 'redeem', 'advance'),
  // Deltas straddle the Repeat_Window so both within- and past-window paths run.
  deltaMs: fc.integer({ min: 0, max: 6 * 60 * 60 * 1000 }),
})

const runSequence = (policy: RepeatPolicy, startMs: number, events: SimEvent[]): number[] => {
  let now = startMs
  let guard: GuardState | null = null
  const redemptions: number[] = []

  for (const ev of events) {
    now += ev.deltaMs
    if (ev.kind === 'mint') {
      if (decideMint(policy, guard, now).mint) {
        // Fresh live code; redeemedAt cleared (design: REMOVE redeemedAt).
        guard = { codeExpiresAt: iso(now + CODE_TTL_MS) }
      }
    } else if (ev.kind === 'redeem') {
      // Staff can only validate a live, not-yet-redeemed code.
      const live = guard !== null && guard.redeemedAt === undefined && now < Date.parse(guard.codeExpiresAt)
      if (live && guard !== null) {
        guard = { codeExpiresAt: guard.codeExpiresAt, redeemedAt: iso(now) }
        redemptions.push(now)
      }
    }
    // 'advance' only moves the clock.
  }

  return redemptions
}

describe('Feature: loyalty-repeat-redemption, Property 2: Redemption spacing', () => {
  it('per_visit redemptions of one (consumer, reward) are at least 4h apart (R2.3, R2.4)', () => {
    fc.assert(
      fc.property(epochMsArb, fc.array(eventArb, { minLength: 0, maxLength: 40 }), (startMs, events) => {
        const redemptions = runSequence('per_visit', startMs, events)
        for (let i = 1; i < redemptions.length; i++) {
          // Indices are in-bounds for the whole loop; the assertions preserve
          // `noUncheckedIndexedAccess` typing (repo test convention).
          expect(redemptions[i]! - redemptions[i - 1]!).toBeGreaterThanOrEqual(REPEAT_WINDOW_MS)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('once allows at most one redemption ever (R2.2, R2.4)', () => {
    fc.assert(
      fc.property(epochMsArb, fc.array(eventArb, { minLength: 0, maxLength: 40 }), (startMs, events) => {
        const redemptions = runSequence('once', startMs, events)
        expect(redemptions.length).toBeLessThanOrEqual(1)
      }),
      { numRuns: 300 },
    )
  })
})
