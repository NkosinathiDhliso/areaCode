/**
 * Property-based tests for the Win-Back Campaigns service: send quota,
 * send idempotency, and attribution single-count.
 *
 * Library: fast-check + Vitest, ≥100 iterations per property.
 *
 * Feature: winback-campaigns
 *   - Property 8:  Quota Non-Truncation       (Requirements 9.3, 9.4)
 *   - Property 9:  Send Idempotency           (Requirement 8.6)
 *   - Property 12: Attribution Single-Count   (Requirements 11.2, 11.5)
 *
 * Property 8 (Quota Non-Truncation): for any business with remaining monthly
 * quota `q` and a send with eligible recipient count `n`, the send proceeds
 * only if `n ≤ q`; when `n > q` it is rejected WHOLE (0 dispatched) and reports
 * `remaining`. We drive the real `sendCampaign` guard path with the segment /
 * tier / kv collaborators mocked (so the resolved eligible count is exactly
 * `n`), and additionally exercise the pure `assertWithinQuota` arithmetic.
 *
 * Property 9 (Send Idempotency): for any campaign already `sending` or `sent`,
 * a subsequent `sendCampaign` is rejected with `CampaignAlreadySentError` and
 * dispatches nothing (no `putCampaign`, no Lambda invoke).
 *
 * Property 12 (Attribution Single-Count): the pure `countAttributedReturns`
 * counts each messaged recipient AT MOST once regardless of how many in-window
 * check-ins they have, never counts a check-in outside the attribution window,
 * and never counts a non-messaged userId. Validated against an independent
 * oracle.
 *
 * Mocking mirrors `service.test.ts` (repository, segment-resolver, eligibility,
 * business repo/service, kv, and @aws-sdk/client-lambda). No phone identifier
 * appears anywhere — the only consumer identifier is the transient `userId`
 * (Constraint C1).
 *
 * **Validates: Requirements 8.6, 9.3, 9.4, 11.2, 11.5**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'

const mocks = vi.hoisted(() => ({
  getNodesByBusinessId: vi.fn(),
  getRewardById: vi.fn(),
  getCampaignById: vi.fn(),
  putCampaign: vi.fn(),
  listCampaignsFromRepo: vi.fn(),
  getSendRecords: vi.fn(),
  getCheckInsByNode: vi.fn(),
  lambdaSend: vi.fn(),
  resolveSegmentWithMeta: vi.fn(),
  filterByConsentAndOptOut: vi.fn(),
  filterByFrequencyCap: vi.fn(),
  findBusinessById: vi.fn(),
  getEffectiveTier: vi.fn(),
  kvGet: vi.fn(),
  kvIncrBy: vi.fn(),
}))

vi.mock('../../nodes/dynamodb-repository.js', () => ({
  getNodesByBusinessId: mocks.getNodesByBusinessId,
}))
vi.mock('../../rewards/repository.js', () => ({
  getRewardById: mocks.getRewardById,
}))
vi.mock('../repository.js', () => ({
  getCampaignById: mocks.getCampaignById,
  putCampaign: mocks.putCampaign,
  listCampaigns: mocks.listCampaignsFromRepo,
  getSendRecords: mocks.getSendRecords,
}))
vi.mock('../../check-in/dynamodb-repository.js', () => ({
  getCheckInsByNode: mocks.getCheckInsByNode,
}))
vi.mock('../segment-resolver.js', () => ({
  resolveSegmentWithMeta: mocks.resolveSegmentWithMeta,
}))
vi.mock('../eligibility.js', () => ({
  filterByConsentAndOptOut: mocks.filterByConsentAndOptOut,
  filterByFrequencyCap: mocks.filterByFrequencyCap,
}))
vi.mock('../../business/repository.js', () => ({
  findBusinessById: mocks.findBusinessById,
}))
vi.mock('../../business/service.js', () => ({
  getEffectiveTier: mocks.getEffectiveTier,
}))
vi.mock('../../../shared/kv/dynamodb-kv.js', () => ({
  kvGet: mocks.kvGet,
  kvIncrBy: mocks.kvIncrBy,
}))
vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: class {
    send = mocks.lambdaSend
  },
  InvokeCommand: class {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  },
}))

import {
  sendCampaign,
  countAttributedReturns,
  CampaignAlreadySentError,
  CampaignQuotaExceededError,
  CAMPAIGN_DISPATCHER_FUNCTION_ENV,
} from '../service.js'
import { assertWithinQuota, monthlyQuotaForTier, QuotaExceededError } from '../quota.js'
import { recipientToken } from '../anonymize.js'
import type { Campaign, CampaignStatus } from '../types.js'

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const BUSINESS_ID = 'biz-1'
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Nodes the business owns (ownership re-validated at send time). */
function ownedNodes(ids: string[]) {
  return ids.map((nodeId) => ({ nodeId, businessId: BUSINESS_ID }))
}

function makeCampaign(over: Partial<Campaign> = {}): Campaign {
  const createdAt = '2025-01-01T00:00:00.000Z'
  return {
    campaignId: 'camp-1',
    businessId: BUSINESS_ID,
    status: 'draft',
    segment: 'lapsed',
    lapsedWindowDays: 21,
    nodeIds: ['node-1'],
    title: 'We miss you',
    body: 'Come back',
    channels: ['push'],
    createdAt,
    attributionWindowDays: 14,
    campaignSalt: 'salt',
    counts: {
      targeted: 0,
      filteredConsent: 0,
      filteredFreqCap: 0,
      attempted: 0,
      deliveredPush: 0,
      deliveredEmail: 0,
      deliveredBoth: 0,
      noChannel: 0,
      failed: 0,
    },
    ttl: 0,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env[CAMPAIGN_DISPATCHER_FUNCTION_ENV]
  mocks.getNodesByBusinessId.mockResolvedValue(ownedNodes(['node-1', 'node-2']))
  mocks.getRewardById.mockResolvedValue(null)
  mocks.putCampaign.mockResolvedValue(undefined)
  mocks.lambdaSend.mockResolvedValue(undefined)
  mocks.getSendRecords.mockResolvedValue([])
  mocks.getCheckInsByNode.mockResolvedValue({ checkIns: [], nextCursor: undefined })
  // Eligibility filters default to identity pass-through, so the eligible count
  // equals the resolved segment size exactly.
  mocks.filterByConsentAndOptOut.mockImplementation(async (ids: string[]) => ids)
  mocks.filterByFrequencyCap.mockImplementation(async (ids: string[]) => ids)
  mocks.findBusinessById.mockResolvedValue({ businessId: BUSINESS_ID, tier: 'growth', trialEndsAt: null })
  mocks.getEffectiveTier.mockReturnValue('growth')
  mocks.kvGet.mockResolvedValue(null)
})

// ═══════════════════════════════════════════════════════════════════════════
// Property 8: Quota Non-Truncation
// ═══════════════════════════════════════════════════════════════════════════

describe('Feature: winback-campaigns, Property 8: Quota Non-Truncation', () => {
  /** Entitled tiers whose monthly quota is > 0. */
  const tierArb = fc.constantFrom('growth', 'pro')

  beforeEach(() => {
    // Wire the dispatcher env var so an allowed send actually fans out — this
    // lets us assert "0 dispatched" (no lambda invoke) on a rejected send.
    process.env[CAMPAIGN_DISPATCHER_FUNCTION_ENV] = 'campaign-dispatcher-fn'
  })

  afterEach(() => {
    delete process.env[CAMPAIGN_DISPATCHER_FUNCTION_ENV]
  })

  it('sends iff n ≤ remaining; otherwise rejects whole with 0 dispatched and reports remaining', async () => {
    /**
     * **Validates: Requirements 9.3, 9.4**
     *
     * Generate a tier (quota Q), a small `remaining` quota (so the eligible
     * arrays stay tiny), and an eligible count `n` centered on the boundary.
     * `alreadyUsed = Q - remaining` is fed via `kvGet`; the segment resolves to
     * exactly `n` userIds (filters pass through). Then:
     *   - n ≤ remaining → campaign transitions to `sending`, `putCampaign`
     *     written once, dispatcher invoked once;
     *   - n > remaining → throws `CampaignQuotaExceededError` carrying the true
     *     `remaining`/`requested`, with NO `putCampaign` write and NO dispatch
     *     (the send is rejected whole, never truncated).
     */
    await fc.assert(
      fc.asyncProperty(
        tierArb,
        fc.integer({ min: 0, max: 50 }), // remaining quota
        fc.integer({ min: 0, max: 100 }), // eligible recipient count n
        async (tier, remaining, n) => {
          mocks.putCampaign.mockClear()
          mocks.lambdaSend.mockClear()

          const quota = monthlyQuotaForTier(tier)
          const alreadyUsed = quota - remaining

          mocks.getCampaignById.mockResolvedValue(makeCampaign({ status: 'draft' }))
          mocks.getEffectiveTier.mockReturnValue(tier)
          mocks.kvGet.mockResolvedValue(String(alreadyUsed))
          mocks.resolveSegmentWithMeta.mockResolvedValue({
            userIds: Array.from({ length: n }, (_, i) => `u-${i}`),
            truncated: false,
          })

          if (n <= remaining) {
            // Send proceeds: transitions to `sending`, persisted + dispatched.
            const result = await sendCampaign(BUSINESS_ID, 'camp-1')
            expect(result.status).toBe('sending')
            expect(result.sentAt).toBeTruthy()
            expect(mocks.putCampaign).toHaveBeenCalledTimes(1)
            expect(mocks.lambdaSend).toHaveBeenCalledTimes(1)
          } else {
            // Send rejected WHOLE: no transition, no dispatch, remaining reported.
            let thrown: unknown
            try {
              await sendCampaign(BUSINESS_ID, 'camp-1')
            } catch (e) {
              thrown = e
            }
            expect(thrown).toBeInstanceOf(CampaignQuotaExceededError)
            expect((thrown as CampaignQuotaExceededError).remaining).toBe(remaining)
            expect((thrown as CampaignQuotaExceededError).requested).toBe(n)
            expect((thrown as CampaignQuotaExceededError).statusCode).toBe(409)
            // 0 dispatched: neither the `sending` write nor the Lambda invoke ran.
            expect(mocks.putCampaign).not.toHaveBeenCalled()
            expect(mocks.lambdaSend).not.toHaveBeenCalled()
          }
        },
      ),
      { numRuns: 200 },
    )
  }, 30000)

  it('pure assertWithinQuota: fits whole (remaining − n) or throws, never truncates', async () => {
    /**
     * **Validates: Requirements 9.3, 9.4**
     *
     * The core arithmetic backing the guard. For any tier/used/count:
     *   - remaining = max(0, quota − used);
     *   - count ≤ remaining → returns { remaining: remaining − count } (≥ 0);
     *   - count > remaining → throws QuotaExceededError(remaining, count).
     * There is no partial/truncated outcome — it fits whole or rejects whole.
     */
    await fc.assert(
      fc.property(
        fc.constantFrom('growth', 'pro', 'starter', 'payg', 'free', 'enterprise'),
        fc.integer({ min: 0, max: 15000 }), // already used this month
        fc.integer({ min: 0, max: 15000 }), // count this send wants to add
        (tier, used, count) => {
          const quota = monthlyQuotaForTier(tier)
          const remaining = Math.max(0, quota - used)

          if (count <= remaining) {
            const result = assertWithinQuota(tier, used, count)
            expect(result.remaining).toBe(remaining - count)
            expect(result.remaining).toBeGreaterThanOrEqual(0)
          } else {
            let thrown: unknown
            try {
              assertWithinQuota(tier, used, count)
            } catch (e) {
              thrown = e
            }
            expect(thrown).toBeInstanceOf(QuotaExceededError)
            expect((thrown as QuotaExceededError).remaining).toBe(remaining)
            expect((thrown as QuotaExceededError).requested).toBe(count)
            // Crucially: remaining < count, so a truncated send would have been
            // possible — the guard refuses it instead (never truncate).
            expect((thrown as QuotaExceededError).remaining).toBeLessThan(count)
          }
        },
      ),
      { numRuns: 300 },
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Property 9: Send Idempotency
// ═══════════════════════════════════════════════════════════════════════════

describe('Feature: winback-campaigns, Property 9: Send Idempotency', () => {
  it('rejects re-send of any sending/sent campaign and dispatches nothing', async () => {
    /**
     * **Validates: Requirement 8.6**
     *
     * For any campaign already in `sending` or `sent` (random ids, with or
     * without a `scheduledAt`), `sendCampaign` rejects with
     * `CampaignAlreadySentError` BEFORE any state transition or fan-out — so
     * `putCampaign` and the dispatcher Lambda are never invoked. This holds the
     * send-once guarantee no matter how many times send is retried.
     */
    process.env[CAMPAIGN_DISPATCHER_FUNCTION_ENV] = 'campaign-dispatcher-fn'

    const sentStatusArb: fc.Arbitrary<CampaignStatus> = fc.constantFrom('sending', 'sent')
    const idArb = fc.string({ minLength: 1, maxLength: 24 }).filter((s) => s.trim().length > 0)
    // Either send-now (undefined) or a future/past schedule — guard fires regardless.
    const scheduledAtArb = fc.option(
      fc.integer({ min: -3 * MS_PER_DAY, max: 30 * MS_PER_DAY }).map((off) => new Date(Date.now() + off).toISOString()),
      { nil: undefined },
    )

    try {
      await fc.assert(
        fc.asyncProperty(
          sentStatusArb,
          idArb,
          idArb,
          scheduledAtArb,
          async (status, businessId, campaignId, scheduledAt) => {
            mocks.putCampaign.mockClear()
            mocks.lambdaSend.mockClear()
            mocks.getCampaignById.mockResolvedValue(makeCampaign({ campaignId, businessId, status }))

            let thrown: unknown
            try {
              await sendCampaign(businessId, campaignId, scheduledAt)
            } catch (e) {
              thrown = e
            }

            expect(thrown).toBeInstanceOf(CampaignAlreadySentError)
            expect((thrown as CampaignAlreadySentError).statusCode).toBe(409)
            // No additional messages dispatched: no write, no fan-out.
            expect(mocks.putCampaign).not.toHaveBeenCalled()
            expect(mocks.lambdaSend).not.toHaveBeenCalled()
          },
        ),
        { numRuns: 200 },
      )
    } finally {
      delete process.env[CAMPAIGN_DISPATCHER_FUNCTION_ENV]
    }
  }, 30000)
})

// ═══════════════════════════════════════════════════════════════════════════
// Property 12: Attribution Single-Count
// ═══════════════════════════════════════════════════════════════════════════

describe('Feature: winback-campaigns, Property 12: Attribution Single-Count', () => {
  const CAMPAIGN_ID = 'camp-attr'
  const SALT = 'salt-attr'
  /** Fixed send time; the window is [sentAt, sentAt + windowDays * DAY] inclusive. */
  const SENT_AT_MS = new Date('2025-03-01T00:00:00.000Z').getTime()

  /**
   * A scenario: a set of messaged userIds (prefixed `m`), and a list of
   * post-send check-ins whose userIds are drawn from the messaged set OR from a
   * disjoint non-messaged pool (prefixed `x`). Each check-in carries an integer
   * day offset from the send time spanning before-window, in-window, and
   * after-window. Messaged users may appear in multiple check-ins.
   */
  const scenarioArb = fc
    .uniqueArray(fc.integer({ min: 0, max: 40 }), { minLength: 0, maxLength: 12 })
    .map((ns) => ns.map((n) => `m${n}`))
    .chain((messaged) => {
      const nonMessagedArb = fc.integer({ min: 0, max: 40 }).map((n) => `x${n}`)
      const userArb = messaged.length > 0 ? fc.oneof(fc.constantFrom(...messaged), nonMessagedArb) : nonMessagedArb
      const checkInArb = fc.record({
        userId: userArb,
        // -10..+45 days spans before the window, inside it, and well past it.
        offsetDays: fc.integer({ min: -10, max: 45 }),
      })
      return fc.record({
        messaged: fc.constant(messaged),
        windowDays: fc.integer({ min: 1, max: 30 }),
        checkIns: fc.array(checkInArb, { minLength: 0, maxLength: 40 }),
      })
    })

  it('counts each in-window messaged recipient exactly once, and nothing else', async () => {
    /**
     * **Validates: Requirements 11.2, 11.5**
     *
     * Build the messaged-token set from the messaged userIds, materialize the
     * generated check-ins, and compare `countAttributedReturns` to an
     * independent oracle: the number of DISTINCT messaged userIds with ≥1
     * check-in whose day offset is in [0, windowDays]. The equality proves all
     * four sub-properties at once —
     *   - at-most-once per recipient (distinct count, not check-in count),
     *   - in-window only (offset 0..windowDays inclusive),
     *   - messaged-only (non-messaged `x` users excluded),
     *   - result ≤ messaged-set size.
     */
    await fc.assert(
      fc.property(scenarioArb, ({ messaged, windowDays, checkIns }) => {
        const messagedSet = new Set(messaged)
        const messagedTokens = new Set(messaged.map((u) => recipientToken(u, CAMPAIGN_ID, SALT)))

        const materializedCheckIns = checkIns.map((ci) => ({
          userId: ci.userId,
          checkedInAt: new Date(SENT_AT_MS + ci.offsetDays * MS_PER_DAY).toISOString(),
        }))

        const actual = countAttributedReturns(
          messagedTokens,
          materializedCheckIns,
          CAMPAIGN_ID,
          SALT,
          SENT_AT_MS,
          windowDays,
        )

        // Oracle: distinct messaged users with ≥1 in-window check-in.
        const expectedReturners = new Set<string>()
        for (const ci of checkIns) {
          const inWindow = ci.offsetDays >= 0 && ci.offsetDays <= windowDays
          if (inWindow && messagedSet.has(ci.userId)) {
            expectedReturners.add(ci.userId)
          }
        }

        expect(actual).toBe(expectedReturners.size)
        // Never exceeds the messaged-set size (each recipient at most once).
        expect(actual).toBeLessThanOrEqual(messagedTokens.size)
        expect(actual).toBeGreaterThanOrEqual(0)
      }),
      { numRuns: 300 },
    )
  })

  it('ignores duplicate in-window check-ins: many returns by one recipient count once', async () => {
    /**
     * **Validates: Requirement 11.5**
     *
     * A single messaged recipient with an arbitrary number of distinct in-window
     * check-ins contributes exactly 1 to the attributed count.
     */
    await fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }), // windowDays
        fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 1, maxLength: 20 }), // offset days, all ≥ 0
        (windowDays, rawOffsets) => {
          // Clamp every offset into the window so every check-in qualifies.
          const offsets = rawOffsets.map((o) => Math.min(o, windowDays))
          const messagedTokens = new Set([recipientToken('solo', CAMPAIGN_ID, SALT)])
          const checkIns = offsets.map((o) => ({
            userId: 'solo',
            checkedInAt: new Date(SENT_AT_MS + o * MS_PER_DAY).toISOString(),
          }))

          const actual = countAttributedReturns(messagedTokens, checkIns, CAMPAIGN_ID, SALT, SENT_AT_MS, windowDays)
          expect(actual).toBe(1)
        },
      ),
      { numRuns: 200 },
    )
  })
})
