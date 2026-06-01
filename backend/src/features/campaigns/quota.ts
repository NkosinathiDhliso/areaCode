// ============================================================================
// Win-Back Campaigns — Per-Business Monthly Send Quota
// ----------------------------------------------------------------------------
// A business may dispatch at most a per-tier number of campaign recipients per
// calendar month (Requirement 9.3): growth 2000, pro 10000. A send that would
// exceed the remaining quota is rejected WHOLE — never truncated to fit
// (Requirement 9.4, Property 8). starter/payg/free are not entitled to send at
// all (quota 0); the API tier gate (task 8.2) returns the upgrade response
// before dispatch, and this module is the defensive backstop.
//
// The counter lives in the existing DynamoDB KV store (Constraint C4) under
// `campaign:quota:<businessId>:<yyyy-mm>` with a TTL so month buckets expire
// automatically — no cleanup job.
//
// ---------------------------------------------------------------------------
// SEAM NOTE FOR TASK 7.2 (send-quota enforcement):
//   Task 5.1 ships the minimal quota gate the dispatcher needs. Task 7.2 owns
//   the full quota feature, including the API-layer pre-check that returns a
//   409 `quota_exceeded` with `remaining` BEFORE the campaign transitions to
//   `sending`. Task 7.2 should consolidate onto the helpers below rather than
//   introduce a second counter/key:
//     - `monthlyQuotaForTier(tier)`   — per-tier monthly cap (single source)
//     - `quotaMonthKey(businessId, nowMs)` — the KV key shape
//     - `assertWithinQuota(tier, used, count)` — pure, throws on overflow
//     - `reserveQuota({...})` — atomic consume used by the dispatcher
// ===========================================================================

import { kvGet, kvIncrBy } from '../../shared/kv/dynamodb-kv.js'

/** Per-tier monthly recipient quota (Requirement 9.3). Absent tier = 0 (not entitled). */
export const TIER_MONTHLY_QUOTA: Readonly<Record<string, number>> = {
  growth: 2000,
  pro: 10000,
}

/** A month bucket lives slightly over a month so it expires after the calendar month rolls. */
const QUOTA_TTL_SECONDS = 35 * 24 * 60 * 60

/** Raised when a send would exceed the remaining monthly quota (Requirement 9.4). */
export class QuotaExceededError extends Error {
  readonly remaining: number
  readonly requested: number
  constructor(remaining: number, requested: number) {
    super(`Campaign send rejected: requested ${requested} recipients but only ${remaining} remain this month`)
    this.name = 'QuotaExceededError'
    this.remaining = remaining
    this.requested = requested
  }
}

/** Monthly recipient quota for a tier; 0 for any tier not entitled to send. */
export function monthlyQuotaForTier(tier: string): number {
  return TIER_MONTHLY_QUOTA[tier] ?? 0
}

/**
 * KV key for a business's recipient counter in the calendar month of `nowMs`.
 * Uses UTC year-month (`yyyy-mm`); calendar-month semantics are intentional and
 * shared with task 7.2.
 */
export function quotaMonthKey(businessId: string, nowMs: number): string {
  const d = new Date(nowMs)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `campaign:quota:${businessId}:${yyyy}-${mm}`
}

/**
 * Pure quota assertion (Property 8). Given the tier, the count already used
 * this month, and the count `n` a send wants to add, returns the remaining
 * quota when `n` fits, or throws `QuotaExceededError` when `n > remaining`.
 *
 * Never truncates — the send either fits whole or is rejected whole.
 */
export function assertWithinQuota(tier: string, alreadyUsed: number, count: number): { remaining: number } {
  const quota = monthlyQuotaForTier(tier)
  const remaining = Math.max(0, quota - alreadyUsed)
  if (count > remaining) {
    throw new QuotaExceededError(remaining, count)
  }
  return { remaining: remaining - count }
}

/**
 * Atomically reserve `count` recipients against the business's monthly quota.
 *
 * Strategy: increment the counter by `count` first (atomic), then validate the
 * new total against the tier cap. If the reservation overflows, the increment
 * is rolled back (`-count`) and `QuotaExceededError` is thrown, so a rejected
 * send consumes nothing (Requirement 9.4 — never truncate, never partially
 * consume). Incrementing-then-checking (rather than read-then-increment) closes
 * the race where two concurrent sends could each read the same pre-increment
 * value and both slip under the cap.
 *
 * Returns the remaining quota after a successful reservation.
 */
export async function reserveQuota(args: {
  businessId: string
  tier: string
  count: number
  nowMs: number
}): Promise<{ remaining: number; used: number }> {
  const { businessId, tier, count, nowMs } = args
  const quota = monthlyQuotaForTier(tier)
  const key = quotaMonthKey(businessId, nowMs)

  // Reserving zero recipients is a no-op that still reports remaining quota.
  if (count <= 0) {
    const current = await kvGet(key)
    const used = current ? parseInt(current, 10) : 0
    return { remaining: Math.max(0, quota - used), used }
  }

  const newTotal = await kvIncrBy(key, count, QUOTA_TTL_SECONDS)

  if (newTotal > quota) {
    // Roll back the reservation; this send is rejected whole.
    await kvIncrBy(key, -count, QUOTA_TTL_SECONDS)
    const remaining = Math.max(0, quota - (newTotal - count))
    throw new QuotaExceededError(remaining, count)
  }

  return { remaining: quota - newTotal, used: newTotal }
}
