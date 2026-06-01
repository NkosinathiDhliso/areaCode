import { findBusinessById } from '../business/repository.js'
import { sendNotification } from '../notifications/service.js'
import { sendCampaignEmail } from '../../shared/email/ses.js'
import { incrementFrequencyCap } from './eligibility.js'
import { getCampaignById, getRecipientEmails, putSendRecord } from './repository.js'
import { buildUnsubscribeUrl } from './unsubscribe.js'
import type { Campaign, CampaignSendMessage, ChannelOutcome } from './types.js'

// ============================================================================
// Win-Back Campaigns — Campaign Sender Lambda
// ----------------------------------------------------------------------------
// SQS-triggered worker that delivers one batch of a campaign (≤100 recipients,
// Requirement 10.1). For each recipient it:
//
//   1. Delivers via push (when the campaign includes the `push` channel) using
//      the existing `sendNotification` with `type: 'campaign'` (Requirement
//      5.1 / Constraint C3). A `no_tokens` result means the recipient has no
//      active push token.
//   2. Delivers via email (when the campaign includes the `email` channel)
//      using the existing SES `sendCampaignEmail` (Requirement 5.2 / C3). The
//      verified email is resolved from the users table (Cognito-verified at
//      sign-up); a recipient with no email cannot be reached by email.
//   3. Records exactly one anonymized `Campaign_Send_Record`
//      (`pk=CSEND#<campaignId>`, `sk=CSEND#<token>`, TTL 120 days) with the
//      per-recipient outcome (Requirements 10.2, 11.4, 14.2).
//   4. Increments the platform-wide frequency cap once, only when at least one
//      channel delivery was attempted (Requirement 7.2).
//
// Outcome logic:
//   - both channels requested → delivered_both if both succeed; the single
//     succeeding channel's outcome if only one does; failed if both fail.
//   - push-only with no active token → no_channel (Requirement 5.5).
//   - email-only with no verified email → no_channel (analogous).
//   - any unexpected per-recipient error → failed, and the batch continues
//     (Requirement 10.3).
//
// The frequency cap is NOT incremented for a pure `no_channel` recipient,
// because no delivery was attempted (Requirement 7.2: count only when at least
// one channel delivery is attempted).
//
// Constraint C1 (no SMS / no phone): the userId arrives transiently on the SQS
// message purely to deliver; only the anonymized `recipientToken` is persisted.
// No phone number is ever read, stored, or required. Email is resolved from the
// users table, never from a phone identifier.
// Constraint C2 (serverless-only): runs as an arm64 SQS-triggered Lambda with
// no dependency on any always-on resource.
// ============================================================================

// ----------------------------------------------------------------------------
// SQS event shape (mirrors reports/generator.ts)
// ----------------------------------------------------------------------------

interface SQSEvent {
  Records: Array<{
    body: string
    messageId: string
    receiptHandle: string
  }>
}

// ----------------------------------------------------------------------------
// Per-recipient outcome resolution (pure — exported for unit/property tests)
// ----------------------------------------------------------------------------

/** Whether each requested channel was attempted, and whether it succeeded. */
export interface ChannelAttempts {
  /** push channel requested AND an active token existed (delivery attempted). */
  pushAttempted: boolean
  pushSucceeded: boolean
  /** email channel requested AND a verified email existed (delivery attempted). */
  emailAttempted: boolean
  emailSucceeded: boolean
}

/**
 * Resolve the recorded outcome for a recipient from the per-channel attempts.
 *
 * - Neither channel attempted → `no_channel` (Requirement 5.5 and its email
 *   analogue): the requested channel(s) had no reachable destination.
 * - At least one attempt, no success → `failed` (Requirement 10.3).
 * - Both succeeded → `delivered_both`.
 * - Exactly one succeeded → `delivered_push` / `delivered_email`.
 */
export function resolveOutcome(attempts: ChannelAttempts): ChannelOutcome {
  const { pushAttempted, pushSucceeded, emailAttempted, emailSucceeded } = attempts

  if (!pushAttempted && !emailAttempted) return 'no_channel'

  if (pushSucceeded && emailSucceeded) return 'delivered_both'
  if (pushSucceeded) return 'delivered_push'
  if (emailSucceeded) return 'delivered_email'

  // At least one channel was attempted but none delivered.
  return 'failed'
}

/** Whether the frequency cap should be incremented for this outcome. */
export function shouldIncrementFrequencyCap(attempts: ChannelAttempts): boolean {
  return attempts.pushAttempted || attempts.emailAttempted
}

// ----------------------------------------------------------------------------
// Single-recipient delivery
// ----------------------------------------------------------------------------

/**
 * Deliver a campaign to a single recipient across the campaign's channels and
 * return the resolved outcome. Never throws for an expected delivery failure —
 * SES/push errors are caught and surface as a non-success attempt so the batch
 * can continue (Requirement 10.3).
 */
async function deliverToRecipient(
  campaign: Campaign,
  userId: string,
  email: string | undefined,
): Promise<ChannelAttempts> {
  const channels = new Set(campaign.channels)
  const attempts: ChannelAttempts = {
    pushAttempted: false,
    pushSucceeded: false,
    emailAttempted: false,
    emailSucceeded: false,
  }

  // ── Push ──────────────────────────────────────────────────────────────────
  if (channels.has('push')) {
    try {
      const result = await sendNotification({
        userId,
        type: 'campaign',
        title: campaign.title,
        body: campaign.body,
        data: {
          campaignId: campaign.campaignId,
          businessId: campaign.businessId,
          ...(campaign.rewardId ? { rewardId: campaign.rewardId } : {}),
        },
        // Campaigns are gated by marketing consent + frequency cap upstream in
        // the dispatcher, not by transactional notification preferences
        // (Requirement 6.3). `campaign` has no preference mapping, so this is
        // effectively a no-op, but we keep the default behaviour explicit.
        skipPreferenceCheck: false,
      })

      // `no_tokens` means the recipient has no active push token → not an
      // attempt for the no_channel determination (Requirement 5.5).
      if (result.delivered === 'socket' || result.delivered === 'push') {
        attempts.pushAttempted = true
        attempts.pushSucceeded = true
      } else if (result.delivered === 'no_tokens' || result.delivered === 'preference_blocked') {
        // No reachable push destination — treat as "not attempted".
        attempts.pushAttempted = false
      } else {
        // rate_limited or any other non-delivery: a delivery was attempted but
        // did not succeed.
        attempts.pushAttempted = true
      }
    } catch (error) {
      console.error(`[campaign-sender] push delivery error campaignId=${campaign.campaignId}:`, error)
      attempts.pushAttempted = true
    }
  }

  // ── Email ───────────────────────────────────────────────────────────────────
  if (channels.has('email')) {
    if (email) {
      attempts.emailAttempted = true
      try {
        const businessName = await resolveBusinessName(campaign.businessId)
        const unsubscribeUrl = buildUnsubscribeUrl(userId, campaign.businessId)
        await sendCampaignEmail(email, businessName, campaign.title, campaign.body, unsubscribeUrl)
        attempts.emailSucceeded = true
      } catch (error) {
        console.error(`[campaign-sender] email delivery error campaignId=${campaign.campaignId}:`, error)
      }
    } else {
      // Email channel requested but no verified email → no reachable email
      // destination (analogue of Requirement 5.5 for email).
      attempts.emailAttempted = false
    }
  }

  return attempts
}

/** Resolve a business's display name for the email's "from" line (cached per batch). */
async function resolveBusinessName(businessId: string): Promise<string> {
  const cached = businessNameCache.get(businessId)
  if (cached !== undefined) return cached
  let name = 'a business you visited'
  try {
    const biz = await findBusinessById(businessId)
    if (biz?.businessName) name = biz.businessName
  } catch (error) {
    console.error(`[campaign-sender] failed to resolve business name businessId=${businessId}:`, error)
  }
  businessNameCache.set(businessId, name)
  return name
}

/** Per-invocation cache so we resolve the business name once per batch. */
const businessNameCache = new Map<string, string>()

// ----------------------------------------------------------------------------
// Batch processing
// ----------------------------------------------------------------------------

/**
 * Process a single SQS message (one batch of recipients). Loads the campaign
 * once, batch-resolves emails for the whole batch, then delivers per recipient
 * and writes one send record each.
 */
async function processBatch(message: CampaignSendMessage): Promise<void> {
  const { campaignId, businessId, recipients } = message

  const campaign = await getCampaignById(businessId, campaignId)
  if (!campaign) {
    console.error(`[campaign-sender] campaign not found businessId=${businessId} campaignId=${campaignId}`)
    return
  }

  const sentAtMs = campaign.sentAt ? new Date(campaign.sentAt).getTime() : Date.now()
  const needsEmail = campaign.channels.includes('email')

  // Batch-resolve verified emails once per batch when the email channel is used.
  const emailMap = needsEmail ? await getRecipientEmails(recipients.map((r) => r.userId)) : new Map<string, string>()

  for (const recipient of recipients) {
    try {
      const attempts = await deliverToRecipient(campaign, recipient.userId, emailMap.get(recipient.userId))
      const outcome = resolveOutcome(attempts)

      // Record the anonymized per-recipient outcome (token only — no userId).
      await putSendRecord(
        campaignId,
        {
          recipientToken: recipient.token,
          channelOutcome: outcome,
          attemptedAt: new Date().toISOString(),
        },
        sentAtMs,
      )

      // Count toward the frequency cap once, only when at least one channel
      // delivery was attempted (Requirement 7.2).
      if (shouldIncrementFrequencyCap(attempts)) {
        await incrementFrequencyCap(recipient.userId)
      }
    } catch (error) {
      // Per-recipient failure must not abort the batch (Requirement 10.3).
      console.error(`[campaign-sender] recipient delivery failed campaignId=${campaignId}:`, error)
      try {
        await putSendRecord(
          campaignId,
          {
            recipientToken: recipient.token,
            channelOutcome: 'failed',
            attemptedAt: new Date().toISOString(),
          },
          sentAtMs,
        )
      } catch (recordError) {
        console.error(`[campaign-sender] failed to write failure record campaignId=${campaignId}:`, recordError)
      }
    }
  }
}

// ----------------------------------------------------------------------------
// Lambda handler
// ----------------------------------------------------------------------------

/**
 * Campaign sender Lambda handler.
 *
 * Each SQS record is one batch. A record that throws bubbles up so SQS can
 * retry the whole batch (×2 → DLQ, Requirement 10.4); individual recipient
 * failures are absorbed inside `processBatch` so one bad recipient never fails
 * the batch (Requirement 10.3).
 */
export async function handler(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    // Reset the per-invocation business-name cache between batches.
    businessNameCache.clear()
    const message: CampaignSendMessage = JSON.parse(record.body)
    console.log(
      `[campaign-sender] processing batch messageId=${record.messageId} ` +
        `campaignId=${message.campaignId} recipients=${message.recipients.length}`,
    )
    await processBatch(message)
  }
}
