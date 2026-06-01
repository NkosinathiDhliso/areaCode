import { kvGet, kvIncr } from '../../shared/kv/dynamodb-kv.js'
import { getOptOuts, getMarketingConsent } from './repository.js'

// ============================================================================
// Win-Back Campaigns — Eligibility Filters
// ----------------------------------------------------------------------------
// Two independent eligibility gates applied before a campaign is dispatched:
//
//   1. Marketing consent + opt-out (POPIA, Requirements 6.1–6.4, 12.3)
//      - A consumer must have EXPLICITLY granted `marketingConsent`. Absent or
//        unset consent is treated as NOT granted (opt-in default, not opt-out).
//      - A consumer with a global opt-out (`COPTOUT#<userId>` / `COPTOUT#ALL`)
//        or a per-business opt-out (`COPTOUT#<businessId>`) is excluded
//        regardless of consent state.
//
//   2. Platform-wide frequency cap (Requirements 7.1–7.4)
//      - At most `FREQ_CAP_MAX` campaign messages per consumer within a rolling
//        `FREQ_CAP_WINDOW_SECONDS` window, counted across ALL businesses.
//      - Backed by the existing DynamoDB KV store with a TTL equal to the
//        window, so counters expire automatically with no cleanup job — the
//        same mechanism used by `canSendRewardPush` in notifications.
//
// Constraint C1 (no SMS / no phone): eligibility operates on `userId` only.
// No phone number is read, stored, or required anywhere in this module.
// Constraint C4 (single-table storage): the frequency-cap counters live in the
// existing `app-data` KV store — no new tables.
// ============================================================================

// ----------------------------------------------------------------------------
// Frequency-cap configuration (Requirement 7.1: 4 messages / 7 days)
// ----------------------------------------------------------------------------

/** Maximum campaign messages a consumer may receive within the rolling window. */
export const FREQ_CAP_MAX = 4

/** Rolling window for the frequency cap, in seconds (7 days). */
export const FREQ_CAP_WINDOW_SECONDS = 7 * 24 * 60 * 60

/** KV key for a consumer's rolling frequency-cap counter (platform-wide). */
function frequencyCapKey(userId: string): string {
  return `campaign:freqcap:${userId}`
}

// ----------------------------------------------------------------------------
// Consent + opt-out filter
// ----------------------------------------------------------------------------

/**
 * Filter a set of candidate userIds down to those eligible to receive a
 * campaign from `businessId`, applying marketing-consent and opt-out rules.
 *
 * A userId is kept only if ALL of the following hold:
 *   - it has an explicitly-granted `marketingConsent` value (absent = excluded,
 *     opt-in default — Requirements 6.1, 6.4);
 *   - it has no global opt-out (Requirement 6.2, 12.3);
 *   - it has no per-business opt-out for `businessId` (Requirement 6.2, 12.3).
 *
 * Marketing consent is read in a single batch; opt-out rows are read per user.
 * No phone number is read or required (C1).
 */
export async function filterByConsentAndOptOut(userIds: string[], businessId: string): Promise<string[]> {
  if (userIds.length === 0) return []

  // Batch-read marketing consent. Absent = not granted (opt-in default).
  const consent = await getMarketingConsent(userIds)

  const eligible: string[] = []
  for (const userId of userIds) {
    // Requirements 6.1 / 6.4: only consumers who explicitly granted consent.
    if (consent.get(userId) !== true) continue

    // Requirements 6.2 / 12.3: exclude global or per-business opt-outs.
    const optOuts = await getOptOuts(userId)
    if (optOuts.global) continue
    if (optOuts.businessIds.includes(businessId)) continue

    eligible.push(userId)
  }

  return eligible
}

// ----------------------------------------------------------------------------
// Frequency-cap filter
// ----------------------------------------------------------------------------

/**
 * Filter a set of candidate userIds down to those who have NOT yet reached the
 * platform-wide frequency cap within the rolling window (Requirements 7.1, 7.4).
 *
 * The cap is applied consistently regardless of which business is sending — the
 * counter is keyed on `userId` alone, not on the business.
 */
export async function filterByFrequencyCap(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return []

  const eligible: string[] = []
  for (const userId of userIds) {
    const current = await kvGet(frequencyCapKey(userId))
    const count = current ? parseInt(current, 10) : 0
    if (count < FREQ_CAP_MAX) {
      eligible.push(userId)
    }
  }

  return eligible
}

/**
 * Increment a consumer's rolling frequency-cap counter by one.
 *
 * Called by the sender once per recipient when at least one channel delivery is
 * attempted (Requirement 7.2). The TTL is (re)seeded to the rolling window on
 * first creation, so the counter expires automatically (Requirement 7.3) — no
 * cleanup job is required.
 */
export async function incrementFrequencyCap(userId: string): Promise<void> {
  await kvIncr(frequencyCapKey(userId), FREQ_CAP_WINDOW_SECONDS)
}
