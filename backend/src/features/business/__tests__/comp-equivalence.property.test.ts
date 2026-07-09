/**
 * Feature: cross-portal-lifecycle-alignment, Property 1: Comp equivalence.
 *
 * **Validates: Requirements 1.1**
 *
 * An admin Comp_Window is "just a paid window whose payment is Area Code
 * goodwill". This pins that claim as a contract: for the same `paidUntil`, the
 * row an admin comp writes (`setBusinessCompWindow`) and the row a paid webhook
 * activation writes (`activateSubscriptionOnBusiness`) resolve to the SAME
 * effective tier under the Tier_Resolver (`getEffectiveTier`), at every clock.
 * The only difference between the two written rows is `paidInterval` (null for a
 * comp, the bought interval for a payment), which the resolver ignores.
 *
 * ─── Strategy ───────────────────────────────────────────────────────────────
 *
 * Both write functions are thin wrappers over `updateBusiness`. We mock that one
 * dependency to capture the exact attribute map each writes, then feed the two
 * captured rows to the real `getEffectiveTier` across a spread of clocks and
 * assert equality — a genuine write-shape → resolver contract, not a restatement
 * of the implementation. We also assert the comp row clears trial and grace and
 * leaves `paidInterval` null (R1.1).
 */

import * as fc from 'fast-check'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const captured = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }))

vi.mock('../../auth/dynamodb-repository.js', () => ({
  updateBusiness: vi.fn(async (_id: string, data: Record<string, unknown>) => {
    captured.calls.push(data)
    return data
  }),
  getBusinessById: vi.fn(),
  getBusinessByCognitoSub: vi.fn(),
  getStaffByBusinessId: vi.fn(async () => []),
}))

// eslint-disable-next-line import/first
import { setBusinessCompWindow, activateSubscriptionOnBusiness } from '../repository.js'
// eslint-disable-next-line import/first
import { getEffectiveTier } from '../service.js'
// eslint-disable-next-line import/first
import type { PaidInterval } from '../types.js'

const paidTierArb: fc.Arbitrary<'growth' | 'pro'> = fc.constantFrom('growth', 'pro')
const intervalArb: fc.Arbitrary<PaidInterval> = fc.constantFrom('daily', 'weekly', 'monthly', 'yearly')

// A spread of paidUntil values: past, near, and far future, so resolution
// actually differs across cases while staying equal between comp and payment.
const paidUntilArb: fc.Arbitrary<string> = fc
  .integer({ min: 946_684_800_000, max: 4_102_444_800_000 })
  .map((ms) => new Date(ms).toISOString())

// Clocks to resolve at: fixed points spanning before/after any generated window.
const CLOCKS = [Date.UTC(2001, 0, 1), Date.UTC(2026, 5, 15, 12), Date.UTC(2099, 11, 31)]

describe('Feature: cross-portal-lifecycle-alignment, Property 1: Comp equivalence', () => {
  beforeEach(() => {
    captured.calls = []
  })

  it('comp and paid activation resolve identically for the same paidUntil (R1.1)', async () => {
    await fc.assert(
      fc.asyncProperty(paidTierArb, paidUntilArb, intervalArb, async (tier, paidUntil, interval) => {
        captured.calls = []
        await setBusinessCompWindow('biz-1', tier, paidUntil)
        const compRow = captured.calls[0]!

        captured.calls = []
        await activateSubscriptionOnBusiness('biz-1', { tier, paidUntil, paidInterval: interval })
        const paidRow = captured.calls[0]!

        for (const now of CLOCKS) {
          expect(getEffectiveTier(compRow, now)).toBe(getEffectiveTier(paidRow, now))
        }
      }),
      { numRuns: 200 },
    )
  })

  it('comp write clears trial and grace and leaves paidInterval null (R1.1)', async () => {
    await fc.assert(
      fc.asyncProperty(paidTierArb, paidUntilArb, async (tier, paidUntil) => {
        captured.calls = []
        await setBusinessCompWindow('biz-1', tier, paidUntil)
        const row = captured.calls[0]!
        expect(row['tier']).toBe(tier)
        expect(row['paidUntil']).toBe(paidUntil)
        expect(row['paidInterval']).toBeNull()
        expect(row['trialEndsAt']).toBeNull()
        expect(row['paymentGraceUntil']).toBeNull()
      }),
      { numRuns: 100 },
    )
  })

  it('starter comp clears the window so it resolves to starter (R1.2)', async () => {
    captured.calls = []
    await setBusinessCompWindow('biz-1', 'starter', null)
    const row = captured.calls[0]!
    expect(row['tier']).toBe('starter')
    expect(row['paidUntil']).toBeNull()
    expect(row['paidInterval']).toBeNull()
    expect(getEffectiveTier(row, Date.UTC(2026, 5, 15))).toBe('starter')
  })
})
