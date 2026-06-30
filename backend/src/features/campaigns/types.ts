import { z } from 'zod'

// ============================================================================
// Win-Back Campaigns — Types & Zod Schemas
// ----------------------------------------------------------------------------
// Constraint C1 (no SMS / no phone): delivery channels are limited to `push`
// and `email`. There is NO phone-number field anywhere in this module, and the
// `channel` enum structurally forbids any value outside {push, email}. See
// `.kiro/steering/no-sms-no-phone-auth.md`.
// ============================================================================

// ----------------------------------------------------------------------------
// Enumerations
// ----------------------------------------------------------------------------

/** Lifecycle states of a campaign. */
export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed'

/** Audience segments resolvable against the business's own past visitors. */
export type Segment = 'lapsed' | 'first_timers' | 'regulars' | 'all_past_visitors'

/**
 * Delivery channels. Email + push only — there is no SMS/phone channel (C1).
 * Declared as a const tuple so the same source drives both the Zod enum and
 * the TypeScript type.
 */
export const CAMPAIGN_CHANNELS = ['push', 'email'] as const
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number]

/** Per-recipient delivery outcome recorded by the sender. */
export type ChannelOutcome = 'delivered_push' | 'delivered_email' | 'delivered_both' | 'no_channel' | 'failed'

// ----------------------------------------------------------------------------
// Aggregate counts (stored on the campaign, never per-consumer identifiers)
// ----------------------------------------------------------------------------

export interface CampaignCounts {
  /** Recipients resolved by the segment (pre-filter). */
  targeted: number
  /** Recipients removed because consent was absent or opted-out. */
  filteredConsent: number
  /** Recipients removed by the platform-wide frequency cap. */
  filteredFreqCap: number
  /** Recipients for whom at least one channel delivery was attempted. */
  attempted: number
  deliveredPush: number
  deliveredEmail: number
  deliveredBoth: number
  noChannel: number
  failed: number
}

// ----------------------------------------------------------------------------
// Core campaign document
// ----------------------------------------------------------------------------

/**
 * A campaign document as stored in the `app-data` table.
 *
 * Key structure (see design.md):
 *   pk:     CAMPAIGN#<businessId>
 *   sk:     CAMPAIGN#<createdAt>#<campaignId>
 *   gsi1pk: CAMPAIGNS#<businessId>
 *   gsi1sk: <createdAt>
 *   ttl:    <createdAt + 13 months>
 *
 * The document contains zero consumer identifiers (POPIA / Requirement 11.4).
 */
export interface Campaign {
  campaignId: string
  businessId: string
  status: CampaignStatus

  // Audience
  segment: Segment
  /** Only meaningful for the `lapsed` segment. Default 21, range 7–90. */
  lapsedWindowDays?: number
  nodeIds: string[]

  // Message
  title: string
  body: string
  channels: CampaignChannel[]
  rewardId?: string
  /** Originating Venue Intelligence Report, when created from a recommendation. */
  reportId?: string

  // Scheduling / lifecycle timestamps (ISO 8601)
  createdAt: string
  scheduledAt?: string
  sentAt?: string

  /** Attribution window for return-visit measurement. Default 14 days. */
  attributionWindowDays: number

  /**
   * Per-campaign salt used to derive anonymized recipient tokens. Not a secret;
   * it only rotates the token space so tokens cannot be correlated across
   * campaigns.
   */
  campaignSalt: string

  counts: CampaignCounts

  /** Epoch seconds for DynamoDB TTL (createdAt + 13 months). */
  ttl: number
}

// ----------------------------------------------------------------------------
// Service input / output shapes
// ----------------------------------------------------------------------------

/**
 * Validated input accepted by `createCampaign`. Derived from
 * `createCampaignBodySchema` so the schema is the single source of truth.
 */
export type CreateCampaignInput = z.infer<typeof createCampaignBodySchema>

/** Aggregated, anonymized analytics for a campaign (Requirement 11). */
export interface CampaignAnalytics {
  /** Recipients resolved by the segment before filtering. */
  recipientsTargeted: number
  /** Recipients excluded by marketing consent / opt-out. */
  filteredByConsent: number
  /** Recipients excluded by the frequency cap. */
  filteredByFrequencyCap: number
  /** Recipients for whom at least one delivery was attempted. */
  messagesAttempted: number
  deliveredPush: number
  deliveredEmail: number
  deliveredBoth: number
  noChannel: number
  failed: number
  /**
   * Recipients who checked in at one of the campaign's nodes within
   * `attributionWindowDays` after their send (counted once per recipient).
   */
  attributedReturnVisits: number
}

/** A campaign returned with its computed analytics (detail view). */
export interface CampaignWithAnalytics extends Campaign {
  analytics: CampaignAnalytics
}

/** Condensed campaign shape for the paginated list view. */
export interface CampaignSummary {
  campaignId: string
  status: CampaignStatus
  segment: Segment
  title: string
  channels: CampaignChannel[]
  createdAt: string
  scheduledAt?: string
  sentAt?: string
  /** Headline analytics surfaced in the list (Requirement 13.3). */
  recipients: number
  delivered: number
  attributedReturnVisits: number
}

/**
 * Pre-send estimate of realistic reach after consent + frequency-cap filtering
 * (Requirements 13.2, 13.5).
 */
export interface RecipientEstimate {
  /** Raw segment size before eligibility filtering. */
  segmentSize: number
  /** Remaining after consent / opt-out filtering. */
  afterConsentFilter: number
  /** Remaining after frequency-cap filtering — the realistic reach. */
  estimatedRecipients: number
  /** True when a per-node check-in scan cap was hit (Requirement 14.4). */
  truncated: boolean
}

// ----------------------------------------------------------------------------
// Persistence & pipeline message shapes
// ----------------------------------------------------------------------------

/**
 * A per-recipient delivery record (anonymized).
 *
 * Key structure:
 *   pk:  CSEND#<campaignId>
 *   sk:  CSEND#<recipientToken>
 *   ttl: <sentAt + 120 days>
 *
 * `recipientToken = sha256(userId + campaignId + campaignSalt)`. No userId,
 * email, or phone is ever stored here.
 */
export interface CampaignSendRecord {
  recipientToken: string
  channelOutcome: ChannelOutcome
  /** ISO 8601 timestamp of the delivery attempt. */
  attemptedAt: string
}

/**
 * SQS message consumed by the campaign-sender Lambda. Carries a single batch of
 * at most 100 recipients. `userId` is used transiently to deliver; only `token`
 * is ever persisted in a send record.
 */
export interface CampaignSendMessage {
  campaignId: string
  businessId: string
  recipients: Array<{ token: string; userId: string }>
}

/** Event payload that triggers the campaign-dispatcher Lambda. */
export interface DispatchCampaignEvent {
  businessId: string
  campaignId: string
}

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Body schema for `POST /v1/business/me/campaigns`.
 *
 * `channels` is an array whose element enum is EXACTLY `['push', 'email']`.
 * Any other value (notably any SMS/phone channel) fails validation — this is
 * the structural enforcement of Constraint C1, not a loosenable runtime check.
 */
export const createCampaignBodySchema = z.object({
  segment: z.enum(['lapsed', 'first_timers', 'regulars', 'all_past_visitors']),
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(500),
  channels: z.array(z.enum(CAMPAIGN_CHANNELS)).min(1),
  nodeIds: z.array(z.string().min(1)).min(1),
  rewardId: z.string().min(1).optional(),
  lapsedWindowDays: z.number().int().min(7).max(90).optional(),
  reportId: z.string().min(1).optional(),
})

/**
 * Body schema for `POST /v1/business/me/campaigns/:campaignId/send`.
 * Omitting `scheduledAt` sends immediately; a future ISO 8601 timestamp
 * schedules the send.
 */
export const sendCampaignBodySchema = z.object({
  scheduledAt: z.string().datetime().optional(),
})

/** Query schema for `GET /v1/business/me/campaigns` (paginated list). */
export const campaignListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
})

/** Path-params schema for routes addressing a single campaign. */
export const campaignIdParamsSchema = z.object({
  campaignId: z.string().min(1),
})

/**
 * Body schema for `POST /v1/users/me/campaign-optout` (consumer auth).
 *
 * Omitting `businessId` opts the consumer out of ALL campaigns globally;
 * providing one opts them out of that single business only (Requirements 12.1,
 * 12.3). There is no phone/SMS field — the opt-out is purely identity-based on
 * the authenticated consumer (Constraint C1 / Requirement 12.4).
 */
export const campaignOptOutBodySchema = z.object({
  businessId: z.string().min(1).optional(),
  /**
   * `true` (default) opts out; `false` opts back in by removing the opt-out row
   * (POPIA: opting out is reversible). Applies to the same scope `businessId`
   * resolves (a single business, or all businesses when omitted).
   */
  optOut: z.boolean().optional().default(true),
})

/**
 * Query schema for `GET /v1/campaigns/unsubscribe` (one-click email link).
 *
 * The `token` is the signed unsubscribe token embedded in every campaign email
 * (see `unsubscribe.ts`); it carries the recipient + business and is verified
 * server-side. No login and no phone/SMS re-auth is required (Requirement 12.4).
 */
export const unsubscribeQuerySchema = z.object({
  token: z.string().min(1),
})

// ----------------------------------------------------------------------------
// Inferred body/query types
// ----------------------------------------------------------------------------

export type SendCampaignBody = z.infer<typeof sendCampaignBodySchema>
export type CampaignListQuery = z.infer<typeof campaignListQuerySchema>
export type CampaignIdParams = z.infer<typeof campaignIdParamsSchema>
export type CampaignOptOutBody = z.infer<typeof campaignOptOutBodySchema>
export type UnsubscribeQuery = z.infer<typeof unsubscribeQuerySchema>
