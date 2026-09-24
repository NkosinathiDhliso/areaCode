// What makes a get usable as a Dated_Slot's featured get (proof-of-demand R8.4).
//
// One home for the rule, because two surfaces must agree on it: the schedule
// service rejects a `featuredRewardId` the owner may not feature, and the
// business portal's Tonight picker lists only the gets it will accept. If the
// picker were more generous than the service the owner would get a bare 400 on
// a get the form offered them.

/** The shape both sides read: the portal's `Reward` and the backend's stored
 *  reward both satisfy it. */
export interface FeaturableGet {
  isActive: boolean
  /** Active_Window end for event/offer gets. */
  endsAt?: string | null
  /** Loyalty equivalent of `endsAt`. */
  expiresAt?: string | null
}

/**
 * True iff the get has already ended. Either end marker in the past means the
 * get is over. A missing end is not an end: loyalty gets usually have none and
 * run until the owner switches them off.
 */
export function featuredGetHasEnded(get: Pick<FeaturableGet, 'endsAt' | 'expiresAt'>, nowMs: number): boolean {
  for (const value of [get.endsAt, get.expiresAt]) {
    if (value === undefined || value === null) continue
    const ms = Date.parse(value)
    if (Number.isFinite(ms) && ms <= nowMs) return true
  }
  return false
}

/** True iff the get is live: switched on and not yet ended. */
export function isFeaturableGet(get: FeaturableGet, nowMs: number): boolean {
  return get.isActive !== false && !featuredGetHasEnded(get, nowMs)
}
