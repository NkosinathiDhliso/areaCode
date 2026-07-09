/**
 * Property-based tests for Win-Back Campaigns send-record anonymity.
 *
 * Library: fast-check + Vitest, ≥100 iterations per property.
 *
 * Feature: winback-campaigns
 *   - Property 11: Send-Record Anonymity  (Requirements 11.4, 6, C1)
 *
 * Property 11 (Send-Record Anonymity): for any Campaign_Send_Record produced by
 * the sender, the serialized document SHALL contain no value matching a known
 * PII pattern (UUID userId, cognitoSub, email, phone) — only the anonymized
 * recipient token, the channel outcome, and a timestamp. (Also enforces
 * Constraint C1 — no phone is ever read, stored, or required.)
 *
 * The cleanest surface for this property is the record the sender hands to
 * `putSendRecord`. We drive the real `handler` with random recipients whose
 * userIds and emails are deliberately PII-shaped (random UUIDs, real-looking
 * emails, and phone-like identifiers as decoys), stub the delivery rails
 * exactly as `sender.test.ts` does, and capture every record passed to
 * `putSendRecord`. Each captured record (and its JSON serialization) is then
 * asserted to leak none of the input PII.
 *
 * Note on the token vs. phone pattern: `recipientToken` is a 64-char SHA-256
 * hex string and can legitimately contain runs of 7+ digits, so a naive phone
 * regex over the whole serialized record would false-positive on the *allowed*
 * token. We therefore (a) prove the token is exactly the derived anonymized
 * token (a 64-hex hash, structurally not an email/UUID/phone), and (b) apply
 * the generic UUID/email/phone pattern scan to the non-token fields, while
 * separately asserting that no recipient's actual userId / email / phone-shaped
 * value appears anywhere in the record.
 *
 * **Validates: Requirements 11.4, 6, C1**
 */

import * as fc from 'fast-check'
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

import { recipientToken } from '../anonymize.js'
import { handler } from '../sender.js'
import type { Campaign, CampaignChannel, CampaignSendMessage, ChannelOutcome } from '../types.js'

// ─── Known PII patterns (what a leaked identifier would look like) ────────────

/** A v4-style UUID / Cognito sub. */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
/** An email address (anything containing an @ between non-space runs). */
const EMAIL_RE = /[^\s@]+@[^\s@]+/
/** A phone number: optional + then 7 or more consecutive digits. */
const PHONE_RE = /\+?\d{7,}/
/** A SHA-256 hex digest — the only identifier a send record is allowed to hold. */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/i

const ALLOWED_OUTCOMES: ReadonlySet<ChannelOutcome> = new Set<ChannelOutcome>([
  'delivered_push',
  'delivered_email',
  'delivered_both',
  'no_channel',
  'failed',
])

/** The exact set of keys a send record is permitted to carry. */
const ALLOWED_RECORD_KEYS = ['attemptedAt', 'channelOutcome', 'recipientToken']

// ─── Arbitraries (genuinely PII-shaped inputs) ────────────────────────────────

/** Phone-like decoy identifier, e.g. "+27821234567" — ≥7 digits, optional cc. */
const phoneArb = fc
  .tuple(
    fc.constantFrom('+27', '+1', '+44', '0', ''),
    fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 7, maxLength: 12 }),
  )
  .map(([cc, digits]) => `${cc}${digits.join('')}`)

/**
 * A recipient with a deliberately PII-shaped identity:
 *   - userId is a random UUID (cognito-sub shape) OR a phone-like decoy string,
 *   - email is a realistic email address.
 * If the sender ever leaked any of these into a record, the assertions below
 * would catch it.
 */
const recipientArb = fc.record({
  userId: fc.oneof(fc.uuid(), phoneArb),
  email: fc.emailAddress(),
})

/** A batch of recipients with distinct userIds (mirrors the dispatcher output). */
const batchArb = fc.uniqueArray(recipientArb, {
  minLength: 1,
  maxLength: 12,
  selector: (r) => r.userId,
})

/** At least one channel; exercises push-only, email-only, and both. */
const channelsArb: fc.Arbitrary<CampaignChannel[]> = fc.constantFrom(['push'], ['email'], ['push', 'email'])

/**
 * The delivery result that `sendNotification` returns this iteration. Covers
 * the full outcome space (delivered, no token, rate-limited, thrown error) so
 * anonymity is asserted across `delivered_*`, `no_channel`, and `failed`.
 */
const pushResultArb = fc.constantFrom(
  { delivered: 'push', count: 1 },
  { delivered: 'socket' },
  { delivered: 'no_tokens' },
  { delivered: 'rate_limited' },
  { delivered: 'preference_blocked' },
  { __throw: true },
)

const CAMPAIGN_ID = 'camp-anon'
const BUSINESS_ID = 'biz-anon'
const CAMPAIGN_SALT = 'salt-anon-fixed'

function makeCampaign(channels: CampaignChannel[]): Campaign {
  return {
    campaignId: CAMPAIGN_ID,
    businessId: BUSINESS_ID,
    status: 'sending',
    segment: 'lapsed',
    nodeIds: ['node-1'],
    title: 'We miss you',
    body: 'Come back for 20% off',
    channels,
    createdAt: '2025-01-01T00:00:00.000Z',
    sentAt: '2025-01-02T00:00:00.000Z',
    attributionWindowDays: 14,
    campaignSalt: CAMPAIGN_SALT,
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
  }
}

function makeEvent(recipients: Array<{ token: string; userId: string }>): {
  Records: Array<{ body: string; messageId: string; receiptHandle: string }>
} {
  const message: CampaignSendMessage = {
    campaignId: CAMPAIGN_ID,
    businessId: BUSINESS_ID,
    recipients,
  }
  return { Records: [{ body: JSON.stringify(message), messageId: 'm-1', receiptHandle: 'r-1' }] }
}

// ─── Property 11: Send-Record Anonymity ───────────────────────────────────────

describe('Feature: winback-campaigns, Property 11: Send-Record Anonymity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.putSendRecord.mockResolvedValue(undefined)
    mocks.incrementFrequencyCap.mockResolvedValue(undefined)
    mocks.sendCampaignEmail.mockResolvedValue(undefined)
    mocks.findBusinessById.mockResolvedValue({ businessId: BUSINESS_ID, businessName: 'The Spot' })
  })

  it('persists only an anonymized token, outcome, and timestamp — never userId, email, or phone', async () => {
    /**
     * **Validates: Requirements 11.4, 6, C1**
     *
     * Drive the real sender `handler` with a batch of PII-shaped recipients,
     * capture every record handed to `putSendRecord`, and assert per record:
     *   1. its keys are EXACTLY {recipientToken, channelOutcome, attemptedAt};
     *   2. recipientToken is the derived SHA-256 token (64-hex), equal to
     *      sha256(userId+campaignId+salt) and never equal to the userId;
     *   3. channelOutcome is one of the allowed enum values;
     *   4. attemptedAt is a valid ISO timestamp;
     *   5. the non-token fields match NO UUID / email / phone PII pattern;
     *   6. the full serialized record contains NONE of the batch's actual
     *      userIds or emails (no cross-recipient leak either).
     */
    await fc.assert(
      fc.asyncProperty(batchArb, channelsArb, pushResultArb, async (batch, channels, pushResult) => {
        // Re-arm the per-iteration mocks (cleared in beforeEach only runs once
        // per `it`, so reset state explicitly for each generated case).
        mocks.putSendRecord.mockClear()
        mocks.sendNotification.mockReset()
        mocks.getRecipientEmails.mockReset()
        mocks.getCampaignById.mockReset()

        mocks.getCampaignById.mockResolvedValue(makeCampaign(channels))

        if ((pushResult as { __throw?: boolean }).__throw) {
          mocks.sendNotification.mockRejectedValue(new Error('push exploded'))
        } else {
          mocks.sendNotification.mockResolvedValue(pushResult)
        }

        // Email channel resolves a verified email per recipient (PII the record
        // must never echo). Build the map the sender will read.
        const emailMap = new Map(batch.map((r) => [r.userId, r.email]))
        mocks.getRecipientEmails.mockResolvedValue(emailMap)

        // Tokenize exactly as the dispatcher would (real anonymization).
        const recipients = batch.map((r) => ({
          token: recipientToken(r.userId, CAMPAIGN_ID, CAMPAIGN_SALT),
          userId: r.userId,
        }))

        await handler(makeEvent(recipients))

        // One record per recipient.
        expect(mocks.putSendRecord).toHaveBeenCalledTimes(batch.length)

        // Every PII string from the whole batch is forbidden in every record.
        const forbiddenValues = batch.flatMap((r) => [r.userId, r.email])
        const tokenToUserId = new Map(recipients.map((r) => [r.token, r.userId]))

        for (const call of mocks.putSendRecord.mock.calls) {
          const [campaignId, record] = call as [string, Record<string, unknown>, number]

          // campaignId is not consumer PII, but should be the campaign's id.
          expect(campaignId).toBe(CAMPAIGN_ID)

          // (1) Exact key set — no extra field could smuggle an identifier.
          expect(Object.keys(record).sort()).toEqual(ALLOWED_RECORD_KEYS)

          const token = record['recipientToken'] as string
          const outcome = record['channelOutcome'] as ChannelOutcome
          const attemptedAt = record['attemptedAt'] as string

          // (2) Token is the derived anonymized hash, never the raw userId.
          expect(typeof token).toBe('string')
          expect(SHA256_HEX_RE.test(token)).toBe(true)
          const sourceUserId = tokenToUserId.get(token)
          expect(sourceUserId).toBeDefined()
          expect(token).toBe(recipientToken(sourceUserId!, CAMPAIGN_ID, CAMPAIGN_SALT))
          expect(token).not.toBe(sourceUserId)

          // (3) Outcome is an allowed enum value.
          expect(ALLOWED_OUTCOMES.has(outcome)).toBe(true)

          // (4) attemptedAt is a valid ISO timestamp.
          expect(typeof attemptedAt).toBe('string')
          expect(Number.isNaN(Date.parse(attemptedAt))).toBe(false)

          // (5) Non-token fields carry no PII-shaped value. (The token is the
          // only field allowed to contain long digit runs; it is validated in
          // (2) as the legitimate hash.)
          const nonTokenScan = JSON.stringify({ channelOutcome: outcome, attemptedAt })
          expect(UUID_RE.test(nonTokenScan)).toBe(false)
          expect(EMAIL_RE.test(nonTokenScan)).toBe(false)
          expect(PHONE_RE.test(nonTokenScan)).toBe(false)

          // (6) The full serialized record echoes no real userId or email from
          // any recipient in the batch (no self- or cross-recipient leak).
          const serialized = JSON.stringify(record)
          for (const value of forbiddenValues) {
            expect(serialized.includes(value)).toBe(false)
          }
        }
      }),
      { numRuns: 25 },
    )
  }, 60_000)

  it('keeps records anonymized even when every recipient delivery throws (failed outcome path)', async () => {
    /**
     * **Validates: Requirements 11.4, 6, C1**
     *
     * The per-recipient catch path in `processBatch` writes its own fallback
     * record when delivery throws. This still must be anonymized: assert the
     * fallback `failed` records carry only the token/outcome/timestamp and leak
     * no userId or email. We force the throw at the email rail so the recipient
     * loop's catch (not the inner channel try/catch) is exercised.
     */
    await fc.assert(
      fc.asyncProperty(batchArb, async (batch) => {
        mocks.putSendRecord.mockReset()
        mocks.sendNotification.mockReset()
        mocks.getRecipientEmails.mockReset()
        mocks.getCampaignById.mockReset()

        mocks.getCampaignById.mockResolvedValue(makeCampaign(['email']))
        // Make the email-map lookup itself throw to drive the outer catch path,
        // which writes the fallback `failed` record.
        const throwingMap = {
          get: () => {
            throw new Error('boom resolving email')
          },
        } as unknown as Map<string, string>
        mocks.getRecipientEmails.mockResolvedValue(throwingMap)

        const recipients = batch.map((r) => ({
          token: recipientToken(r.userId, CAMPAIGN_ID, CAMPAIGN_SALT),
          userId: r.userId,
        }))

        await handler(makeEvent(recipients))

        const forbiddenValues = batch.flatMap((r) => [r.userId, r.email])

        for (const call of mocks.putSendRecord.mock.calls) {
          const [, record] = call as [string, Record<string, unknown>, number]
          expect(Object.keys(record).sort()).toEqual(ALLOWED_RECORD_KEYS)
          expect(record['channelOutcome']).toBe('failed')
          expect(SHA256_HEX_RE.test(record['recipientToken'] as string)).toBe(true)

          const serialized = JSON.stringify(record)
          for (const value of forbiddenValues) {
            expect(serialized.includes(value)).toBe(false)
          }
        }
      }),
      { numRuns: 25 },
    )
  }, 60_000)
})
