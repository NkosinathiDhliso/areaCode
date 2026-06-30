import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { AWS_REGION } from '../../shared/config/env.js'
import { findBusinessById } from '../business/repository.js'
import { getEffectiveTier } from '../business/service.js'
import { recipientToken } from './anonymize.js'
import { filterByConsentAndOptOut, filterByFrequencyCap } from './eligibility.js'
import { QuotaExceededError, reserveQuota } from './quota.js'
import { getCampaignById, updateCampaignCounts } from './repository.js'
import { resolveSegment } from './segment-resolver.js'
import type { Campaign, CampaignSendMessage, DispatchCampaignEvent } from './types.js'

// ============================================================================
// Win-Back Campaigns — Campaign Dispatcher Lambda
// ----------------------------------------------------------------------------
// Invoked async on send-now (directly by the campaign service) and by the
// EventBridge 5-minute tick for due `scheduled` campaigns. The dispatcher:
//
//   1. Loads the campaign and asserts it is dispatchable (status `sending`, or
//      a `scheduled` campaign whose `scheduledAt` has passed).
//   2. Resolves the segment to a deduplicated set of userIds.
//   3. Filters by marketing consent + opt-out (Requirements 6.1, 6.2).
//   4. Filters by the platform-wide frequency cap (Requirement 7.1).
//   5. Reserves the eligible count against the business's monthly send quota,
//      rejecting the whole send if it would overflow (Requirements 9.3, 9.4).
//   6. Tokenizes the eligible recipients (anonymized, per-campaign salt).
//   7. Chunks recipients into batches of ≤100 and publishes one SQS message per
//      batch (Requirement 10.1).
//   8. Persists targeted/filtered counts on the campaign run (Requirement 11.1).
//
// Constraint C1 (no SMS / no phone): the only consumer identifier handled here
// is `userId`, used transiently to deliver. Only the anonymized `token` is ever
// persisted (in send records, by the sender). No phone number is read anywhere.
// Constraint C2 (serverless-only): runs as an arm64 Lambda with no dependency
// on any always-on resource.
// ============================================================================

/** Maximum recipients per SQS message / sender batch (Requirement 10.1). */
export const MAX_BATCH_SIZE = 100

/**
 * Queue-URL environment variable for the campaign-send SQS queue.
 *
 * Matches the reports feature's `AREA_CODE_REPORT_QUEUE_URL` naming convention.
 * Task 10.1/10.3 must wire this env var from `module.sqs_campaign_send.queue_url`
 * on the campaign-dispatcher Lambda.
 */
export const CAMPAIGN_SEND_QUEUE_URL_ENV = 'AREA_CODE_CAMPAIGN_SEND_QUEUE_URL'

const sqsClient = new SQSClient({ region: AWS_REGION })

// ----------------------------------------------------------------------------
// Pure helpers (exported for property tests — Property 10)
// ----------------------------------------------------------------------------

/**
 * Partition a list into disjoint chunks of at most `size`, in order.
 *
 * Property 10 (Batch Partitioning Invariant): the union of the returned chunks
 * equals the input exactly (no element dropped or duplicated), every chunk has
 * size ≤ `size`, and chunks are pairwise disjoint by position.
 */
export function chunk<T>(items: readonly T[], size: number = MAX_BATCH_SIZE): T[][] {
  if (size < 1) throw new Error('chunk size must be >= 1')
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size))
  }
  return batches
}

/**
 * Derive anonymized `{ token, userId }` pairs for a set of eligible userIds.
 *
 * The `userId` is carried only so the sender can actually deliver; it is never
 * persisted. The `token` is the one-way per-campaign hash recorded in send
 * records and analytics (Constraint C1, Requirement 11.4).
 */
export function tokenizeRecipients(
  userIds: readonly string[],
  campaignId: string,
  campaignSalt: string,
): Array<{ token: string; userId: string }> {
  return userIds.map((userId) => ({
    token: recipientToken(userId, campaignId, campaignSalt),
    userId,
  }))
}

/**
 * Whether a campaign may be dispatched right now.
 *
 * - `sending`: send-now path — the service has already locked the campaign by
 *   transitioning it to `sending`.
 * - `scheduled`: only when `scheduledAt` has passed (the EventBridge tick path).
 * - anything else (`draft`/`sent`/`sending`-already-run/`cancelled`/`failed`):
 *   not dispatchable. A `sent` campaign in particular must never re-dispatch
 *   (Requirement 8.6 / Property 9).
 */
export function isDispatchable(campaign: Pick<Campaign, 'status' | 'scheduledAt'>, nowMs: number): boolean {
  if (campaign.status === 'sending') return true
  if (campaign.status === 'scheduled') {
    if (!campaign.scheduledAt) return false
    return new Date(campaign.scheduledAt).getTime() <= nowMs
  }
  return false
}

// ----------------------------------------------------------------------------
// SQS fan-out
// ----------------------------------------------------------------------------

async function publishBatch(queueUrl: string, message: CampaignSendMessage): Promise<void> {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
    }),
  )
}

// ----------------------------------------------------------------------------
// Tier resolution
// ----------------------------------------------------------------------------

/**
 * Resolve the business's effective subscription tier (honouring trial expiry),
 * used to determine the monthly send quota. Defaults to `starter` (quota 0)
 * when the business cannot be loaded, so an unresolved business can never
 * dispatch.
 */
async function resolveBusinessTier(businessId: string): Promise<string> {
  const biz = await findBusinessById(businessId)
  if (!biz) return 'starter'
  return getEffectiveTier(biz as { tier?: string; trialEndsAt?: string | null })
}

// ----------------------------------------------------------------------------
// Lambda handler
// ----------------------------------------------------------------------------

/**
 * Campaign dispatcher Lambda handler.
 *
 * Idempotent with respect to campaign status: a campaign that is not
 * dispatchable (already `sent`, `cancelled`, still `draft`, or a `scheduled`
 * campaign that is not yet due) is skipped without publishing any messages.
 */
export async function handler(event: DispatchCampaignEvent): Promise<void> {
  const { businessId, campaignId } = event
  const nowMs = Date.now()

  console.log(`[campaign-dispatcher] start businessId=${businessId} campaignId=${campaignId}`)

  const queueUrl = process.env[CAMPAIGN_SEND_QUEUE_URL_ENV]
  if (!queueUrl) {
    console.error(`[campaign-dispatcher] ${CAMPAIGN_SEND_QUEUE_URL_ENV} not set`)
    return
  }

  const campaign = await getCampaignById(businessId, campaignId)
  if (!campaign) {
    console.error(`[campaign-dispatcher] campaign not found businessId=${businessId} campaignId=${campaignId}`)
    return
  }

  if (!isDispatchable(campaign, nowMs)) {
    console.log(
      `[campaign-dispatcher] skip — not dispatchable status=${campaign.status} scheduledAt=${campaign.scheduledAt ?? 'none'}`,
    )
    return
  }

  // 2. Resolve the audience segment (deduped userIds).
  const targetedUserIds = await resolveSegment({
    segment: campaign.segment,
    nodeIds: campaign.nodeIds,
    lapsedWindowDays: campaign.lapsedWindowDays ?? 21,
    nowMs,
  })

  // 3. Marketing consent + opt-out filter (POPIA).
  const consented = await filterByConsentAndOptOut(targetedUserIds, businessId)

  // 4. Platform-wide frequency-cap filter.
  const eligible = await filterByFrequencyCap(consented)

  const targeted = targetedUserIds.length
  const filteredConsent = targeted - consented.length
  const filteredFreqCap = consented.length - eligible.length

  // 5. Reserve the eligible count against the monthly quota. Reject whole on
  //    overflow — never truncate (Requirement 9.4 / Property 8).
  const tier = await resolveBusinessTier(businessId)
  try {
    await reserveQuota({ businessId, tier, count: eligible.length, nowMs })
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      console.error(
        `[campaign-dispatcher] quota exceeded — rejecting whole send. tier=${tier} ` +
          `eligible=${eligible.length} remaining=${error.remaining}. Dispatched 0 batches.`,
      )
      // Persist the resolution counts; dispatch nothing (Requirement 9.4).
      await updateCampaignCounts(campaign, { targeted, filteredConsent, filteredFreqCap })
      return
    }
    throw error
  }

  // 6. Tokenize eligible recipients (anonymized). userId is transient.
  const recipients = tokenizeRecipients(eligible, campaignId, campaign.campaignSalt)

  // 7. Chunk into batches of ≤100 and publish one SQS message per batch.
  const batches = chunk(recipients, MAX_BATCH_SIZE)
  for (const batch of batches) {
    const message: CampaignSendMessage = { campaignId, businessId, recipients: batch }
    await publishBatch(queueUrl, message)
  }

  // 8. Persist targeted/filtered counts on the campaign run (Requirement 11.1).
  await updateCampaignCounts(campaign, { targeted, filteredConsent, filteredFreqCap })

  console.log(
    `[campaign-dispatcher] complete campaignId=${campaignId} targeted=${targeted} ` +
      `filteredConsent=${filteredConsent} filteredFreqCap=${filteredFreqCap} ` +
      `eligible=${eligible.length} batches=${batches.length}`,
  )
}
