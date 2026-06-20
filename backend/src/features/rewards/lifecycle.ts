/**
 * Event & Offer Gets — pure lifecycle + validation + claim-eligibility helpers.
 *
 * Event_Gets and Offer_Gets carry a half-open `[startsAt, endsAt)` Active_Window
 * (requirements spec, R1.3 / R3.1). This module holds the three deterministic,
 * side-effect-free decisions that govern that window:
 *
 *   - `classifyLifecycle` — where `nowMs` sits relative to the window.
 *   - `validateWindow`     — whether a proposed window is creatable/updatable.
 *   - `isClaimEligible`    — whether a consumer may claim, given category +
 *                            check-in state.
 *
 * Every function here is observably pure: no `Date.now()`, no I/O, no globals.
 * The current time is always injected as `nowMs` so callers (service layer) own
 * the clock and property tests can run these hundreds of times deterministically
 * (R3.5, R4.5).
 *
 * _Requirements: 1.3, 1.6, 2.4, 3.1, 3.5, 4.1, 4.2, 4.3, 4.5, 8.4_
 */

export type Lifecycle = 'upcoming' | 'live' | 'ended'
export type GetCategory = 'loyalty' | 'event' | 'offer'

/** Maximum Active_Window width for an Event_Get/Offer_Get (R1.6). */
const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/** Clock-skew tolerance for the not-in-past check at create time (R2.4). */
const PAST_SKEW_MS = 5 * 60 * 1000

/**
 * Classify an event/offer window relative to `nowMs` into exactly one
 * lifecycle state, using half-open boundaries (R3.1):
 *
 *   - `upcoming` when `nowMs < startsAt`
 *   - `live`     when `startsAt <= nowMs < endsAt`
 *   - `ended`    when `nowMs >= endsAt`
 *
 * `startsAt` and `endsAt` are ISO-8601 UTC timestamp strings; they are parsed
 * to epoch milliseconds via `Date.parse`.
 */
export function classifyLifecycle(startsAt: string, endsAt: string, nowMs: number): Lifecycle {
  const start = Date.parse(startsAt)
  const end = Date.parse(endsAt)

  if (nowMs < start) return 'upcoming'
  if (nowMs >= end) return 'ended'
  return 'live'
}

/**
 * Validate a proposed Active_Window for an Event_Get/Offer_Get.
 *
 * Rejection codes are returned in priority order (R1.3, R1.6, R2.4):
 *   1. `invalid_window`  — either bound unparseable, or `startsAt >= endsAt`.
 *   2. `window_too_long` — `endsAt - startsAt > 30 days`.
 *   3. `starts_in_past`  — `startsAt < nowMs - 5min` (clock-skew tolerance).
 */
export function validateWindow(
  startsAt: string,
  endsAt: string,
  nowMs: number,
): { ok: true } | { ok: false; code: 'invalid_window' | 'window_too_long' | 'starts_in_past' } {
  const start = Date.parse(startsAt)
  const end = Date.parse(endsAt)

  if (Number.isNaN(start) || Number.isNaN(end) || start >= end) {
    return { ok: false, code: 'invalid_window' }
  }

  if (end - start > MAX_WINDOW_MS) {
    return { ok: false, code: 'window_too_long' }
  }

  if (start < nowMs - PAST_SKEW_MS) {
    return { ok: false, code: 'starts_in_past' }
  }

  return { ok: true }
}

/**
 * Decide whether a get is visible in the consumer "near me" Get_Feed at
 * `nowMs`, AFTER the existing proximity query has selected it (R3.2, R3.3,
 * R3.4). This is the single source of truth for the feed lifecycle filter —
 * the service layer (`getRewardsNearMe`) calls it so the production predicate
 * and its property test exercise the same code.
 *
 *   - `loyalty` (or absent → defaulted to `loyalty`)  → visible (R3.3)
 *   - `event`/`offer` with a `live` window            → visible (R3.2)
 *   - `event`/`offer` that is `upcoming`/`ended`       → hidden  (R3.4)
 *   - `event`/`offer` missing either window bound      → hidden  (cannot be live)
 *
 * Proximity is enforced upstream by the query; this helper only applies the
 * lifecycle gate, so it adds no new reach surface (R5).
 */
export function isVisibleInFeed(
  input: {
    getCategory?: GetCategory | undefined
    startsAt?: string | null | undefined
    endsAt?: string | null | undefined
  },
  nowMs: number,
): boolean {
  const getCategory = input.getCategory ?? 'loyalty'
  if (getCategory === 'loyalty') return true

  // An event/offer get with no window cannot be live — exclude it rather than
  // parsing a NaN boundary.
  if (!input.startsAt || !input.endsAt) return false

  return classifyLifecycle(input.startsAt, input.endsAt, nowMs) === 'live'
}

/**
 * Decide whether a consumer may claim a get at this gate, per the R4/R8.4
 * truth table:
 *
 *   - `loyalty`                                          → eligible
 *   - `event`/`offer` + not `live`                       → not_live        (R8.4)
 *   - `event`/`offer` + live + requiresCheckIn + !hasCI  → check_in_required (R4.2)
 *   - `event`/`offer` + live + (!requiresCheckIn || hasCI) → eligible      (R4.1, R4.3)
 *
 * Loyalty gets are always eligible at this gate; their existing claim rules
 * are enforced elsewhere. For loyalty callers pass `lifecycle: 'live'`.
 */
export function isClaimEligible(input: {
  getCategory: GetCategory
  claimRequiresCheckIn: boolean
  lifecycle: Lifecycle
  hasQualifyingCheckIn: boolean
}): { eligible: true } | { eligible: false; code: 'check_in_required' | 'not_live' } {
  const { getCategory, claimRequiresCheckIn, lifecycle, hasQualifyingCheckIn } = input

  if (getCategory === 'loyalty') {
    return { eligible: true }
  }

  if (lifecycle !== 'live') {
    return { eligible: false, code: 'not_live' }
  }

  if (claimRequiresCheckIn && !hasQualifyingCheckIn) {
    return { eligible: false, code: 'check_in_required' }
  }

  return { eligible: true }
}
