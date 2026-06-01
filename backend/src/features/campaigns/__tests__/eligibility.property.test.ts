/**
 * Property-based tests for the Win-Back Campaigns eligibility filters.
 *
 * Feature: winback-campaigns
 *   - Property 5: Consent Opt-In Default  (Requirements 6.1, 6.4)
 *   - Property 6: Opt-Out Honored         (Requirements 6.2, 12.3)
 *   - Property 7: Frequency Cap Bound     (Requirements 7.1, 7.4)
 *
 * The module under test is `eligibility.ts`. Its only collaborators are mocked:
 *   - `./repository.js`            -> getOptOuts, getMarketingConsent
 *   - `../../shared/kv/dynamodb-kv.js` -> kvGet, kvIncr
 *
 * The KV mock is backed by an in-memory Map so `kvIncr`/`kvGet` behave
 * realistically (counters actually increment and persist within a run),
 * letting the frequency-cap property exercise the real cap arithmetic.
 *
 * No phone identifier appears anywhere — the only consumer identifier is
 * `userId` (Constraint C1).
 *
 * **Validates: Requirements 6.1, 6.2, 6.4, 7.1, 7.4, 12.3**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getOptOuts: vi.fn(),
  getMarketingConsent: vi.fn(),
  kvGet: vi.fn(),
  kvIncr: vi.fn(),
}))

vi.mock('../repository.js', () => ({
  getOptOuts: mocks.getOptOuts,
  getMarketingConsent: mocks.getMarketingConsent,
}))

vi.mock('../../../shared/kv/dynamodb-kv.js', () => ({
  kvGet: mocks.kvGet,
  kvIncr: mocks.kvIncr,
}))

import { filterByConsentAndOptOut, filterByFrequencyCap, incrementFrequencyCap, FREQ_CAP_MAX } from '../eligibility.js'
import type { OptOutState } from '../repository.js'

// ─── Mutable test fixtures the mocks read from ──────────────────────────────
//
// The mock closures reference these `let` bindings, so each property run can
// reassign/reset them and the mocks pick up the new state.

let consentConfig = new Map<string, boolean>()
let optOutConfig = new Map<string, OptOutState>()
const kvStore = new Map<string, number>()

/** Mirrors the internal frequency-cap key format in eligibility.ts. */
function freqKey(userId: string): string {
  return `campaign:freqcap:${userId}`
}

beforeEach(() => {
  consentConfig = new Map()
  optOutConfig = new Map()
  kvStore.clear()

  // getMarketingConsent: returns a map for every requested userId; an
  // unconfigured userId defaults to `false` (opt-in default, mirrors the real
  // repository which seeds every requested id to not-granted).
  mocks.getMarketingConsent.mockImplementation((userIds: string[]) => {
    const map = new Map<string, boolean>()
    for (const id of userIds) {
      map.set(id, consentConfig.get(id) === true)
    }
    return Promise.resolve(map)
  })

  // getOptOuts: per-user opt-out state; unconfigured = no opt-outs.
  mocks.getOptOuts.mockImplementation((userId: string) => {
    return Promise.resolve(optOutConfig.get(userId) ?? { businessIds: [], global: false })
  })

  // In-memory KV backing the frequency cap. kvGet returns the stringified
  // counter (or null); kvIncr increments and returns the new value, exactly
  // like the DynamoDB-backed helper.
  mocks.kvGet.mockImplementation((key: string) => {
    const v = kvStore.get(key)
    return Promise.resolve(v === undefined ? null : String(v))
  })
  mocks.kvIncr.mockImplementation((key: string, _ttlSeconds?: number) => {
    const next = (kvStore.get(key) ?? 0) + 1
    kvStore.set(key, next)
    return Promise.resolve(next)
  })
})

// ─── Arbitraries ────────────────────────────────────────────────────────────

const businessIdArb = fc.string({ minLength: 1, maxLength: 32 }).filter((s) => s.trim().length > 0)

/**
 * Build a list of users with unique ids (`u0`, `u1`, ...) so that consent /
 * opt-out state keyed by id is unambiguous. Each entry carries an arbitrary
 * `spec` describing that user's eligibility-relevant state.
 */
function usersWithSpec<T>(specArb: fc.Arbitrary<T>, maxUsers = 12) {
  return fc
    .array(specArb, { minLength: 0, maxLength: maxUsers })
    .map((specs) => specs.map((spec, i) => ({ userId: `u${i}`, spec })))
}

// ────────────────────────────────────────────────────────────────────────────
// Property 5: Consent Opt-In Default
//
// For any consumer with no recorded (or non-true) marketing-consent value, the
// eligibility filter SHALL exclude that consumer. With no opt-outs in play, the
// filter output is exactly the set of consumers who explicitly granted consent.
//
// Feature: winback-campaigns, Property 5: Consent Opt-In Default
// Validates: Requirements 6.1, 6.4
// ────────────────────────────────────────────────────────────────────────────

describe('Feature: winback-campaigns, Property 5: Consent Opt-In Default', () => {
  type ConsentState = 'granted' | 'denied' | 'absent'
  const consentStateArb: fc.Arbitrary<ConsentState> = fc.constantFrom('granted', 'denied', 'absent')

  it('excludes every consumer without an explicit marketing-consent grant', async () => {
    await fc.assert(
      fc.asyncProperty(usersWithSpec(consentStateArb), businessIdArb, async (users, businessId) => {
        // Reset per-iteration state (fast-check runs many iterations within one
        // test, so beforeEach alone would leak state between runs).
        consentConfig.clear()
        optOutConfig.clear()

        // Configure consent: only 'granted' users get a true value; 'denied'
        // gets an explicit false; 'absent' is never recorded at all.
        for (const { userId, spec } of users) {
          if (spec === 'granted') consentConfig.set(userId, true)
          else if (spec === 'denied') consentConfig.set(userId, false)
          // 'absent' -> leave unset
        }

        const userIds = users.map((u) => u.userId)
        const result = await filterByConsentAndOptOut(userIds, businessId)

        const expected = users.filter((u) => u.spec === 'granted').map((u) => u.userId)

        // Output is exactly the explicitly-consented users (no opt-outs here).
        expect([...result].sort()).toEqual([...expected].sort())

        // And, stated directly: no absent/denied consumer ever appears.
        for (const { userId, spec } of users) {
          if (spec !== 'granted') {
            expect(result).not.toContain(userId)
          }
        }
      }),
      { numRuns: 200 },
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Property 6: Opt-Out Honored
//
// For any consumer with a global opt-out OR a per-business opt-out for the
// sending business, the eligibility filter SHALL exclude that consumer
// regardless of consent state. A consumer is included iff they granted consent
// AND have neither a global nor a sending-business opt-out (an opt-out for a
// *different* business does not exclude them).
//
// Feature: winback-campaigns, Property 6: Opt-Out Honored
// Validates: Requirements 6.2, 12.3
// ────────────────────────────────────────────────────────────────────────────

describe('Feature: winback-campaigns, Property 6: Opt-Out Honored', () => {
  type OptOutKind = 'global' | 'sending' | 'other' | 'none'
  const specArb = fc.record({
    optOut: fc.constantFrom<OptOutKind>('global', 'sending', 'other', 'none'),
    consent: fc.boolean(),
  })

  it('excludes globally/per-business opted-out consumers regardless of consent', async () => {
    await fc.assert(
      fc.asyncProperty(usersWithSpec(specArb), businessIdArb, async (users, sendingBusinessId) => {
        // Reset per-iteration state (fast-check runs many iterations per test).
        consentConfig.clear()
        optOutConfig.clear()

        const otherBusinessId = `${sendingBusinessId}-other`

        for (const { userId, spec } of users) {
          consentConfig.set(userId, spec.consent)
          switch (spec.optOut) {
            case 'global':
              optOutConfig.set(userId, { businessIds: [], global: true })
              break
            case 'sending':
              optOutConfig.set(userId, { businessIds: [sendingBusinessId], global: false })
              break
            case 'other':
              optOutConfig.set(userId, { businessIds: [otherBusinessId], global: false })
              break
            case 'none':
              optOutConfig.set(userId, { businessIds: [], global: false })
              break
          }
        }

        const userIds = users.map((u) => u.userId)
        const result = await filterByConsentAndOptOut(userIds, sendingBusinessId)

        // A consumer is eligible iff consent granted AND not opted-out of the
        // sending business (globally or specifically).
        const expected = users
          .filter((u) => u.spec.consent && u.spec.optOut !== 'global' && u.spec.optOut !== 'sending')
          .map((u) => u.userId)

        expect([...result].sort()).toEqual([...expected].sort())

        // Stated directly: any global/sending opt-out is excluded regardless of
        // its consent value.
        for (const { userId, spec } of users) {
          if (spec.optOut === 'global' || spec.optOut === 'sending') {
            expect(result).not.toContain(userId)
          }
        }
      }),
      { numRuns: 200 },
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Property 7: Frequency Cap Bound
//
// For any sequence of campaign sends to a consumer within the rolling window,
// the number of campaigns counted against that consumer SHALL never exceed
// FREQ_CAP_MAX, and a consumer at the cap SHALL be excluded from further
// campaigns. We simulate dispatch cycles: each cycle filters a candidate set by
// the cap, then increments the counter once per eligible recipient (mirroring
// the dispatcher → sender protocol).
//
// Feature: winback-campaigns, Property 7: Frequency Cap Bound
// Validates: Requirements 7.1, 7.4
// ────────────────────────────────────────────────────────────────────────────

describe('Feature: winback-campaigns, Property 7: Frequency Cap Bound', () => {
  // Generate a fixed user roster, then a sequence of dispatch rounds where each
  // round targets an arbitrary subset of the roster.
  const scenarioArb = fc.integer({ min: 1, max: 8 }).chain((n) => {
    const users = Array.from({ length: n }, (_, i) => `u${i}`)
    return fc.record({
      users: fc.constant(users),
      rounds: fc.array(fc.subarray(users), { minLength: 1, maxLength: 15 }),
    })
  })

  it('never lets a consumer exceed the cap and excludes capped consumers', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ users, rounds }) => {
        kvStore.clear()

        for (const round of rounds) {
          // Only consumers under the cap are eligible for this dispatch...
          const eligible = await filterByFrequencyCap(round)

          // ...and an attempted send increments their counter once.
          for (const userId of eligible) {
            await incrementFrequencyCap(userId)
          }

          // Invariant after every round: no counter exceeds the cap.
          for (const userId of users) {
            const count = kvStore.get(freqKey(userId)) ?? 0
            expect(count).toBeLessThanOrEqual(FREQ_CAP_MAX)
          }
        }

        // Final state: cap respected, and the filter excludes exactly the
        // consumers who have reached the cap.
        const finalEligible = await filterByFrequencyCap(users)
        for (const userId of users) {
          const count = kvStore.get(freqKey(userId)) ?? 0
          expect(count).toBeLessThanOrEqual(FREQ_CAP_MAX)
          if (count >= FREQ_CAP_MAX) {
            expect(finalEligible).not.toContain(userId)
          } else {
            expect(finalEligible).toContain(userId)
          }
        }
      }),
      { numRuns: 200 },
    )
  })
})
