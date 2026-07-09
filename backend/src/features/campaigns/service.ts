// ============================================================================
// Win-Back Campaigns — Campaign Service (lifecycle, quotas, analytics)
// ----------------------------------------------------------------------------
// This module is the service layer for campaigns. It owns the campaign
// lifecycle (create → send/schedule → cancel) plus the read paths (list,
// detail-with-analytics). It routes ALL campaign writes through the single
// `putCampaign` writer in `repository.ts` so the stored key shape stays
// consistent (Constraint C4 — single-table app-data).
//
// Constraint C1 (no SMS / no phone): the service never reads, stores, or
// requires a phone number. The only consumer identifier it ever touches is the
// transient `userId` inside the dispatcher (invoked async, out-of-process).
// Constraint C2 (serverless-only): send-now fans out by async-invoking the
// campaign-dispatcher Lambda — no always-on resource.
//
// ----------------------------------------------------------------------------
// SECTION MAP (task 7.1 implements §1–§5; downstream tasks ADD to the marked
// sections — keep additions inside their section to avoid collisions):
//
//   §1  Errors                 (7.1)
//   §2  Constants & helpers    (7.1)
//   §3  Ownership validation   (7.1)
//   §4  Lifecycle              (7.1)  createCampaign / sendCampaign / cancelCampaign
//   §5  Read paths             (7.1)  listCampaigns / getCampaign
//   §6  Send quota             (7.2)  ← add quota pre-check here
//   §7  Recipient estimate     (7.3)  ← add estimateRecipients here
//   §8  Analytics              (7.4)  ← replace analyticsFromCounts with computeAnalytics here
// ----------------------------------------------------------------------------
// ============================================================================

import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda'

import { AWS_REGION } from '../../shared/config/env.js'
import { generateId } from '../../shared/db/entities.js'
import { AppError } from '../../shared/errors/AppError.js'
import { kvGet } from '../../shared/kv/dynamodb-kv.js'
import { findBusinessById } from '../business/repository.js'
import { getEffectiveTier } from '../business/service.js'
import { getCheckInsByNode } from '../check-in/dynamodb-repository.js'
import { getNodesByBusinessId } from '../nodes/dynamodb-repository.js'
import { getRewardById } from '../rewards/repository.js'

import { generateCampaignSalt, recipientToken } from './anonymize.js'
import { filterByConsentAndOptOut, filterByFrequencyCap } from './eligibility.js'
import { assertWithinQuota, QuotaExceededError, quotaMonthKey } from './quota.js'
import { getCampaignById, getSendRecords, listCampaigns as listCampaignsFromRepo, putCampaign } from './repository.js'
import { resolveSegmentWithMeta } from './segment-resolver.js'
import type {
  Campaign,
  CampaignAnalytics,
  CampaignCounts,
  CampaignSendRecord,
  CampaignSummary,
  CampaignWithAnalytics,
  CreateCampaignInput,
  RecipientEstimate,
} from './types.js'

// ============================================================================
// §1 — Typed errors
// ----------------------------------------------------------------------------
// All campaign service errors extend `AppError`, so the global Fastify error
// handler (app.ts) serializes them to the correct status automatically, and the
// API handler (task 8.2) can additionally branch on `instanceof` if it needs
// to. The status/error-code mapping matches design.md's "API Errors" table.
// ============================================================================

/** A campaign was not found for the business (or belongs to another business). */
export class CampaignNotFoundError extends AppError {
  constructor(campaignId: string) {
    super(404, 'not_found', `Campaign ${campaignId} not found`)
    this.name = 'CampaignNotFoundError'
  }
}

/** One or more requested nodes are not owned by the business (Requirement 1.5). */
export class NodeNotOwnedError extends AppError {
  readonly nodeIds: string[]
  constructor(nodeIds: string[]) {
    super(403, 'forbidden', 'Node not owned by business')
    this.name = 'NodeNotOwnedError'
    this.nodeIds = nodeIds
  }
}

/** The optional reward does not belong to the business (Requirement 1.3). */
export class RewardNotOwnedError extends AppError {
  readonly rewardId: string
  constructor(rewardId: string) {
    super(403, 'forbidden', 'Reward not owned by business')
    this.name = 'RewardNotOwnedError'
    this.rewardId = rewardId
  }
}

/** Re-send attempted on a campaign already `sending` or `sent` (Requirement 8.6 / Property 9). */
export class CampaignAlreadySentError extends AppError {
  constructor(campaignId: string) {
    super(409, 'already_sent', `Campaign ${campaignId} has already been sent`)
    this.name = 'CampaignAlreadySentError'
  }
}

/** Send attempted from a non-draft, non-resendable state (e.g. cancelled/failed). */
export class CampaignNotSendableError extends AppError {
  constructor(campaignId: string, status: string) {
    super(409, 'invalid_state', `Campaign ${campaignId} cannot be sent from status '${status}'`)
    this.name = 'CampaignNotSendableError'
  }
}

/** Cancel attempted on a campaign that is not `draft` (Requirement 8.4). */
export class CampaignNotCancellableError extends AppError {
  constructor(campaignId: string, status: string) {
    super(409, 'invalid_state', `Campaign ${campaignId} cannot be cancelled from status '${status}'`)
    this.name = 'CampaignNotCancellableError'
  }
}

/**
 * A send was rejected because its eligible recipient count would exceed the
 * business's remaining monthly send quota (Requirements 9.3, 9.4 / Property 8).
 *
 * Maps to `409 { error: 'quota_exceeded', remaining: <n> }` (design.md "API
 * Errors"). Unlike the dispatcher-side `QuotaExceededError` (a plain Error used
 * as the atomic backstop), this is an `AppError` so the global Fastify error
 * handler serializes it to the correct status, and it carries `remaining` so
 * the API surfaces how much quota is left. The send is rejected WHOLE — the
 * campaign is never transitioned and no quota is consumed (never truncate).
 */
export class CampaignQuotaExceededError extends AppError {
  readonly remaining: number
  readonly requested: number
  constructor(remaining: number, requested: number) {
    super(
      409,
      'quota_exceeded',
      `Campaign send rejected: requested ${requested} recipients but only ${remaining} remain this month`,
    )
    this.name = 'CampaignQuotaExceededError'
    this.remaining = remaining
    this.requested = requested
  }
}

// ============================================================================
// §2 — Constants & helpers
// ============================================================================

/** Default attribution window for return-visit measurement (Requirement 11.2). */
const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 14

/** Default lapsed window when the segment is `lapsed` (Requirement 1.4). */
const DEFAULT_LAPSED_WINDOW_DAYS = 21

/**
 * Environment variable holding the campaign-dispatcher Lambda's function name
 * (or ARN). Send-now async-invokes this function with a `DispatchCampaignEvent`.
 *
 * SEAM FOR TERRAFORM (task 10.1): the API/monolith Lambda must set this env var
 * to `module.lambda_campaign_dispatcher.function_name` and be granted
 * `lambda:InvokeFunction` on it. Naming mirrors the reports feature's
 * `AREA_CODE_REPORT_QUEUE_URL` convention.
 */
export const CAMPAIGN_DISPATCHER_FUNCTION_ENV = 'AREA_CODE_CAMPAIGN_DISPATCHER_FUNCTION'

const lambdaClient = new LambdaClient({ region: AWS_REGION })

/** Compute the 13-month retention TTL (epoch seconds) for a campaign (Requirement 14.3). */
function campaignTtlSeconds(createdAtIso: string): number {
  const expiry = new Date(createdAtIso)
  expiry.setUTCMonth(expiry.getUTCMonth() + 13)
  return Math.floor(expiry.getTime() / 1000)
}

/** A freshly-zeroed counts block for a new draft campaign. */
function zeroedCounts(): CampaignCounts {
  return {
    targeted: 0,
    filteredConsent: 0,
    filteredFreqCap: 0,
    attempted: 0,
    deliveredPush: 0,
    deliveredEmail: 0,
    deliveredBoth: 0,
    noChannel: 0,
    failed: 0,
  }
}

/**
 * Async-invoke the campaign-dispatcher Lambda (fire-and-forget, `Event` type).
 *
 * Never throws: a send-now has already transitioned the campaign to `sending`
 * before this is called, so a failed invoke must not 500 the API. A failure is
 * logged loudly; the campaign is left in `sending` for manual re-trigger
 * (matching design.md's "Dispatcher fails before fan-out" recovery). When the
 * env var is unset (e.g. local/dev), the invoke is skipped with a warning.
 */
async function invokeDispatcher(businessId: string, campaignId: string): Promise<void> {
  const functionName = process.env[CAMPAIGN_DISPATCHER_FUNCTION_ENV]
  if (!functionName) {
    console.warn(
      `[campaigns/service] ${CAMPAIGN_DISPATCHER_FUNCTION_ENV} not set — skipping dispatcher invoke ` +
        `for campaignId=${campaignId}. Terraform task 10.1 must wire this env var.`,
    )
    return
  }

  try {
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'Event', // async fan-out; do not wait for the dispatcher
        Payload: Buffer.from(JSON.stringify({ businessId, campaignId })),
      }),
    )
  } catch (error) {
    console.error(
      `[campaigns/service] failed to invoke dispatcher for campaignId=${campaignId} ` +
        `(left in 'sending' for re-trigger):`,
      error,
    )
  }
}

// ============================================================================
// §3 — Ownership validation
// ----------------------------------------------------------------------------
// Reused by both `createCampaign` (Requirements 1.3, 1.5) and `sendCampaign`
// (re-validated at send time, since nodes/rewards can change between create and
// send). Node ownership is checked via the nodes BusinessIndex GSI; reward
// ownership via the reward's resolved node.businessId.
// ============================================================================

/**
 * Assert every nodeId is owned by the business. Throws `NodeNotOwnedError`
 * listing the offending ids if any node is not in the business's node set.
 * Rejecting here means no campaign is created/sent (Requirement 1.5).
 */
async function assertNodesOwned(businessId: string, nodeIds: string[]): Promise<void> {
  const ownedNodes = await getNodesByBusinessId(businessId)
  const ownedIds = new Set<string>()
  for (const n of ownedNodes) {
    const id = n.nodeId as string | undefined
    if (id) ownedIds.add(id)
  }

  const notOwned = [...new Set(nodeIds)].filter((id) => !ownedIds.has(id))
  if (notOwned.length > 0) {
    throw new NodeNotOwnedError(notOwned)
  }
}

/**
 * Assert the optional reward belongs to the business. A no-op when `rewardId`
 * is absent. Throws `RewardNotOwnedError` when the reward does not exist or its
 * node belongs to a different business (Requirement 1.3).
 */
async function assertRewardOwned(businessId: string, rewardId?: string): Promise<void> {
  if (!rewardId) return
  const reward = await getRewardById(rewardId)
  if (!reward || reward.node?.businessId !== businessId) {
    throw new RewardNotOwnedError(rewardId)
  }
}

// ============================================================================
// §4 — Lifecycle: create / send / cancel
// ============================================================================

/**
 * Create a new campaign in `draft` status (Requirements 1.1, 1.6).
 *
 * Validates node ownership (1.5) and optional reward ownership (1.3) BEFORE
 * persisting — a failed validation creates no campaign. Generates the
 * campaignId, the per-campaign anonymization salt, default windows, the
 * 13-month TTL, and a zeroed counts block, then writes through the single
 * `putCampaign` writer (key shape `pk=CAMPAIGN#<businessId>`, GSI1 list keys).
 */
export async function createCampaign(businessId: string, input: CreateCampaignInput): Promise<Campaign> {
  // Ownership gates first — reject before any write (Requirements 1.3, 1.5).
  await assertNodesOwned(businessId, input.nodeIds)
  await assertRewardOwned(businessId, input.rewardId)

  const createdAt = new Date().toISOString()
  const campaignId = generateId()

  const campaign: Campaign = {
    campaignId,
    businessId,
    status: 'draft',

    segment: input.segment,
    // lapsedWindowDays only carries meaning for the lapsed segment (R1.4).
    lapsedWindowDays: input.segment === 'lapsed' ? (input.lapsedWindowDays ?? DEFAULT_LAPSED_WINDOW_DAYS) : undefined,
    nodeIds: input.nodeIds,

    title: input.title,
    body: input.body,
    channels: input.channels,
    rewardId: input.rewardId,
    reportId: input.reportId,

    createdAt,
    attributionWindowDays: DEFAULT_ATTRIBUTION_WINDOW_DAYS,
    campaignSalt: generateCampaignSalt(),
    counts: zeroedCounts(),
    ttl: campaignTtlSeconds(createdAt),
  }

  await putCampaign(campaign)
  return campaign
}

/**
 * Send a `draft` campaign immediately (Requirements 8.2, 8.6).
 *
 * - Re-validates node + reward ownership at send time.
 * - Transitions to `sending`, stamps `sentAt`, and async-invokes the
 *   campaign-dispatcher Lambda for fan-out.
 * - Re-sending a `sending`/`sent` campaign is rejected (Property 9); sending
 *   from any other non-draft state is rejected as invalid.
 *
 * Send-quota enforcement (task 7.2, §6): the realistic eligible count is
 * resolved (segment → consent → frequency cap) and asserted against the
 * business's remaining monthly quota BEFORE the `sending` transition. If it
 * would exceed, a `CampaignQuotaExceededError` (409 `quota_exceeded`, with
 * `remaining`) is thrown and the campaign neither transitions nor dispatches —
 * and no quota is consumed (never truncate, Requirements 9.3, 9.4 / Property 8).
 * The dispatcher's `reserveQuota` remains the atomic backstop that actually
 * consumes the counter at fan-out.
 */
export async function sendCampaign(businessId: string, campaignId: string): Promise<Campaign> {
  const campaign = await getCampaignById(businessId, campaignId)
  if (!campaign) throw new CampaignNotFoundError(campaignId)

  // Idempotency / re-send guard (Requirement 8.6 / Property 9).
  if (campaign.status === 'sending' || campaign.status === 'sent') {
    throw new CampaignAlreadySentError(campaignId)
  }
  // Only a draft may be sent.
  if (campaign.status !== 'draft') {
    throw new CampaignNotSendableError(campaignId, campaign.status)
  }

  // Re-validate ownership at send time (nodes/rewards may have changed).
  await assertNodesOwned(businessId, campaign.nodeIds)
  await assertRewardOwned(businessId, campaign.rewardId)

  const nowMs = Date.now()

  // Send-now quota guard (Requirements 9.3, 9.4 / Property 8). Resolve the
  // realistic eligible count and assert it fits the remaining monthly quota
  // BEFORE transitioning to `sending`. Rejects the whole send (409) without
  // consuming quota or changing state when it would overflow.
  const { eligibleCount } = await resolveEligibleCount(businessId, campaign, nowMs)
  await assertSendWithinQuota(businessId, eligibleCount, nowMs)

  // Send now: transition to `sending` (the lock), stamp sentAt, then fan out.
  const sending: Campaign = {
    ...campaign,
    status: 'sending',
    sentAt: new Date(nowMs).toISOString(),
  }
  await putCampaign(sending)
  await invokeDispatcher(businessId, campaignId)
  return sending
}

/**
 * Cancel a `draft` campaign (Requirement 8.4).
 *
 * A campaign already `sending`, `sent`, `cancelled`, or `failed` is NOT
 * cancellable and is rejected with `CampaignNotCancellableError`.
 */
export async function cancelCampaign(businessId: string, campaignId: string): Promise<Campaign> {
  const campaign = await getCampaignById(businessId, campaignId)
  if (!campaign) throw new CampaignNotFoundError(campaignId)

  if (campaign.status !== 'draft') {
    throw new CampaignNotCancellableError(campaignId, campaign.status)
  }

  const cancelled: Campaign = { ...campaign, status: 'cancelled' }
  await putCampaign(cancelled)
  return cancelled
}

// ============================================================================
// §5 — Read paths: list / detail-with-analytics
// ============================================================================

/**
 * List a business's campaigns, newest first, with headline analytics
 * (Requirement 11.3, 13.3). Maps each stored campaign to the condensed
 * `CampaignSummary` shape; analytics are derived from the stored aggregate
 * counts only — no consumer identifiers are exposed (Requirement 11.4).
 *
 * LIST-vs-DETAIL ANALYTICS DECISION (task 7.4):
 * The list view intentionally uses the CHEAP stored-counts mapping
 * (`analyticsFromCounts`) for headline numbers and does NOT compute Attributed
 * Return Visits. Real attribution (`computeAnalytics`, §8) re-reads the send
 * records AND paginates post-send check-ins across every campaign node — an
 * unbounded per-node DynamoDB scan. Doing that for every campaign in a list
 * page would multiply that cost by the page size and blow the API latency
 * budget (Constraint C2 / Requirement 14.4 cost-predictability spirit). So the
 * list shows `attributedReturnVisits` from the cheap path (0 unless a future
 * task persists it onto the campaign), and the DETAIL view (`getCampaign`) is
 * the single place that pays for the real attribution computation.
 */
export async function listCampaigns(
  businessId: string,
  opts: { cursor?: string; limit?: number } = {},
): Promise<{ items: CampaignSummary[]; nextCursor?: string }> {
  const { items, nextCursor } = await listCampaignsFromRepo(businessId, opts)

  const summaries: CampaignSummary[] = items.map((c) => {
    const analytics = analyticsFromCounts(c)
    return {
      campaignId: c.campaignId,
      status: c.status,
      segment: c.segment,
      title: c.title,
      channels: c.channels,
      createdAt: c.createdAt,
      sentAt: c.sentAt,
      recipients: analytics.messagesAttempted,
      delivered: analytics.deliveredPush + analytics.deliveredEmail + analytics.deliveredBoth,
      attributedReturnVisits: analytics.attributedReturnVisits,
    }
  })

  return { items: summaries, nextCursor }
}

/**
 * Get a single campaign with its analytics (Requirement 11.3).
 *
 * Returns 404 (`CampaignNotFoundError`) when the campaign is not found for the
 * business. Analytics are aggregate-only (Requirement 11.4).
 *
 * This is the DETAIL view, so it awaits the full `computeAnalytics` (§8) which
 * tallies delivery outcomes from the send records AND computes Attributed
 * Return Visits by re-resolving recipient tokens against post-send check-ins
 * (Requirements 11.1, 11.2, 11.5). The cheaper stored-counts mapping is
 * reserved for the list view (`listCampaigns`).
 */
export async function getCampaign(businessId: string, campaignId: string): Promise<CampaignWithAnalytics> {
  const campaign = await getCampaignById(businessId, campaignId)
  if (!campaign) throw new CampaignNotFoundError(campaignId)

  return { ...campaign, analytics: await computeAnalytics(campaign) }
}

// ============================================================================
// §6 — Send quota (task 7.2)
// ----------------------------------------------------------------------------
// User-facing quota guard. The design enforces the monthly recipient quota
// "before fan-out" and rejects a send WHOLE when the realistic eligible count
// would exceed the remaining quota (Requirements 9.3, 9.4 / Property 8). The
// true eligible count is only known after segment resolution + consent + freq-
// cap filtering, so this section resolves that count and asserts it against the
// per-business per-month KV counter (`campaign:quota:<businessId>:<yyyy-mm>`)
// BEFORE `sendCampaign` transitions a draft to `sending`.
//
// Division of labour with the dispatcher (task 5.1):
//   - THIS pre-check is the user-facing guard: it returns 409 `quota_exceeded`
//     with `remaining` and does NOT transition or dispatch when it would
//     overflow, and — crucially — it consumes NO quota (it only reads the
//     counter via `kvGet`; the dispatcher's `reserveQuota` is the only writer).
//   - The dispatcher's `reserveQuota` remains the ATOMIC backstop that actually
//     consumes the month counter at fan-out time, closing the concurrency race
//     two near-simultaneous sends could otherwise slip through.
//
// `resolveEligibleCount` is intentionally shared: task 7.3's `estimateRecipients`
// (§7) MUST reuse it rather than duplicate the resolve+filter pipeline, so the
// number the owner previews and the number the quota guard enforces are derived
// from one code path.
// ============================================================================

/**
 * Result of resolving a campaign's realistic reach: the segment size, the count
 * surviving consent/opt-out filtering, the final eligible count after the
 * frequency cap, and whether the per-node check-in scan cap was hit.
 *
 * Shared by the quota pre-check (§6) and the recipient estimate (§7, task 7.3).
 */
export interface EligibleResolution {
  /** Raw segment size before any eligibility filtering. */
  segmentSize: number
  /** Remaining after marketing-consent + opt-out filtering. */
  afterConsentFilter: number
  /** Final realistic reach after the platform-wide frequency cap. */
  eligibleCount: number
  /** True when a per-node 10000 check-in scan cap was hit (Requirement 14.4). */
  truncated: boolean
}

/**
 * Resolve a campaign's realistic eligible recipient count by running the same
 * pipeline the dispatcher uses — segment resolution → consent/opt-out filter →
 * frequency-cap filter — WITHOUT sending anything.
 *
 * This is a pure read: it never transitions the campaign, publishes a batch, or
 * mutates the quota counter. Both the send-time quota guard and task 7.3's
 * recipient estimate call it so the previewed reach and the enforced count come
 * from a single source of truth.
 */
export async function resolveEligibleCount(
  businessId: string,
  campaign: Pick<Campaign, 'segment' | 'nodeIds' | 'lapsedWindowDays'>,
  nowMs: number = Date.now(),
): Promise<EligibleResolution> {
  const { userIds, truncated } = await resolveSegmentWithMeta({
    segment: campaign.segment,
    nodeIds: campaign.nodeIds,
    lapsedWindowDays: campaign.lapsedWindowDays ?? DEFAULT_LAPSED_WINDOW_DAYS,
    nowMs,
  })

  const consented = await filterByConsentAndOptOut(userIds, businessId)
  const eligible = await filterByFrequencyCap(consented)

  return {
    segmentSize: userIds.length,
    afterConsentFilter: consented.length,
    eligibleCount: eligible.length,
    truncated,
  }
}

/**
 * Resolve the business's effective subscription tier (honouring trial expiry),
 * used to determine the monthly send quota. Mirrors the dispatcher's tier
 * resolution exactly (`findBusinessById` + `getEffectiveTier`) so the API guard
 * and the dispatcher backstop agree on the cap. Defaults to `starter` (quota 0)
 * when the business cannot be loaded, so an unresolved business can never send.
 */
async function resolveBusinessTier(businessId: string): Promise<string> {
  const biz = await findBusinessById(businessId)
  if (!biz) return 'starter'
  return getEffectiveTier(biz as { tier?: string; trialEndsAt?: string | null })
}

/** Read the recipient count already consumed this calendar month (0 when unset). */
async function quotaUsedThisMonth(businessId: string, nowMs: number): Promise<number> {
  const raw = await kvGet(quotaMonthKey(businessId, nowMs))
  if (!raw) return 0
  const used = parseInt(raw, 10)
  return Number.isFinite(used) && used > 0 ? used : 0
}

/**
 * Assert a send of `eligibleCount` recipients fits within the business's
 * remaining monthly quota, WITHOUT consuming any quota.
 *
 * Resolves the tier, reads the month counter, and delegates the fit check to
 * the pure `assertWithinQuota`. On overflow it re-raises as a
 * `CampaignQuotaExceededError` (409 `quota_exceeded`, with `remaining`) so the
 * whole send is rejected before any state transition (Requirements 9.3, 9.4 /
 * Property 8). Returns the tier and remaining-after-this-send for logging.
 */
async function assertSendWithinQuota(
  businessId: string,
  eligibleCount: number,
  nowMs: number,
): Promise<{ tier: string; remaining: number }> {
  const tier = await resolveBusinessTier(businessId)
  const alreadyUsed = await quotaUsedThisMonth(businessId, nowMs)
  try {
    const { remaining } = assertWithinQuota(tier, alreadyUsed, eligibleCount)
    return { tier, remaining }
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      // Re-raise as an AppError so the API returns 409 quota_exceeded + remaining.
      throw new CampaignQuotaExceededError(error.remaining, error.requested)
    }
    throw error
  }
}

// ============================================================================
// §7 — Recipient estimate (task 7.3)
// ----------------------------------------------------------------------------
// Pre-send preview of realistic reach for the composer (Requirements 13.2,
// 13.5). The owner needs to see how many consumers a campaign will ACTUALLY
// reach — after marketing-consent/opt-out and the platform-wide frequency cap —
// before committing to send, plus whether the per-node check-in scan cap was
// hit (Requirement 14.4, surfaced as `truncated`).
//
// This MUST NOT re-run the resolve+filter pipeline itself: it loads the
// campaign and reuses the shared `resolveEligibleCount` (§6) — the same code
// path the send-time quota guard uses — then maps `EligibleResolution` →
// `RecipientEstimate`. One source of truth means the number the owner previews
// here equals the number the quota guard enforces at send. It is a pure read:
// no transition, no dispatch, no quota mutation.
// ============================================================================

/**
 * Estimate a campaign's realistic recipient reach BEFORE sending (Requirements
 * 13.2, 13.5). Returns the raw segment size, the count surviving consent/opt-
 * out filtering, the final estimated recipients after the frequency cap, and a
 * `truncated` flag indicating a per-node check-in scan cap was hit (14.4).
 *
 * Throws `CampaignNotFoundError` (404) when the campaign is not found for the
 * business. Does not transition, dispatch, or consume quota.
 */
export async function estimateRecipients(businessId: string, campaignId: string): Promise<RecipientEstimate> {
  const campaign = await getCampaignById(businessId, campaignId)
  if (!campaign) throw new CampaignNotFoundError(campaignId)

  const { segmentSize, afterConsentFilter, eligibleCount, truncated } = await resolveEligibleCount(businessId, campaign)

  return {
    segmentSize,
    afterConsentFilter,
    estimatedRecipients: eligibleCount,
    truncated,
  }
}

// ============================================================================
// §8 — Analytics (task 7.4)
// ----------------------------------------------------------------------------
// `computeAnalytics` is the authoritative analytics computation for the DETAIL
// view (`getCampaign`). It does two things (Requirement 11.1, 11.2, 11.4, 11.5):
//
//   1. AGGREGATE DELIVERY OUTCOMES (11.1) from the per-recipient send records.
//   2. ATTRIBUTED RETURN VISITS (11.2, 11.5) by re-resolving recipient tokens
//      against post-send check-ins at the campaign's nodes, counting each
//      recipient at most once and only within the attribution window.
//
// SOURCE-OF-TRUTH POLICY (the "be consistent and document your choice" call):
//   - targeted / filteredConsent / filteredFreqCap → from the campaign's STORED
//     `counts` (the dispatcher is the only component that knows these; they are
//     not derivable from send records).
//   - attempted / deliveredPush / deliveredEmail / deliveredBoth / noChannel /
//     failed → tallied FROM THE SEND RECORDS (the sender writes one record per
//     recipient with the real per-recipient outcome; the send records are the
//     per-recipient truth, so the live tally is preferred over the stored
//     rollup which a crashed/partial sender run may not have flushed).
//   So each metric comes from whichever component authoritatively produced it.
//
// ANONYMITY (11.4 / Constraint C1): the analytics output is pure aggregate
// counts — no userId, email, or phone. A check-in's `userId` is used ONLY
// transiently to derive a token for set-membership and is never returned.
//
// `analyticsFromCounts` is RETAINED as the cheap stored-counts mapping used by
// the list view (`listCampaigns`) — see the list-vs-detail decision documented
// on `listCampaigns`. `computeAnalytics` builds on it for targeted/filtered and
// overrides delivery + attribution.
// ============================================================================

/** Milliseconds in a day, for the attribution-window arithmetic. */
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Page size for the post-send check-in scan during attribution. */
const ATTRIBUTION_PAGE_SIZE = 100

/**
 * Most-recent check-ins scanned per node during attribution. Mirrors the
 * segment-resolver's 10000-per-node guardrail (Requirement 14.4) so the
 * attribution read cost stays predictable and bounded.
 */
const ATTRIBUTION_PER_NODE_CAP = 10000

/**
 * The minimal post-send check-in shape attribution needs. Kept structural (not
 * the full `CheckIn`) so `countAttributedReturns` is trivially property-testable
 * with synthetic check-ins (task 7.5).
 */
export interface AttributionCheckIn {
  /** The check-in's consumer userId — used ONLY to derive a token (never stored). */
  userId: string
  /** ISO 8601 timestamp of the check-in. */
  checkedInAt: string
}

/**
 * Tally per-recipient delivery outcomes from a campaign's send records
 * (Requirement 11.1). Pure — exported so task 7.5 / unit tests can exercise it
 * directly. `attempted` counts every recipient for whom at least one channel
 * delivery was attempted, i.e. every outcome except `no_channel`.
 */
export function tallyOutcomes(records: CampaignSendRecord[]): {
  attempted: number
  deliveredPush: number
  deliveredEmail: number
  deliveredBoth: number
  noChannel: number
  failed: number
} {
  let deliveredPush = 0
  let deliveredEmail = 0
  let deliveredBoth = 0
  let noChannel = 0
  let failed = 0

  for (const r of records) {
    switch (r.channelOutcome) {
      case 'delivered_push':
        deliveredPush += 1
        break
      case 'delivered_email':
        deliveredEmail += 1
        break
      case 'delivered_both':
        deliveredBoth += 1
        break
      case 'no_channel':
        noChannel += 1
        break
      case 'failed':
        failed += 1
        break
    }
  }

  // "Attempted" = every recipient where a delivery was attempted = all outcomes
  // except no_channel (nothing was sent for no_channel — Requirement 5.5).
  const attempted = deliveredPush + deliveredEmail + deliveredBoth + failed

  return { attempted, deliveredPush, deliveredEmail, deliveredBoth, noChannel, failed }
}

/**
 * Count Attributed Return Visits: the number of MESSAGED recipients who checked
 * in at one of the campaign's nodes within the attribution window after send
 * (Requirements 11.2, 11.5). PURE and deterministic — exported so the Property
 * 12 (Attribution Single-Count) test (task 7.5) can drive it directly.
 *
 * Algorithm:
 *   - The window is `[sentAtMs, sentAtMs + windowDays * MS_PER_DAY]` (inclusive).
 *   - For each check-in inside the window, derive
 *     `recipientToken(userId, campaignId, salt)` and, if that token is in the
 *     `messagedTokens` set, mark the token as returned.
 *   - The returned tokens are collected in a Set, so EACH recipient is counted
 *     AT MOST ONCE even with many qualifying check-ins (Requirement 11.5).
 *   - Check-ins outside the window, and check-ins by non-messaged recipients,
 *     contribute nothing.
 *
 * Anonymity: `userId` is consumed only to derive the token for membership; it
 * is never returned or persisted (Requirement 11.4 / Constraint C1).
 *
 * @param messagedTokens recipient tokens that were actually messaged (attempted)
 * @param checkIns       post-send check-ins at the campaign's nodes
 * @param campaignId     the campaign id (token-derivation input)
 * @param salt           the campaign salt (token-derivation input)
 * @param sentAtMs       campaign send time, epoch ms (window start)
 * @param windowDays     attribution window length in days (window end offset)
 */
export function countAttributedReturns(
  messagedTokens: ReadonlySet<string>,
  checkIns: ReadonlyArray<AttributionCheckIn>,
  campaignId: string,
  salt: string,
  sentAtMs: number,
  windowDays: number,
): number {
  if (messagedTokens.size === 0) return 0

  const windowEndMs = sentAtMs + windowDays * MS_PER_DAY
  const returned = new Set<string>()

  for (const ci of checkIns) {
    const ms = new Date(ci.checkedInAt).getTime()
    if (Number.isNaN(ms)) continue
    // Only check-ins within [sentAt, sentAt + window] qualify (Requirement 11.2).
    if (ms < sentAtMs || ms > windowEndMs) continue

    const token = recipientToken(ci.userId, campaignId, salt)
    if (messagedTokens.has(token)) {
      // Set membership de-dupes: each recipient counted at most once (11.5).
      returned.add(token)
    }
  }

  return returned.size
}

/**
 * Fetch post-send check-ins across all of the campaign's nodes, bounded to the
 * most-recent `ATTRIBUTION_PER_NODE_CAP` per node (Requirement 14.4 spirit).
 * Returns only the minimal `{ userId, checkedInAt }` projection attribution
 * needs. No phone number is ever read (Constraint C1).
 */
async function fetchPostSendCheckIns(nodeIds: string[]): Promise<AttributionCheckIn[]> {
  const checkIns: AttributionCheckIn[] = []

  for (const nodeId of [...new Set(nodeIds)]) {
    let scanned = 0
    let cursor: string | undefined

    do {
      const limit = Math.min(ATTRIBUTION_PAGE_SIZE, ATTRIBUTION_PER_NODE_CAP - scanned)
      const page = await getCheckInsByNode(nodeId, { limit, cursor })

      for (const ci of page.checkIns) {
        checkIns.push({ userId: ci.userId, checkedInAt: ci.checkedInAt })
        scanned += 1
      }

      cursor = page.nextCursor
    } while (cursor && scanned < ATTRIBUTION_PER_NODE_CAP)
  }

  return checkIns
}

/**
 * Compute a campaign's full analytics (Requirement 11.1, 11.2, 11.4, 11.5).
 *
 * Delivery outcomes are tallied from the send records (the per-recipient
 * truth); targeted/filtered counts come from the campaign's stored rollup; and
 * Attributed Return Visits are computed by re-resolving the messaged recipient
 * tokens against post-send check-ins at the campaign's nodes. The result is
 * pure aggregate counts with no consumer identifiers (Requirement 11.4).
 *
 * Attribution is skipped (0) when the campaign has not been sent (`sentAt`
 * unset) or when no recipient was actually messaged — there is nothing to
 * attribute a return to in either case.
 */
export async function computeAnalytics(campaign: Campaign): Promise<CampaignAnalytics> {
  const records = await getSendRecords(campaign.campaignId)
  const outcomes = tallyOutcomes(records)

  // Build the messaged-token set: recipients for whom a delivery was attempted
  // (every outcome except no_channel — nothing was sent for no_channel). This
  // is the set attribution is measured against (per task 7.4 guidance).
  const messagedTokens = new Set<string>()
  for (const r of records) {
    if (r.channelOutcome !== 'no_channel') messagedTokens.add(r.recipientToken)
  }

  let attributedReturnVisits = 0
  if (campaign.sentAt && messagedTokens.size > 0) {
    const sentAtMs = new Date(campaign.sentAt).getTime()
    if (!Number.isNaN(sentAtMs)) {
      const checkIns = await fetchPostSendCheckIns(campaign.nodeIds)
      attributedReturnVisits = countAttributedReturns(
        messagedTokens,
        checkIns,
        campaign.campaignId,
        campaign.campaignSalt,
        sentAtMs,
        campaign.attributionWindowDays,
      )
    }
  }

  const c = campaign.counts
  return {
    // targeted / filtered come from the dispatcher-written stored counts.
    recipientsTargeted: c.targeted,
    filteredByConsent: c.filteredConsent,
    filteredByFrequencyCap: c.filteredFreqCap,
    // delivery outcomes come from the per-recipient send-record tally.
    messagesAttempted: outcomes.attempted,
    deliveredPush: outcomes.deliveredPush,
    deliveredEmail: outcomes.deliveredEmail,
    deliveredBoth: outcomes.deliveredBoth,
    noChannel: outcomes.noChannel,
    failed: outcomes.failed,
    attributedReturnVisits,
  }
}

/**
 * Map a campaign's stored aggregate counts to the analytics response shape.
 *
 * This is the CHEAP path used by the list view (`listCampaigns`): it reads only
 * the campaign's stored `counts` and does NOT compute Attributed Return Visits
 * (reported as 0). The DETAIL view uses `computeAnalytics` for real attribution.
 * See the list-vs-detail decision documented on `listCampaigns`.
 */
function analyticsFromCounts(campaign: Campaign): CampaignAnalytics {
  const c = campaign.counts
  return {
    recipientsTargeted: c.targeted,
    filteredByConsent: c.filteredConsent,
    filteredByFrequencyCap: c.filteredFreqCap,
    messagesAttempted: c.attempted,
    deliveredPush: c.deliveredPush,
    deliveredEmail: c.deliveredEmail,
    deliveredBoth: c.deliveredBoth,
    noChannel: c.noChannel,
    failed: c.failed,
    // List view does not pay for attribution — reserved for the detail view.
    attributedReturnVisits: 0,
  }
}
