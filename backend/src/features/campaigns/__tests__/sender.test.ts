/**
 * Unit tests for the Win-Back Campaigns sender Lambda.
 *
 * Covers the pure outcome-resolution logic (`resolveOutcome`,
 * `shouldIncrementFrequencyCap`) and the end-to-end batch behaviour
 * (`handler`) with the delivery rails stubbed:
 *   - push-only with no active token → `no_channel` (Requirement 5.5)
 *   - email-only with no verified email → `no_channel` (email analogue)
 *   - both channels, partial failure → the succeeding channel's outcome
 *   - frequency cap incremented once iff at least one attempt was made (R7.2)
 *   - per-recipient failure does not abort the batch (R10.3)
 *   - send records carry only the anonymized token (R11.4 / C1)
 *
 * The only consumer identifier handled is `userId` (transient); no phone number
 * appears anywhere (Constraint C1).
 *
 * _Requirements: 5.1, 5.2, 5.5, 7.2, 10.2, 10.3, 11.4, 14.2_
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  sendCampaignEmail: vi.fn(),
  incrementFrequencyCap: vi.fn(),
  getCampaignById: vi.fn(),
  getRecipientEmails: vi.fn(),
  putSendRecord: vi.fn(),
  findBusinessById: vi.fn(),
}))

vi.mock('../../notifications/service.js', () => ({
  sendNotification: mocks.sendNotification,
}))
vi.mock('../../../shared/email/ses.js', () => ({
  sendCampaignEmail: mocks.sendCampaignEmail,
}))
vi.mock('../eligibility.js', () => ({
  incrementFrequencyCap: mocks.incrementFrequencyCap,
}))
vi.mock('../repository.js', () => ({
  getCampaignById: mocks.getCampaignById,
  getRecipientEmails: mocks.getRecipientEmails,
  putSendRecord: mocks.putSendRecord,
}))
vi.mock('../../business/repository.js', () => ({
  findBusinessById: mocks.findBusinessById,
}))

import { handler, resolveOutcome, shouldIncrementFrequencyCap, type ChannelAttempts } from '../sender.js'
import type { Campaign, CampaignChannel, CampaignSendMessage } from '../types.js'

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeCampaign(channels: CampaignChannel[], overrides: Partial<Campaign> = {}): Campaign {
  return {
    campaignId: 'camp-1',
    businessId: 'biz-1',
    status: 'sending',
    segment: 'lapsed',
    nodeIds: ['node-1'],
    title: 'We miss you',
    body: 'Come back for 20% off',
    channels,
    createdAt: '2025-01-01T00:00:00.000Z',
    sentAt: '2025-01-02T00:00:00.000Z',
    attributionWindowDays: 14,
    campaignSalt: 'salt-abc',
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
    ...overrides,
  }
}

function makeEvent(recipients: Array<{ token: string; userId: string }>): {
  Records: Array<{ body: string; messageId: string; receiptHandle: string }>
} {
  const message: CampaignSendMessage = { campaignId: 'camp-1', businessId: 'biz-1', recipients }
  return { Records: [{ body: JSON.stringify(message), messageId: 'm-1', receiptHandle: 'r-1' }] }
}

const attempts = (over: Partial<ChannelAttempts>): ChannelAttempts => ({
  pushAttempted: false,
  pushSucceeded: false,
  emailAttempted: false,
  emailSucceeded: false,
  ...over,
})

// ─── resolveOutcome ─────────────────────────────────────────────────────────

describe('resolveOutcome', () => {
  it('returns no_channel when neither channel was attempted', () => {
    expect(resolveOutcome(attempts({}))).toBe('no_channel')
  })

  it('returns delivered_both when both channels succeed', () => {
    expect(
      resolveOutcome(
        attempts({ pushAttempted: true, pushSucceeded: true, emailAttempted: true, emailSucceeded: true }),
      ),
    ).toBe('delivered_both')
  })

  it('returns delivered_push when only push succeeds', () => {
    expect(resolveOutcome(attempts({ pushAttempted: true, pushSucceeded: true }))).toBe('delivered_push')
  })

  it('returns delivered_email when only email succeeds', () => {
    expect(resolveOutcome(attempts({ emailAttempted: true, emailSucceeded: true }))).toBe('delivered_email')
  })

  it('returns failed when an attempt was made but nothing delivered', () => {
    expect(resolveOutcome(attempts({ pushAttempted: true }))).toBe('failed')
    expect(resolveOutcome(attempts({ emailAttempted: true }))).toBe('failed')
    expect(resolveOutcome(attempts({ pushAttempted: true, emailAttempted: true }))).toBe('failed')
  })

  it('returns the succeeding channel when one channel fails and the other succeeds', () => {
    expect(
      resolveOutcome(
        attempts({ pushAttempted: true, pushSucceeded: false, emailAttempted: true, emailSucceeded: true }),
      ),
    ).toBe('delivered_email')
    expect(
      resolveOutcome(
        attempts({ pushAttempted: true, pushSucceeded: true, emailAttempted: true, emailSucceeded: false }),
      ),
    ).toBe('delivered_push')
  })
})

describe('shouldIncrementFrequencyCap', () => {
  it('is false only when no channel was attempted (Requirement 7.2)', () => {
    expect(shouldIncrementFrequencyCap(attempts({}))).toBe(false)
    expect(shouldIncrementFrequencyCap(attempts({ pushAttempted: true }))).toBe(true)
    expect(shouldIncrementFrequencyCap(attempts({ emailAttempted: true }))).toBe(true)
  })
})

// ─── handler (end-to-end batch) ───────────────────────────────────────────────

describe('campaign-sender handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRecipientEmails.mockResolvedValue(new Map())
    mocks.putSendRecord.mockResolvedValue(undefined)
    mocks.incrementFrequencyCap.mockResolvedValue(undefined)
    mocks.sendCampaignEmail.mockResolvedValue(undefined)
    mocks.findBusinessById.mockResolvedValue({ businessId: 'biz-1', businessName: 'The Spot' })
  })

  it('records no_channel and does not increment the cap for push-only with no token (R5.5, R7.2)', async () => {
    mocks.getCampaignById.mockResolvedValue(makeCampaign(['push']))
    mocks.sendNotification.mockResolvedValue({ delivered: 'no_tokens' })

    await handler(makeEvent([{ token: 'tok-1', userId: 'user-1' }]))

    expect(mocks.putSendRecord).toHaveBeenCalledTimes(1)
    const [campaignId, record] = mocks.putSendRecord.mock.calls[0]!
    expect(campaignId).toBe('camp-1')
    expect(record.channelOutcome).toBe('no_channel')
    expect(record.recipientToken).toBe('tok-1')
    expect(mocks.incrementFrequencyCap).not.toHaveBeenCalled()
  })

  it('records no_channel for email-only with no verified email', async () => {
    mocks.getCampaignById.mockResolvedValue(makeCampaign(['email']))
    mocks.getRecipientEmails.mockResolvedValue(new Map()) // no email resolved

    await handler(makeEvent([{ token: 'tok-2', userId: 'user-2' }]))

    const [, record] = mocks.putSendRecord.mock.calls[0]!
    expect(record.channelOutcome).toBe('no_channel')
    expect(mocks.sendCampaignEmail).not.toHaveBeenCalled()
    expect(mocks.incrementFrequencyCap).not.toHaveBeenCalled()
  })

  it('delivers email and records delivered_email when a verified email exists', async () => {
    mocks.getCampaignById.mockResolvedValue(makeCampaign(['email']))
    mocks.getRecipientEmails.mockResolvedValue(new Map([['user-3', 'user3@example.com']]))

    await handler(makeEvent([{ token: 'tok-3', userId: 'user-3' }]))

    expect(mocks.sendCampaignEmail).toHaveBeenCalledTimes(1)
    const emailArgs = mocks.sendCampaignEmail.mock.calls[0]!
    expect(emailArgs[0]).toBe('user3@example.com')
    expect(emailArgs[1]).toBe('The Spot')
    // unsubscribe URL is the last arg and points at the documented route
    expect(emailArgs[4]).toContain('/v1/campaigns/unsubscribe?token=')
    const [, record] = mocks.putSendRecord.mock.calls[0]!
    expect(record.channelOutcome).toBe('delivered_email')
    expect(mocks.incrementFrequencyCap).toHaveBeenCalledWith('user-3')
  })

  it('records delivered_both when push and email both succeed', async () => {
    mocks.getCampaignById.mockResolvedValue(makeCampaign(['push', 'email']))
    mocks.sendNotification.mockResolvedValue({ delivered: 'push', count: 1 })
    mocks.getRecipientEmails.mockResolvedValue(new Map([['user-4', 'user4@example.com']]))

    await handler(makeEvent([{ token: 'tok-4', userId: 'user-4' }]))

    const [, record] = mocks.putSendRecord.mock.calls[0]!
    expect(record.channelOutcome).toBe('delivered_both')
    expect(mocks.incrementFrequencyCap).toHaveBeenCalledTimes(1)
  })

  it('records the succeeding channel on partial failure (push fails, email succeeds)', async () => {
    mocks.getCampaignById.mockResolvedValue(makeCampaign(['push', 'email']))
    mocks.sendNotification.mockRejectedValue(new Error('push exploded'))
    mocks.getRecipientEmails.mockResolvedValue(new Map([['user-5', 'user5@example.com']]))

    await handler(makeEvent([{ token: 'tok-5', userId: 'user-5' }]))

    const [, record] = mocks.putSendRecord.mock.calls[0]!
    expect(record.channelOutcome).toBe('delivered_email')
    // an attempt was made → cap incremented
    expect(mocks.incrementFrequencyCap).toHaveBeenCalledWith('user-5')
  })

  it('continues the batch when one recipient delivery fails (R10.3)', async () => {
    mocks.getCampaignById.mockResolvedValue(makeCampaign(['push']))
    mocks.sendNotification
      .mockResolvedValueOnce({ delivered: 'push', count: 1 }) // user-a ok
      .mockResolvedValueOnce({ delivered: 'push', count: 1 }) // user-c ok
    // putSendRecord throws for the middle recipient's first write, then succeeds for the failure record
    mocks.putSendRecord
      .mockResolvedValueOnce(undefined) // user-a record
      .mockRejectedValueOnce(new Error('ddb blip')) // user-b record throws
      .mockResolvedValue(undefined) // user-b failure record + user-c record

    await handler(
      makeEvent([
        { token: 'tok-a', userId: 'user-a' },
        { token: 'tok-b', userId: 'user-b' },
        { token: 'tok-c', userId: 'user-c' },
      ]),
    )

    // All three recipients attempted delivery despite the middle failure.
    expect(mocks.sendNotification).toHaveBeenCalledTimes(3)
    // user-c still got its record written.
    const tokensWritten = mocks.putSendRecord.mock.calls.map((c) => c[1].recipientToken)
    expect(tokensWritten).toContain('tok-c')
  })

  it('never persists a userId, email, or phone in the send record (R11.4 / C1)', async () => {
    mocks.getCampaignById.mockResolvedValue(makeCampaign(['email']))
    mocks.getRecipientEmails.mockResolvedValue(new Map([['user-6', 'user6@example.com']]))

    await handler(makeEvent([{ token: 'tok-6', userId: 'user-6' }]))

    const [, record] = mocks.putSendRecord.mock.calls[0]!
    const serialized = JSON.stringify(record)
    expect(serialized).not.toContain('user-6')
    expect(serialized).not.toContain('user6@example.com')
    expect(Object.keys(record).sort()).toEqual(['attemptedAt', 'channelOutcome', 'recipientToken'])
  })

  it('skips the batch when the campaign cannot be loaded', async () => {
    mocks.getCampaignById.mockResolvedValue(null)

    await handler(makeEvent([{ token: 'tok-x', userId: 'user-x' }]))

    expect(mocks.putSendRecord).not.toHaveBeenCalled()
    expect(mocks.sendNotification).not.toHaveBeenCalled()
  })
})
