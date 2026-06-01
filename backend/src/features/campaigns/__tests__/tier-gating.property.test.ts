/**
 * Property-based tests for the Win-Back Campaigns tier gating.
 *
 * Library: fast-check + Vitest, ≥200 iterations per property.
 *
 * Feature: winback-campaigns
 *   - Property 13: Tier Gating  (Requirements 9.1, 9.2)
 *
 * The module under test exposes pure helpers (`canSendCampaigns`,
 * `assertCanSendCampaigns`, `CampaignUpgradeRequiredError`,
 * `CAMPAIGN_SEND_TIERS`) that decide campaign-send entitlement purely from the
 * business's effective tier string. The helpers carry zero external state, so
 * no mocking is required — they are the entire surface under test.
 *
 * Property 13 (Tier Gating): for any business tier, growth/pro SHALL be
 * permitted to send (subject to quota elsewhere), while every other tier
 * (starter, payg, free, unknown, empty, arbitrary) SHALL be rejected with an
 * upgrade-required response — `CampaignUpgradeRequiredError` carrying
 * `statusCode === 402` and `error === 'upgrade_required'` — dispatching nothing.
 *
 * No phone identifier appears anywhere — entitlement is decided solely from the
 * tier string (Constraint C1).
 *
 * **Validates: Requirements 9.1, 9.2**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

import { canSendCampaigns, assertCanSendCampaigns, CampaignUpgradeRequiredError } from '../tier-gating.js'

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Tier strings biased toward the known business tiers (starter, payg, free,
 * growth, pro, enterprise) plus the empty string, mixed with arbitrary strings
 * so we also exercise unknown/garbage tiers well outside the known set.
 */
const tierArb = fc.oneof(fc.constantFrom('starter', 'payg', 'free', 'growth', 'pro', 'enterprise', ''), fc.string())

// ─── Property 13: Tier Gating ────────────────────────────────────────────────

describe('Feature: winback-campaigns, Property 13: Tier Gating', () => {
  it('permits growth/pro to send and rejects every other tier with a 402 upgrade_required', () => {
    /**
     * **Validates: Requirements 9.1, 9.2**
     *
     * For any tier:
     *   - growth/pro → `canSendCampaigns` is true and `assertCanSendCampaigns`
     *     does NOT throw (sending permitted, subject to quota elsewhere);
     *   - any other tier → `canSendCampaigns` is false and
     *     `assertCanSendCampaigns` throws `CampaignUpgradeRequiredError` with
     *     `statusCode === 402` and `error === 'upgrade_required'` (nothing
     *     dispatched).
     */
    fc.assert(
      fc.property(tierArb, (tier) => {
        if (tier === 'growth' || tier === 'pro') {
          expect(canSendCampaigns(tier)).toBe(true)
          expect(() => assertCanSendCampaigns(tier)).not.toThrow()
        } else {
          expect(canSendCampaigns(tier)).toBe(false)

          let thrown: unknown
          try {
            assertCanSendCampaigns(tier)
          } catch (err) {
            thrown = err
          }

          expect(thrown).toBeInstanceOf(CampaignUpgradeRequiredError)
          const err = thrown as CampaignUpgradeRequiredError
          expect(err.statusCode).toBe(402)
          expect(err.error).toBe('upgrade_required')
        }
      }),
      { numRuns: 200 },
    )
  }, 30000)
})
