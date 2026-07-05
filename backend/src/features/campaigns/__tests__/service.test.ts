/**
 * Unit tests for the Win-Back Campaigns service lifecycle (task 7.1).
 *
 * Covers create / send / schedule / cancel and the read paths (list, detail)
 * with the repository, ownership lookups, and the Lambda dispatcher invoke all
 * stubbed:
 *   - createCampaign: draft status, key fields, defaults, 13-month TTL, zeroed
 *     counts, and ownership rejection creating no campaign (R1.1, 1.3, 1.5, 1.6)
 *   - sendCampaign: draft→sending with dispatcher invoke; re-send of
 *     sending/sent rejected (R8.2, 8.6 / Property 9)
 *   - cancelCampaign: draft→cancelled; otherwise rejected (R8.4)
 *   - getCampaign/listCampaigns: analytics from stored counts, 404 on missing
 *
 * The only consumer identifier handled is the transient `userId` in the
 * dispatcher payload; no phone number appears anywhere (Constraint C1).
 *
 * _Requirements: 1.1, 1.3, 1.5, 1.6, 8.1, 8.2, 8.4, 8.5, 8.6_
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  createCampaign,
  sendCampaign,
  cancelCampaign,
  getCampaign,
  listCampaigns,
  resolveEligibleCount,
  estimateRecipients,
  computeAnalytics,
  countAttributedReturns,
  tallyOutcomes,
  CampaignNotFoundError,
  NodeNotOwnedError,
  RewardNotOwnedError,
  CampaignAlreadySentError,
  CampaignNotCancellableError,
  CampaignQuotaExceededError,
  CAMPAIGN_DISPATCHER_FUNCTION_ENV,
} from '../service.js'
import { recipientToken } from '../anonymize.js'
import type { Campaign, CampaignSendRecord, CampaignStatus, CreateCampaignInput } from '../types.js'

// ─── Helpers ────────────────────────────────────────────────────────────────

const BUSINESS_ID = 'biz-1'

function ownedNodes(ids: string[]) {
  return ids.map((nodeId) => ({ nodeId, businessId: BUSINESS_ID }))
}

/** Build a send record with the given token and outcome (task 7.4 analytics). */
function sendRecord(recipientToken: string, channelOutcome: CampaignSendRecord['channelOutcome']): CampaignSendRecord {
  return { recipientToken, channelOutcome, attemptedAt: '2025-01-02T00:00:00.000Z' }
}

function baseInput(over: Partial<CreateCampaignInput> = {}): CreateCampaignInput {
  return {
    segment: 'lapsed',
    title: 'We miss you',
    body: 'Come back for 20% off',
    channels: ['push'],
    nodeIds: ['node-1'],
    ...over,
  } as CreateCampaignInput
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
      targeted: 10,
      filteredConsent: 2,
      filteredFreqCap: 1,
      attempted: 7,
      deliveredPush: 4,
      deliveredEmail: 2,
      deliveredBoth: 1,
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
  // Analytics collaborators (task 7.4). Default: no send records, no check-ins
  // → delivery tally all-zero and attribution 0.
  mocks.getSendRecords.mockResolvedValue([])
  mocks.getCheckInsByNode.mockResolvedValue({ checkIns: [], nextCursor: undefined })
  // Quota collaborators (task 7.2). Defaults: a small eligible set, a growth
  // business (quota 2000), and an empty month counter — well within quota.
  mocks.resolveSegmentWithMeta.mockResolvedValue({ userIds: ['u-1', 'u-2', 'u-3'], truncated: false })
  mocks.filterByConsentAndOptOut.mockImplementation(async (ids: string[]) => ids)
  mocks.filterByFrequencyCap.mockImplementation(async (ids: string[]) => ids)
  mocks.findBusinessById.mockResolvedValue({ businessId: BUSINESS_ID, tier: 'growth', trialEndsAt: null })
  mocks.getEffectiveTier.mockReturnValue('growth')
  mocks.kvGet.mockResolvedValue(null)
})

// ─── createCampaign ───────────────────────────────────────────────────────────

describe('createCampaign', () => {
  it('creates a draft campaign with generated id, salt, defaults, TTL, zeroed counts', async () => {
    const campaign = await createCampaign(BUSINESS_ID, baseInput())

    expect(campaign.status).toBe('draft')
    expect(campaign.businessId).toBe(BUSINESS_ID)
    expect(campaign.campaignId).toBeTruthy()
    expect(campaign.campaignSalt).toBeTruthy()
    expect(campaign.attributionWindowDays).toBe(14)
    expect(campaign.lapsedWindowDays).toBe(21) // default for lapsed segment
    expect(campaign.counts.targeted).toBe(0)
    expect(campaign.counts.attempted).toBe(0)

    // TTL is ~13 months after createdAt (epoch seconds).
    const expected = new Date(campaign.createdAt)
    expected.setUTCMonth(expected.getUTCMonth() + 13)
    expect(campaign.ttl).toBe(Math.floor(expected.getTime() / 1000))

    expect(mocks.putCampaign).toHaveBeenCalledTimes(1)
  })

  it('honours a provided lapsedWindowDays for the lapsed segment', async () => {
    const campaign = await createCampaign(BUSINESS_ID, baseInput({ lapsedWindowDays: 45 }))
    expect(campaign.lapsedWindowDays).toBe(45)
  })

  it('does not set lapsedWindowDays for non-lapsed segments', async () => {
    const campaign = await createCampaign(BUSINESS_ID, baseInput({ segment: 'regulars' }))
    expect(campaign.lapsedWindowDays).toBeUndefined()
  })

  it('rejects and creates no campaign when a node is not owned (R1.5)', async () => {
    mocks.getNodesByBusinessId.mockResolvedValue(ownedNodes(['node-1']))

    await expect(createCampaign(BUSINESS_ID, baseInput({ nodeIds: ['node-1', 'node-99'] }))).rejects.toBeInstanceOf(
      NodeNotOwnedError,
    )
    expect(mocks.putCampaign).not.toHaveBeenCalled()
  })

  it('accepts an owned reward and rejects a reward owned by another business (R1.3)', async () => {
    mocks.getRewardById.mockResolvedValueOnce({ rewardId: 'r-1', node: { businessId: BUSINESS_ID } })
    const ok = await createCampaign(BUSINESS_ID, baseInput({ rewardId: 'r-1' }))
    expect(ok.rewardId).toBe('r-1')

    mocks.getRewardById.mockResolvedValueOnce({ rewardId: 'r-2', node: { businessId: 'other-biz' } })
    await expect(createCampaign(BUSINESS_ID, baseInput({ rewardId: 'r-2' }))).rejects.toBeInstanceOf(
      RewardNotOwnedError,
    )

    mocks.getRewardById.mockResolvedValueOnce(null)
    await expect(createCampaign(BUSINESS_ID, baseInput({ rewardId: 'missing' }))).rejects.toBeInstanceOf(
      RewardNotOwnedError,
    )
  })

  it('stores no phone field anywhere on the campaign (C1)', async () => {
    const campaign = await createCampaign(BUSINESS_ID, baseInput({ channels: ['push', 'email'] }))
    const serialized = JSON.stringify(campaign).toLowerCase()
    expect(serialized).not.toContain('phone')
    expect(serialized).not.toContain('sms')
  })
})

// ─── sendCampaign ─────────────────────────────────────────────────────────────

describe('sendCampaign', () => {
  it('sends now: transitions draft→sending, stamps sentAt, invokes dispatcher', async () => {
    process.env[CAMPAIGN_DISPATCHER_FUNCTION_ENV] = 'campaign-dispatcher-fn'
    mocks.getCampaignById.mockResolvedValue(makeCampaign({ status: 'draft' }))

    const result = await sendCampaign(BUSINESS_ID, 'camp-1')

    expect(result.status).toBe('sending')
    expect(result.sentAt).toBeTruthy()
    expect(mocks.putCampaign).toHaveBeenCalledTimes(1)
    expect(mocks.lambdaSend).toHaveBeenCalledTimes(1)
  })

  it('does not throw when the dispatcher env var is unset (skips invoke)', async () => {
    mocks.getCampaignById.mockResolvedValue(makeCampaign({ status: 'draft' }))

    const result = await sendCampaign(BUSINESS_ID, 'camp-1')

    expect(result.status).toBe('sending')
    expect(mocks.lambdaSend).not.toHaveBeenCalled()
  })

  it.each<CampaignStatus>(['sending', 'sent'])(
    'rejects re-send of a %s campaign (R8.6 / Property 9)',
    async (status) => {
      mocks.getCampaignById.mockResolvedValue(makeCampaign({ status }))

      await expect(sendCampaign(BUSINESS_ID, 'camp-1')).rejects.toBeInstanceOf(CampaignAlreadySentError)
      expect(mocks.putCampaign).not.toHaveBeenCalled()
      expect(mocks.lambdaSend).not.toHaveBeenCalled()
    },
  )

  it('throws 404 when the campaign is not found', async () => {
    mocks.getCampaignById.mockResolvedValue(null)
    await expect(sendCampaign(BUSINESS_ID, 'missing')).rejects.toBeInstanceOf(CampaignNotFoundError)
  })

  it('rejects send when a node is no longer owned (re-validation at send)', async () => {
    mocks.getCampaignById.mockResolvedValue(makeCampaign({ status: 'draft', nodeIds: ['node-1', 'gone'] }))
    mocks.getNodesByBusinessId.mockResolvedValue(ownedNodes(['node-1']))

    await expect(sendCampaign(BUSINESS_ID, 'camp-1')).rejects.toBeInstanceOf(NodeNotOwnedError)
    expect(mocks.putCampaign).not.toHaveBeenCalled()
  })
})

// ─── cancelCampaign ───────────────────────────────────────────────────────────

describe('cancelCampaign', () => {
  it('cancels a draft campaign', async () => {
    mocks.getCampaignById.mockResolvedValue(makeCampaign({ status: 'draft' }))
    const result = await cancelCampaign(BUSINESS_ID, 'camp-1')
    expect(result.status).toBe('cancelled')
    expect(mocks.putCampaign).toHaveBeenCalledTimes(1)
  })

  it.each<CampaignStatus>(['sending', 'sent', 'cancelled', 'failed'])(
    'rejects cancelling a %s campaign (R8.4)',
    async (status) => {
      mocks.getCampaignById.mockResolvedValue(makeCampaign({ status }))
      await expect(cancelCampaign(BUSINESS_ID, 'camp-1')).rejects.toBeInstanceOf(CampaignNotCancellableError)
      expect(mocks.putCampaign).not.toHaveBeenCalled()
    },
  )

  it('throws 404 when the campaign is not found', async () => {
    mocks.getCampaignById.mockResolvedValue(null)
    await expect(cancelCampaign(BUSINESS_ID, 'missing')).rejects.toBeInstanceOf(CampaignNotFoundError)
  })
})

// ─── getCampaign / listCampaigns ──────────────────────────────────────────────

describe('getCampaign', () => {
  it('returns targeted/filtered from stored counts and delivery from send records', async () => {
    // Detail view (task 7.4) tallies delivery outcomes from the send records,
    // while targeted/filtered still come from the dispatcher-written counts.
    mocks.getCampaignById.mockResolvedValue(makeCampaign())
    mocks.getSendRecords.mockResolvedValue([
      sendRecord('t-1', 'delivered_push'),
      sendRecord('t-2', 'delivered_push'),
      sendRecord('t-3', 'delivered_email'),
      sendRecord('t-4', 'delivered_both'),
      sendRecord('t-5', 'no_channel'),
      sendRecord('t-6', 'failed'),
    ])

    const result = await getCampaign(BUSINESS_ID, 'camp-1')

    // targeted / filtered → from stored counts.
    expect(result.analytics.recipientsTargeted).toBe(10)
    expect(result.analytics.filteredByConsent).toBe(2)
    expect(result.analytics.filteredByFrequencyCap).toBe(1)
    // delivery → tallied from send records.
    expect(result.analytics.deliveredPush).toBe(2)
    expect(result.analytics.deliveredEmail).toBe(1)
    expect(result.analytics.deliveredBoth).toBe(1)
    expect(result.analytics.noChannel).toBe(1)
    expect(result.analytics.failed).toBe(1)
    // attempted = all outcomes except no_channel = 2+1+1+1 = 5.
    expect(result.analytics.messagesAttempted).toBe(5)
    // Draft campaign has no sentAt → attribution skipped (0).
    expect(result.analytics.attributedReturnVisits).toBe(0)
  })

  it('throws 404 when not found', async () => {
    mocks.getCampaignById.mockResolvedValue(null)
    await expect(getCampaign(BUSINESS_ID, 'missing')).rejects.toBeInstanceOf(CampaignNotFoundError)
  })
})

describe('listCampaigns', () => {
  it('maps stored campaigns to summaries with headline analytics and passes the cursor through', async () => {
    mocks.listCampaignsFromRepo.mockResolvedValue({
      items: [makeCampaign({ campaignId: 'c-1' }), makeCampaign({ campaignId: 'c-2', status: 'sent' })],
      nextCursor: 'next-page',
    })

    const result = await listCampaigns(BUSINESS_ID, { limit: 2 })

    expect(result.nextCursor).toBe('next-page')
    expect(result.items).toHaveLength(2)
    const first = result.items[0]!
    expect(first.campaignId).toBe('c-1')
    expect(first.recipients).toBe(7) // attempted
    expect(first.delivered).toBe(7) // push+email+both = 4+2+1
    expect(first.attributedReturnVisits).toBe(0)
    expect(mocks.listCampaignsFromRepo).toHaveBeenCalledWith(BUSINESS_ID, { limit: 2 })
  })

  it('returns an empty list with no cursor when there are no campaigns', async () => {
    mocks.listCampaignsFromRepo.mockResolvedValue({ items: [] })
    const result = await listCampaigns(BUSINESS_ID)
    expect(result.items).toEqual([])
    expect(result.nextCursor).toBeUndefined()
  })
})

// ─── send-quota enforcement (task 7.2) ────────────────────────────────────────

describe('sendCampaign — send-quota enforcement (R9.3, R9.4 / Property 8)', () => {
  /** Build an eligible set of exactly `n` userIds for the resolve pipeline. */
  function eligibleSetOf(n: number): string[] {
    return Array.from({ length: n }, (_, i) => `u-${i}`)
  }

  it('allows a send when the eligible count exactly equals the remaining quota', async () => {
    // growth quota = 2000; already used 1995 → remaining 5; eligible exactly 5.
    mocks.getCampaignById.mockResolvedValue(makeCampaign({ status: 'draft' }))
    mocks.getEffectiveTier.mockReturnValue('growth')
    mocks.kvGet.mockResolvedValue('1995')
    mocks.resolveSegmentWithMeta.mockResolvedValue({ userIds: eligibleSetOf(5), truncated: false })

    const result = await sendCampaign(BUSINESS_ID, 'camp-1')

    expect(result.status).toBe('sending')
    expect(result.sentAt).toBeTruthy()
    // Transition persisted exactly once (the sending write).
    expect(mocks.putCampaign).toHaveBeenCalledTimes(1)
  })

  it('rejects a send one over the remaining quota: 0 dispatched, state unchanged, remaining reported', async () => {
    // growth quota = 2000; already used 1995 → remaining 5; eligible 6 (one over).
    mocks.getCampaignById.mockResolvedValue(makeCampaign({ status: 'draft' }))
    mocks.getEffectiveTier.mockReturnValue('growth')
    mocks.kvGet.mockResolvedValue('1995')
    mocks.resolveSegmentWithMeta.mockResolvedValue({ userIds: eligibleSetOf(6), truncated: false })

    let thrown: unknown
    try {
      await sendCampaign(BUSINESS_ID, 'camp-1')
    } catch (e) {
      thrown = e
    }

    expect(thrown).toBeInstanceOf(CampaignQuotaExceededError)
    expect((thrown as CampaignQuotaExceededError).remaining).toBe(5)
    expect((thrown as CampaignQuotaExceededError).requested).toBe(6)
    expect((thrown as CampaignQuotaExceededError).statusCode).toBe(409)
    expect((thrown as CampaignQuotaExceededError).error).toBe('quota_exceeded')

    // No state transition and no dispatch on a rejected send (never truncate).
    expect(mocks.putCampaign).not.toHaveBeenCalled()
    expect(mocks.lambdaSend).not.toHaveBeenCalled()
  })

  it('does not consume quota on a rejected send (only reads the counter, never writes)', async () => {
    mocks.getCampaignById.mockResolvedValue(makeCampaign({ status: 'draft' }))
    mocks.getEffectiveTier.mockReturnValue('pro') // quota 10000
    mocks.kvGet.mockResolvedValue('9999') // remaining 1
    mocks.resolveSegmentWithMeta.mockResolvedValue({ userIds: eligibleSetOf(2), truncated: false })

    await expect(sendCampaign(BUSINESS_ID, 'camp-1')).rejects.toBeInstanceOf(CampaignQuotaExceededError)

    // The service pre-check only reads the counter via kvGet; the dispatcher's
    // reserveQuota is the sole writer. The service must never increment.
    expect(mocks.kvGet).toHaveBeenCalledTimes(1)
  })

  it('rejects a send for a non-entitled tier (starter quota 0) without dispatching', async () => {
    mocks.getCampaignById.mockResolvedValue(makeCampaign({ status: 'draft' }))
    mocks.getEffectiveTier.mockReturnValue('starter') // quota 0
    mocks.kvGet.mockResolvedValue(null)
    mocks.resolveSegmentWithMeta.mockResolvedValue({ userIds: eligibleSetOf(1), truncated: false })

    await expect(sendCampaign(BUSINESS_ID, 'camp-1')).rejects.toBeInstanceOf(CampaignQuotaExceededError)
    expect(mocks.putCampaign).not.toHaveBeenCalled()
    expect(mocks.lambdaSend).not.toHaveBeenCalled()
  })

  it('allows a zero-eligible send (no recipients survive filtering) regardless of quota', async () => {
    // Even when the month is exhausted, sending 0 recipients fits any remaining
    // quota (0 ≤ 0) and is not rejected by the quota guard.
    mocks.getCampaignById.mockResolvedValue(makeCampaign({ status: 'draft' }))
    mocks.getEffectiveTier.mockReturnValue('growth')
    mocks.kvGet.mockResolvedValue('2000') // remaining 0
    mocks.resolveSegmentWithMeta.mockResolvedValue({ userIds: eligibleSetOf(10), truncated: false })
    mocks.filterByConsentAndOptOut.mockResolvedValue([]) // all filtered by consent

    const result = await sendCampaign(BUSINESS_ID, 'camp-1')
    expect(result.status).toBe('sending')
  })

  it('counts the realistic post-filter eligible set, not the raw segment size', async () => {
    // Raw segment 100, but only 3 survive consent+freq-cap → eligible 3.
    // remaining is 4, so the send must be allowed (3 ≤ 4) even though 100 > 4.
    mocks.getCampaignById.mockResolvedValue(makeCampaign({ status: 'draft' }))
    mocks.getEffectiveTier.mockReturnValue('growth')
    mocks.kvGet.mockResolvedValue('1996') // remaining 4
    mocks.resolveSegmentWithMeta.mockResolvedValue({ userIds: eligibleSetOf(100), truncated: false })
    mocks.filterByConsentAndOptOut.mockResolvedValue(['u-0', 'u-1', 'u-2', 'u-3', 'u-4'])
    mocks.filterByFrequencyCap.mockResolvedValue(['u-0', 'u-1', 'u-2'])

    const result = await sendCampaign(BUSINESS_ID, 'camp-1')
    expect(result.status).toBe('sending')
  })
})

// ─── resolveEligibleCount (shared with task 7.3 estimate) ──────────────────────

describe('resolveEligibleCount', () => {
  it('runs segment → consent → frequency-cap and reports each stage count + truncated', async () => {
    mocks.resolveSegmentWithMeta.mockResolvedValue({
      userIds: ['u-1', 'u-2', 'u-3', 'u-4'],
      truncated: true,
    })
    mocks.filterByConsentAndOptOut.mockResolvedValue(['u-1', 'u-2', 'u-3'])
    mocks.filterByFrequencyCap.mockResolvedValue(['u-1', 'u-2'])

    const res = await resolveEligibleCount(BUSINESS_ID, makeCampaign(), 1_700_000_000_000)

    expect(res.segmentSize).toBe(4)
    expect(res.afterConsentFilter).toBe(3)
    expect(res.eligibleCount).toBe(2)
    expect(res.truncated).toBe(true)

    // Consent filter is scoped to the sending business; freq-cap is platform-wide.
    expect(mocks.filterByConsentAndOptOut).toHaveBeenCalledWith(['u-1', 'u-2', 'u-3', 'u-4'], BUSINESS_ID)
    expect(mocks.filterByFrequencyCap).toHaveBeenCalledWith(['u-1', 'u-2', 'u-3'])
  })

  it('does not transition or dispatch — it is a pure read', async () => {
    await resolveEligibleCount(BUSINESS_ID, makeCampaign())
    expect(mocks.putCampaign).not.toHaveBeenCalled()
    expect(mocks.lambdaSend).not.toHaveBeenCalled()
  })
})

// ─── estimateRecipients (task 7.3) ─────────────────────────────────────────────

describe('estimateRecipients', () => {
  it('maps the eligible resolution to a RecipientEstimate (R13.2, R13.5)', async () => {
    mocks.getCampaignById.mockResolvedValue(makeCampaign())
    mocks.resolveSegmentWithMeta.mockResolvedValue({
      userIds: ['u-1', 'u-2', 'u-3', 'u-4', 'u-5'],
      truncated: false,
    })
    mocks.filterByConsentAndOptOut.mockResolvedValue(['u-1', 'u-2', 'u-3', 'u-4'])
    mocks.filterByFrequencyCap.mockResolvedValue(['u-1', 'u-2'])

    const estimate = await estimateRecipients(BUSINESS_ID, 'camp-1')

    // segmentSize → segmentSize, afterConsentFilter → afterConsentFilter,
    // eligibleCount → estimatedRecipients (the realistic post-filter reach).
    expect(estimate.segmentSize).toBe(5)
    expect(estimate.afterConsentFilter).toBe(4)
    expect(estimate.estimatedRecipients).toBe(2)
    expect(estimate.truncated).toBe(false)

    // Consent filter is scoped to the sending business; freq-cap is platform-wide.
    expect(mocks.filterByConsentAndOptOut).toHaveBeenCalledWith(['u-1', 'u-2', 'u-3', 'u-4', 'u-5'], BUSINESS_ID)
    expect(mocks.filterByFrequencyCap).toHaveBeenCalledWith(['u-1', 'u-2', 'u-3', 'u-4'])
  })

  it('surfaces the truncated flag from the segment resolver (R14.4)', async () => {
    mocks.getCampaignById.mockResolvedValue(makeCampaign())
    mocks.resolveSegmentWithMeta.mockResolvedValue({ userIds: ['u-1'], truncated: true })

    const estimate = await estimateRecipients(BUSINESS_ID, 'camp-1')
    expect(estimate.truncated).toBe(true)
  })

  it('is a pure read: never transitions, dispatches, or consumes quota', async () => {
    mocks.getCampaignById.mockResolvedValue(makeCampaign())

    await estimateRecipients(BUSINESS_ID, 'camp-1')

    expect(mocks.putCampaign).not.toHaveBeenCalled()
    expect(mocks.lambdaSend).not.toHaveBeenCalled()
    // Estimate must not read or mutate the monthly quota counter.
    expect(mocks.kvGet).not.toHaveBeenCalled()
  })

  it('throws 404 when the campaign is not found', async () => {
    mocks.getCampaignById.mockResolvedValue(null)
    await expect(estimateRecipients(BUSINESS_ID, 'missing')).rejects.toBeInstanceOf(CampaignNotFoundError)
    // No resolution pipeline runs for a missing campaign.
    expect(mocks.resolveSegmentWithMeta).not.toHaveBeenCalled()
  })
})

// ─── computeAnalytics + attribution (task 7.4) ────────────────────────────────

describe('tallyOutcomes (pure delivery-outcome tally, R11.1)', () => {
  it('aggregates each outcome and computes attempted = all except no_channel', () => {
    const tally = tallyOutcomes([
      sendRecord('a', 'delivered_push'),
      sendRecord('b', 'delivered_push'),
      sendRecord('c', 'delivered_email'),
      sendRecord('d', 'delivered_both'),
      sendRecord('e', 'no_channel'),
      sendRecord('f', 'no_channel'),
      sendRecord('g', 'failed'),
    ])

    expect(tally.deliveredPush).toBe(2)
    expect(tally.deliveredEmail).toBe(1)
    expect(tally.deliveredBoth).toBe(1)
    expect(tally.noChannel).toBe(2)
    expect(tally.failed).toBe(1)
    // attempted excludes the 2 no_channel records: 2+1+1+1 = 5.
    expect(tally.attempted).toBe(5)
  })

  it('returns all-zero for an empty record set', () => {
    expect(tallyOutcomes([])).toEqual({
      attempted: 0,
      deliveredPush: 0,
      deliveredEmail: 0,
      deliveredBoth: 0,
      noChannel: 0,
      failed: 0,
    })
  })
})

describe('countAttributedReturns (pure attribution helper, R11.2/11.5)', () => {
  const CAMPAIGN_ID = 'camp-attr'
  const SALT = 'salt-attr'
  // Send time: 2025-03-01T00:00:00Z; default 14-day window.
  const SENT_AT_MS = new Date('2025-03-01T00:00:00.000Z').getTime()
  const WINDOW_DAYS = 14

  /** Token a messaged recipient would carry (matches the sender's derivation). */
  const tokenFor = (userId: string) => recipientToken(userId, CAMPAIGN_ID, SALT)

  it('counts each returning recipient at most once despite multiple check-ins (R11.5)', () => {
    const messaged = new Set([tokenFor('u-1'), tokenFor('u-2')])
    const checkIns = [
      { userId: 'u-1', checkedInAt: '2025-03-02T00:00:00.000Z' },
      { userId: 'u-1', checkedInAt: '2025-03-05T00:00:00.000Z' }, // same recipient again
      { userId: 'u-1', checkedInAt: '2025-03-10T00:00:00.000Z' }, // and again
      { userId: 'u-2', checkedInAt: '2025-03-03T00:00:00.000Z' },
    ]

    // u-1 (3 check-ins) + u-2 (1) → counted once each = 2.
    expect(countAttributedReturns(messaged, checkIns, CAMPAIGN_ID, SALT, SENT_AT_MS, WINDOW_DAYS)).toBe(2)
  })

  it('excludes check-ins outside the attribution window (R11.2)', () => {
    const messaged = new Set([tokenFor('u-1'), tokenFor('u-2'), tokenFor('u-3')])
    const checkIns = [
      { userId: 'u-1', checkedInAt: '2025-02-28T23:00:00.000Z' }, // before send → excluded
      { userId: 'u-2', checkedInAt: '2025-03-07T00:00:00.000Z' }, // within window → counted
      { userId: 'u-3', checkedInAt: '2025-03-20T00:00:00.000Z' }, // 19 days after, > 14 → excluded
    ]

    expect(countAttributedReturns(messaged, checkIns, CAMPAIGN_ID, SALT, SENT_AT_MS, WINDOW_DAYS)).toBe(1)
  })

  it('counts the window boundaries inclusively (exactly sentAt and exactly sentAt+window)', () => {
    const messaged = new Set([tokenFor('u-1'), tokenFor('u-2')])
    const endMs = SENT_AT_MS + WINDOW_DAYS * 24 * 60 * 60 * 1000
    const checkIns = [
      { userId: 'u-1', checkedInAt: new Date(SENT_AT_MS).toISOString() }, // exactly at send
      { userId: 'u-2', checkedInAt: new Date(endMs).toISOString() }, // exactly at window end
    ]

    expect(countAttributedReturns(messaged, checkIns, CAMPAIGN_ID, SALT, SENT_AT_MS, WINDOW_DAYS)).toBe(2)
  })

  it('excludes recipients not in the messaged set', () => {
    const messaged = new Set([tokenFor('u-1')])
    const checkIns = [
      { userId: 'u-1', checkedInAt: '2025-03-02T00:00:00.000Z' }, // messaged → counted
      { userId: 'u-2', checkedInAt: '2025-03-02T00:00:00.000Z' }, // never messaged → excluded
      { userId: 'stranger', checkedInAt: '2025-03-04T00:00:00.000Z' }, // excluded
    ]

    expect(countAttributedReturns(messaged, checkIns, CAMPAIGN_ID, SALT, SENT_AT_MS, WINDOW_DAYS)).toBe(1)
  })

  it('returns 0 when no recipients were messaged', () => {
    const checkIns = [{ userId: 'u-1', checkedInAt: '2025-03-02T00:00:00.000Z' }]
    expect(countAttributedReturns(new Set(), checkIns, CAMPAIGN_ID, SALT, SENT_AT_MS, WINDOW_DAYS)).toBe(0)
  })
})

describe('computeAnalytics (detail-view analytics, R11.1/11.2/11.4/11.5)', () => {
  const CAMPAIGN_ID = 'camp-1'
  const SALT = 'salt'
  const SENT_AT = '2025-03-01T00:00:00.000Z'
  const SENT_AT_MS = new Date(SENT_AT).getTime()

  /** A sent campaign whose tokens we can reproduce for attribution. */
  function sentCampaign(over: Partial<Campaign> = {}): Campaign {
    return makeCampaign({
      campaignId: CAMPAIGN_ID,
      campaignSalt: SALT,
      status: 'sent',
      sentAt: SENT_AT,
      attributionWindowDays: 14,
      nodeIds: ['node-1', 'node-2'],
      ...over,
    })
  }

  const tokenFor = (userId: string) => recipientToken(userId, CAMPAIGN_ID, SALT)

  it('tallies delivery from send records and attributes returns within the window', async () => {
    // u-1 and u-2 were messaged (delivered); u-3 had no_channel (not messaged).
    mocks.getCampaignById.mockResolvedValue(sentCampaign())
    mocks.getSendRecords.mockResolvedValue([
      sendRecord(tokenFor('u-1'), 'delivered_push'),
      sendRecord(tokenFor('u-2'), 'delivered_email'),
      sendRecord(tokenFor('u-3'), 'no_channel'),
    ])
    // Post-send check-ins: u-1 returns twice (count once), u-2 once, u-3 returns
    // but was never messaged (no_channel) so must not be attributed.
    mocks.getCheckInsByNode.mockResolvedValue({
      checkIns: [
        { userId: 'u-1', checkedInAt: '2025-03-02T00:00:00.000Z' },
        { userId: 'u-1', checkedInAt: '2025-03-06T00:00:00.000Z' },
        { userId: 'u-2', checkedInAt: '2025-03-09T00:00:00.000Z' },
        { userId: 'u-3', checkedInAt: '2025-03-04T00:00:00.000Z' },
      ],
      nextCursor: undefined,
    })

    const analytics = await computeAnalytics(sentCampaign())

    // Delivery tally from send records.
    expect(analytics.deliveredPush).toBe(1)
    expect(analytics.deliveredEmail).toBe(1)
    expect(analytics.noChannel).toBe(1)
    expect(analytics.messagesAttempted).toBe(2)
    // Attribution: u-1 (counted once) + u-2 = 2; u-3 excluded (no_channel).
    expect(analytics.attributedReturnVisits).toBe(2)
  })

  it('excludes post-window check-ins from attribution (R11.2)', async () => {
    mocks.getCampaignById.mockResolvedValue(sentCampaign())
    mocks.getSendRecords.mockResolvedValue([
      sendRecord(tokenFor('u-1'), 'delivered_push'),
      sendRecord(tokenFor('u-2'), 'delivered_push'),
    ])
    mocks.getCheckInsByNode.mockResolvedValue({
      checkIns: [
        { userId: 'u-1', checkedInAt: '2025-03-05T00:00:00.000Z' }, // within 14 days
        { userId: 'u-2', checkedInAt: '2025-04-01T00:00:00.000Z' }, // > 14 days → excluded
      ],
      nextCursor: undefined,
    })

    const analytics = await computeAnalytics(sentCampaign())
    expect(analytics.attributedReturnVisits).toBe(1)
  })

  it('does not attribute a return to a recipient who was never messaged', async () => {
    mocks.getCampaignById.mockResolvedValue(sentCampaign())
    mocks.getSendRecords.mockResolvedValue([sendRecord(tokenFor('u-1'), 'delivered_push')])
    mocks.getCheckInsByNode.mockResolvedValue({
      checkIns: [
        { userId: 'u-1', checkedInAt: '2025-03-02T00:00:00.000Z' }, // messaged → counted
        { userId: 'u-99', checkedInAt: '2025-03-02T00:00:00.000Z' }, // not in send records
      ],
      nextCursor: undefined,
    })

    const analytics = await computeAnalytics(sentCampaign())
    expect(analytics.attributedReturnVisits).toBe(1)
  })

  it('skips attribution (0) and the check-in scan when the campaign was never sent', async () => {
    mocks.getCampaignById.mockResolvedValue(sentCampaign({ status: 'draft', sentAt: undefined }))
    mocks.getSendRecords.mockResolvedValue([sendRecord(tokenFor('u-1'), 'delivered_push')])

    const analytics = await computeAnalytics(sentCampaign({ status: 'draft', sentAt: undefined }))

    expect(analytics.attributedReturnVisits).toBe(0)
    // No attribution scan happens without a send time.
    expect(mocks.getCheckInsByNode).not.toHaveBeenCalled()
  })

  it('skips attribution (0) when no recipient was messaged (all no_channel)', async () => {
    mocks.getCampaignById.mockResolvedValue(sentCampaign())
    mocks.getSendRecords.mockResolvedValue([
      sendRecord(tokenFor('u-1'), 'no_channel'),
      sendRecord(tokenFor('u-2'), 'no_channel'),
    ])

    const analytics = await computeAnalytics(sentCampaign())

    expect(analytics.attributedReturnVisits).toBe(0)
    // No messaged tokens → no need to scan check-ins.
    expect(mocks.getCheckInsByNode).not.toHaveBeenCalled()
  })

  it('keeps targeted/filtered from the stored campaign counts (R11.1)', async () => {
    mocks.getCampaignById.mockResolvedValue(sentCampaign())
    mocks.getSendRecords.mockResolvedValue([])

    const analytics = await computeAnalytics(sentCampaign())

    // makeCampaign() stored counts: targeted 10, filteredConsent 2, freqCap 1.
    expect(analytics.recipientsTargeted).toBe(10)
    expect(analytics.filteredByConsent).toBe(2)
    expect(analytics.filteredByFrequencyCap).toBe(1)
  })

  it('produces only aggregate counts — no userId/email/phone leaks (R11.4 / C1)', async () => {
    mocks.getCampaignById.mockResolvedValue(sentCampaign())
    mocks.getSendRecords.mockResolvedValue([sendRecord(tokenFor('user-uuid-1'), 'delivered_push')])
    mocks.getCheckInsByNode.mockResolvedValue({
      checkIns: [{ userId: 'user-uuid-1', checkedInAt: '2025-03-02T00:00:00.000Z' }],
      nextCursor: undefined,
    })

    const analytics = await computeAnalytics(sentCampaign())
    const serialized = JSON.stringify(analytics).toLowerCase()

    expect(serialized).not.toContain('user-uuid-1')
    expect(serialized).not.toContain('phone')
    expect(serialized).not.toContain('email@')
    expect(serialized).not.toContain('@')
    // Every analytics value is a number (pure aggregate).
    for (const v of Object.values(analytics)) {
      expect(typeof v).toBe('number')
    }
  })
})
