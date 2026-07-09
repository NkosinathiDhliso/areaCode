/**
 * Pure mint-decision core — Loyalty Repeat Redemption spec, Requirement 2.
 *
 * The Claim_Guard row (`REWARD_CLAIM#{rewardId}#{userId}`) is the single
 * record of a consumer's claim lifecycle for a reward. `decideMint` answers
 * one question from that state: may a new Redemption_Code be minted right now?
 *
 * This module is observably pure: no `Date.now()`, no I/O, no globals. The
 * caller supplies `nowMs`. The DynamoDB condition expression in
 * `reward-evaluator-repository.ts` implements exactly this function's accept
 * set (R2.5), and this function is the tested source of truth.
 *
 * ISO-8601 UTC timestamps are compared by parsing to epoch milliseconds, which
 * matches the lexicographic comparison the condition expression relies on.
 */

export type RepeatPolicy = 'once' | 'per_visit'

export interface GuardState {
  /** Expiry of the current (most recent) minted code. ISO-8601 UTC. */
  codeExpiresAt: string
  /**
   * Redemption time of the current code, stamped by staff validation.
   * Absent while the current code is live and unredeemed. ISO-8601 UTC.
   */
  redeemedAt?: string
}

/** The Repeat_Window: minimum gap between a redemption and the next mint. */
export const REPEAT_WINDOW_MS = 4 * 60 * 60 * 1000

export type MintDecision =
  | { mint: true }
  | { mint: false; code: 'live_code_exists' | 'already_redeemed' | 'repeat_window' }

/**
 * Decide whether a new Redemption_Code may be minted for a `(consumer, reward)`
 * given the reward's `repeatPolicy`, the current Claim_Guard state, and the
 * current time in epoch milliseconds.
 *
 * Truth table (Loyalty Repeat Redemption design):
 *
 * | policy      | guard state                        | decision            |
 * | ----------- | ---------------------------------- | ------------------- |
 * | any         | no guard row                       | mint                |
 * | any         | current code live, unredeemed      | no: live_code_exists|
 * | once        | current code redeemed (any time)   | no: already_redeemed|
 * | once        | code expired, never redeemed       | mint                |
 * | per_visit   | redeemed, redeemedAt <= now - 4h   | mint                |
 * | per_visit   | redeemed, redeemedAt > now - 4h    | no: repeat_window   |
 * | per_visit   | code expired, never redeemed       | mint                |
 *
 * The trap this closes: for `per_visit`, an expired code is NOT sufficient to
 * re-mint once a redemption exists. A consumer who redeems at hour 23 of a
 * 24-hour code must still wait the full Repeat_Window past the redemption, not
 * merely for `codeExpiresAt` to pass (R2.3).
 */
export function decideMint(policy: RepeatPolicy, guard: GuardState | null, nowMs: number): MintDecision {
  // No prior claim: always mintable.
  if (guard === null) return { mint: true }

  // A redemption stamp on the current code means it was validated by staff.
  if (guard.redeemedAt !== undefined) {
    if (policy === 'once') return { mint: false, code: 'already_redeemed' }
    // per_visit: mintable only once the Repeat_Window has fully elapsed.
    const redeemedMs = Date.parse(guard.redeemedAt)
    if (nowMs - redeemedMs >= REPEAT_WINDOW_MS) return { mint: true }
    return { mint: false, code: 'repeat_window' }
  }

  // No redemption stamp: the current code is either still live or expired
  // without ever being redeemed.
  const expiresMs = Date.parse(guard.codeExpiresAt)
  if (nowMs < expiresMs) return { mint: false, code: 'live_code_exists' }

  // Expired, never redeemed: a new code may be minted (R2.2, R2.3).
  return { mint: true }
}
