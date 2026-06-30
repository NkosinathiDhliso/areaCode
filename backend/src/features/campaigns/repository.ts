// DynamoDB-backed Win-Back Campaigns Repository
//
// Storage reuses the existing `app-data` table (pk/sk + GSI1) and the `users`
// table — no new tables or GSIs (Constraint C4). No phone number is read,
// written, or required anywhere in this module (Constraint C1).
import { BatchGetCommand, DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'

import type { Campaign, CampaignCounts, CampaignSendRecord, ChannelOutcome } from './types.js'

// ============================================================================
// Opt-Out Records (app-data)
// ----------------------------------------------------------------------------
// Key structure (see design.md):
//   pk: COPTOUT#<userId>
//   sk: COPTOUT#<businessId>  |  COPTOUT#ALL
//   optedOutAt
//
// A consumer may opt out of campaigns from a specific business (per-business
// row) or from every business (global `ALL` row). The opt-out mechanism never
// requires a phone number or SMS re-auth (Requirement 12.4).
// ============================================================================

/** Marker used for a global (all-businesses) opt-out sort key. */
const OPTOUT_GLOBAL = 'ALL'

/** Resolved opt-out state for a single consumer. */
export interface OptOutState {
  /** Business IDs the consumer has opted out of individually. */
  businessIds: string[]
  /** True when the consumer has opted out of all campaigns globally. */
  global: boolean
}

/**
 * Read every opt-out row for a consumer.
 *
 * Queries the `COPTOUT#<userId>` partition and partitions the rows into the
 * set of per-business opt-outs and whether a global opt-out exists. Used by the
 * eligibility filter to exclude opted-out consumers (Requirements 6.2, 12.3).
 */
export async function getOptOuts(userId: string): Promise<OptOutState> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `COPTOUT#${userId}`,
        ':prefix': 'COPTOUT#',
      },
    }),
  )

  const businessIds: string[] = []
  let global = false

  for (const item of result.Items || []) {
    const sk = item['sk'] as string
    const target = sk.slice('COPTOUT#'.length)
    if (target === OPTOUT_GLOBAL) {
      global = true
    } else if (target.length > 0) {
      businessIds.push(target)
    }
  }

  return { businessIds, global }
}

/**
 * Record a consumer opt-out.
 *
 * Pass a `businessId` to opt out of campaigns from that business, or the
 * literal `'ALL'` to opt out of every business globally (Requirement 12.1).
 * Writing the same opt-out twice is idempotent (it simply refreshes
 * `optedOutAt`).
 */
export async function putOptOut(userId: string, businessId: string | 'ALL'): Promise<void> {
  const target = businessId === OPTOUT_GLOBAL ? OPTOUT_GLOBAL : businessId
  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `COPTOUT#${userId}`,
        sk: `COPTOUT#${target}`,
        optedOutAt: new Date().toISOString(),
      },
    }),
  )
}

/**
 * Remove an opt-out row, opting the consumer BACK IN to campaigns from that
 * business (or globally with `'ALL'`). POPIA: opting out is reversible by the
 * consumer at any time. Idempotent — deleting an absent row is a no-op.
 */
export async function removeOptOut(userId: string, businessId: string | 'ALL'): Promise<void> {
  const target = businessId === OPTOUT_GLOBAL ? OPTOUT_GLOBAL : businessId
  await documentClient.send(
    new DeleteCommand({
      TableName: TableNames.appData,
      Key: {
        pk: `COPTOUT#${userId}`,
        sk: `COPTOUT#${target}`,
      },
    }),
  )
}

// ============================================================================
// Marketing Consent (users table)
// ----------------------------------------------------------------------------
// Marketing consent is a `marketingConsent: boolean` field on the user record.
// It is opt-in by default: an absent value means consent was never granted and
// the consumer is NOT a campaign recipient (Requirements 6.1, 6.4). This is
// distinct from transactional notification preferences (Requirement 6.3).
// ============================================================================

/** BatchGetItem supports at most 100 keys per request. */
const USER_BATCH_SIZE = 100

/**
 * Batch-read the marketing-consent flag for a set of consumer userIds.
 *
 * Returns a map of `userId -> granted`. A user with no `marketingConsent`
 * field (or any non-`true` value) maps to `false` — consent is opt-in by
 * default (Requirements 6.1, 6.4). Mirrors the BatchGetItem pattern used by
 * the reports generator's `loadUserData`.
 */
export async function getMarketingConsent(userIds: string[]): Promise<Map<string, boolean>> {
  const consentMap = new Map<string, boolean>()
  if (userIds.length === 0) return consentMap

  // Deduplicate to avoid wasting BatchGet capacity on repeated userIds.
  const uniqueUserIds = [...new Set(userIds)]

  // Default every requested user to not-granted; granted values overwrite below.
  for (const userId of uniqueUserIds) {
    consentMap.set(userId, false)
  }

  for (let i = 0; i < uniqueUserIds.length; i += USER_BATCH_SIZE) {
    const batch = uniqueUserIds.slice(i, i + USER_BATCH_SIZE)
    const keys = batch.map((userId) => ({ userId }))

    try {
      const result = await documentClient.send(
        new BatchGetCommand({
          RequestItems: {
            [TableNames.users]: {
              Keys: keys,
              ProjectionExpression: 'userId, marketingConsent',
            },
          },
        }),
      )

      const items = result.Responses?.[TableNames.users] || []
      for (const item of items) {
        const userId = item['userId'] as string
        consentMap.set(userId, item['marketingConsent'] === true)
      }
    } catch (error) {
      console.error('[campaigns/repository] Error loading marketing consent batch:', error)
    }
  }

  return consentMap
}

/**
 * Batch-read the verified email address for a set of consumer userIds.
 *
 * Returns a map of `userId -> email`. A user with no `email` field is simply
 * absent from the map (the sender then records `no_channel` for an email-only
 * recipient). Mirrors the BatchGetItem pattern used by `getMarketingConsent`
 * and the reports generator's `loadUserData` — the users table is the
 * established home for the consumer's verified email (set at sign-up via the
 * Cognito `email_verified` attribute). No phone number is read (Constraint C1).
 */
export async function getRecipientEmails(userIds: string[]): Promise<Map<string, string>> {
  const emailMap = new Map<string, string>()
  if (userIds.length === 0) return emailMap

  const uniqueUserIds = [...new Set(userIds)]

  for (let i = 0; i < uniqueUserIds.length; i += USER_BATCH_SIZE) {
    const batch = uniqueUserIds.slice(i, i + USER_BATCH_SIZE)
    const keys = batch.map((userId) => ({ userId }))

    try {
      const result = await documentClient.send(
        new BatchGetCommand({
          RequestItems: {
            [TableNames.users]: {
              Keys: keys,
              ProjectionExpression: 'userId, email',
            },
          },
        }),
      )

      const items = result.Responses?.[TableNames.users] || []
      for (const item of items) {
        const userId = item['userId'] as string
        const email = item['email']
        if (typeof email === 'string' && email.length > 0) {
          emailMap.set(userId, email)
        }
      }
    } catch (error) {
      console.error('[campaigns/repository] Error loading recipient emails batch:', error)
    }
  }

  return emailMap
}

// ============================================================================
// Campaign Send Records (app-data)
// ----------------------------------------------------------------------------
// Key structure (see design.md):
//   pk:  CSEND#<campaignId>
//   sk:  CSEND#<recipientToken>
//   ttl: <sentAt + 120 days>
//   recipientToken, channelOutcome, attemptedAt
//
// One record is written per recipient by the sender. The record is anonymized:
// it stores only the per-campaign `recipientToken`, never the userId, email, or
// any phone number (Constraint C1 / Requirement 11.4). Records expire 120 days
// after send via DynamoDB TTL (Requirement 14.2) — no cleanup job.
// ============================================================================

/** 120 days in seconds — the send-record retention window (Requirement 14.2). */
const SEND_RECORD_TTL_SECONDS = 120 * 24 * 60 * 60

/**
 * Persist a single anonymized per-recipient send record.
 *
 * `sentAtMs` is the campaign send time in epoch milliseconds; the record's TTL
 * is `sentAtMs/1000 + 120 days`. Only the `recipientToken` is stored — the
 * userId never lands in this document (Constraint C1 / Requirement 11.4).
 */
export async function putSendRecord(campaignId: string, record: CampaignSendRecord, sentAtMs: number): Promise<void> {
  const ttl = Math.floor(sentAtMs / 1000) + SEND_RECORD_TTL_SECONDS
  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `CSEND#${campaignId}`,
        sk: `CSEND#${record.recipientToken}`,
        ttl,
        recipientToken: record.recipientToken,
        channelOutcome: record.channelOutcome,
        attemptedAt: record.attemptedAt,
      },
    }),
  )
}

/** Page size for the send-record scan (mirrors the segment-resolver pattern). */
const SEND_RECORD_PAGE_SIZE = 100

/**
 * Hard ceiling on the number of send records read for a single campaign's
 * analytics. A campaign's recipient count is already quota-bounded (pro tier
 * tops out at 10000 recipients/month), so this cap keeps the analytics read
 * cost predictable and bounded — mirroring the segment-resolver's 10000-per-
 * node guardrail (Requirement 14.4 spirit).
 */
const SEND_RECORD_SCAN_CAP = 10000

/**
 * Read every persisted send record for a campaign (paginated).
 *
 * Queries the `CSEND#<campaignId>` partition and returns one
 * `CampaignSendRecord` per recipient. These records are the only persisted
 * recipient identity (the anonymized `recipientToken`) and carry the per-
 * recipient delivery outcome — the analytics layer uses them both to tally
 * delivery outcomes (Requirement 11.1) and to build the messaged-token set for
 * attribution (Requirements 11.2, 11.5).
 *
 * No consumer identifier is read or returned — only tokens, outcomes, and
 * timestamps (Constraint C1 / Requirement 11.4). Scanning is bounded to
 * `SEND_RECORD_SCAN_CAP` records to keep the read cost predictable.
 */
export async function getSendRecords(campaignId: string): Promise<CampaignSendRecord[]> {
  const records: CampaignSendRecord[] = []
  let cursor: Record<string, unknown> | undefined

  do {
    const result = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.appData,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': `CSEND#${campaignId}`,
          ':prefix': 'CSEND#',
        },
        Limit: SEND_RECORD_PAGE_SIZE,
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }),
    )

    for (const item of result.Items || []) {
      const recipientToken = item['recipientToken'] as string | undefined
      if (!recipientToken) continue
      records.push({
        recipientToken,
        channelOutcome: item['channelOutcome'] as ChannelOutcome,
        attemptedAt: item['attemptedAt'] as string,
      })
    }

    cursor = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (cursor && records.length < SEND_RECORD_SCAN_CAP)

  return records
}

// ============================================================================
// Campaign Documents (app-data)
// ----------------------------------------------------------------------------
// Key structure (see design.md):
//   pk:     CAMPAIGN#<businessId>
//   sk:     CAMPAIGN#<createdAt>#<campaignId>
//   gsi1pk: CAMPAIGNS#<businessId>
//   gsi1sk: <createdAt>                (list sorted by date desc)
//   ttl:    <createdAt + 13 months>
//
// The full campaign is stored as a `data` JSON blob (source of truth), mirroring
// the reports feature's `storeReport`. A handful of fields are denormalized for
// the list view and for cheap key reconstruction. The document contains zero
// consumer identifiers (POPIA / Requirement 11.4).
//
// NOTE FOR TASK 7.1 (campaign persistence + lifecycle): these three helpers are
// the minimal seam needed by the dispatcher (task 5.1). `putCampaign` is the
// single writer and is intended to back `createCampaign` as well — task 7.1
// should reuse it (and add `listCampaigns`/`cancelCampaign` on the same key
// shape) rather than introduce a second, divergent storage layout.
// ============================================================================

/** 13 months in seconds (≈ 395 days), the campaign document retention (R14.3). */
const CAMPAIGN_TTL_SECONDS = 395 * 24 * 60 * 60

/** Build the primary-key sort key for a campaign document. */
function campaignSortKey(createdAt: string, campaignId: string): string {
  return `CAMPAIGN#${createdAt}#${campaignId}`
}

/**
 * Persist a campaign document (create or full overwrite).
 *
 * This is the single writer for campaign documents. The dispatcher uses it to
 * persist updated counts; task 7.1's `createCampaign` should also route through
 * here so the stored shape stays consistent.
 */
export async function putCampaign(campaign: Campaign): Promise<void> {
  const ttl =
    campaign.ttl && campaign.ttl > 0
      ? campaign.ttl
      : Math.floor(new Date(campaign.createdAt).getTime() / 1000) + CAMPAIGN_TTL_SECONDS

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.appData,
      Item: {
        pk: `CAMPAIGN#${campaign.businessId}`,
        sk: campaignSortKey(campaign.createdAt, campaign.campaignId),
        gsi1pk: `CAMPAIGNS#${campaign.businessId}`,
        gsi1sk: campaign.createdAt,
        ttl,
        data: JSON.stringify({ ...campaign, ttl }),
        // Denormalized fields for the list view (Requirement 13.3).
        campaignId: campaign.campaignId,
        status: campaign.status,
        segment: campaign.segment,
        title: campaign.title,
        createdAt: campaign.createdAt,
        scheduledAt: campaign.scheduledAt,
        sentAt: campaign.sentAt,
      },
    }),
  )
}

/**
 * Load a single campaign by business + campaignId.
 *
 * Queries the GSI1 partition `CAMPAIGNS#<businessId>` and filters by the
 * denormalized `campaignId`, then parses the stored `data` blob. Mirrors the
 * reports repository's `getReport` lookup. Returns null when not found (or when
 * the campaign belongs to a different business).
 */
export async function getCampaignById(businessId: string, campaignId: string): Promise<Campaign | null> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :gsi1pk',
      FilterExpression: 'campaignId = :campaignId',
      ExpressionAttributeValues: {
        ':gsi1pk': `CAMPAIGNS#${businessId}`,
        ':campaignId': campaignId,
      },
      Limit: 1,
    }),
  )

  const item = result.Items?.[0]
  if (!item) return null

  try {
    return JSON.parse(item['data'] as string) as Campaign
  } catch {
    return null
  }
}

/**
 * Persist resolved targeted/filtered (and any other) counts onto a campaign run.
 *
 * Merges the provided partial counts over the campaign's existing counts and
 * writes the result back via `putCampaign`. The dispatcher calls this after
 * segment resolution + eligibility filtering to record `targeted`,
 * `filteredConsent`, and `filteredFreqCap` (Requirement 11.1). Accepts the
 * already-loaded campaign to avoid a redundant read.
 */
export async function updateCampaignCounts(campaign: Campaign, counts: Partial<CampaignCounts>): Promise<Campaign> {
  const merged: Campaign = {
    ...campaign,
    counts: { ...campaign.counts, ...counts },
  }
  await putCampaign(merged)
  return merged
}

/** Default page size for the paginated campaign list (Requirement 11.3). */
const CAMPAIGN_LIST_PAGE_SIZE = 20

/** Hard ceiling on the page size a caller may request. */
const CAMPAIGN_LIST_MAX_PAGE_SIZE = 50

/**
 * List a business's campaigns sorted by creation date descending.
 *
 * Queries the GSI1 partition `CAMPAIGNS#<businessId>` with `ScanIndexForward
 * = false` so the most-recently-created campaigns come first (Requirement
 * 11.3). Mirrors the reports repository's `listReports` pagination: the cursor
 * is the base64-encoded `LastEvaluatedKey`. Each row's full `data` blob is
 * parsed back into a `Campaign`; the service layer maps these to the condensed
 * `CampaignSummary` shape for the list view.
 *
 * No consumer identifiers are read or returned — campaign documents contain
 * only aggregate counts (POPIA / Requirement 11.4).
 */
export async function listCampaigns(
  businessId: string,
  opts: { cursor?: string; limit?: number } = {},
): Promise<{ items: Campaign[]; nextCursor?: string }> {
  const limit = Math.min(Math.max(opts.limit ?? CAMPAIGN_LIST_PAGE_SIZE, 1), CAMPAIGN_LIST_MAX_PAGE_SIZE)

  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :gsi1pk',
      ExpressionAttributeValues: { ':gsi1pk': `CAMPAIGNS#${businessId}` },
      ScanIndexForward: false, // newest first (date desc)
      Limit: limit,
      ...(opts.cursor ? { ExclusiveStartKey: JSON.parse(Buffer.from(opts.cursor, 'base64').toString()) } : {}),
    }),
  )

  const items: Campaign[] = []
  for (const item of result.Items || []) {
    try {
      items.push(JSON.parse(item['data'] as string) as Campaign)
    } catch {
      // Skip a malformed row rather than failing the whole page.
    }
  }

  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined

  return { items, nextCursor }
}
