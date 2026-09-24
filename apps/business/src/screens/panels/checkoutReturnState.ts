// Pure state machine for the Yoco checkout return flow (billing-revenue-integrity
// R6, design Flow 4). Kept free of React and network so it can be unit-tested
// directly (task 9.5). The hook `useCheckoutReturn` drives the poll and feeds
// elapsed time and the latest profile into `computeReturnState`.

// The `status` query parameter Yoco appends to the return URL.
export type CheckoutReturnStatus = 'success' | 'cancelled' | 'failed'

// The state the panel renders. `idle` means no checkout return in progress.
export type ReturnState = 'idle' | 'activating' | 'confirmed' | 'timeout' | 'cancelled' | 'failed'

// Poll cadence and ceiling from R6.1: every 2 seconds, up to 60 seconds.
export const POLL_INTERVAL_MS = 2_000
export const POLL_MAX_MS = 60_000

// Paid tiers whose presence (with a future paidUntil) confirms activation.
// 'free'/'starter' are not paid, so they never confirm a success return.
const PAID_TIERS = ['growth', 'pro', 'payg']

// The subset of the business profile the return flow inspects.
export interface ReturnProfile {
  tier?: string | null
  paidUntil?: string | null
}

// Activation has landed once the profile shows a paid tier AND a paid window
// that has not already lapsed (paidUntil >= now).
export function hasPaidStateLanded(profile: ReturnProfile | null, nowMs: number): boolean {
  if (!profile) return false
  const tier = profile.tier === 'free' ? 'starter' : profile.tier
  if (!tier || !PAID_TIERS.includes(tier)) return false
  if (!profile.paidUntil) return false
  return new Date(profile.paidUntil).getTime() >= nowMs
}

export interface ComputeReturnStateInput {
  // The parsed return status, or null when there is no checkout return.
  status: CheckoutReturnStatus | null
  // Milliseconds elapsed since polling began.
  elapsedMs: number
  // Whether the awaited post-checkout state has landed. This is the core signal
  // the machine turns on. The generalized poll core (plans and boost) computes
  // it from its own landed predicate and passes it directly. When omitted, it
  // is derived from `profile`/`nowMs` via hasPaidStateLanded - the plans
  // convenience retained so the pure unit tests stay expressive.
  landed?: boolean
  // Latest polled profile (plans path), or null before the first poll resolves.
  profile?: ReturnProfile | null
  // Current time in ms, injected so the machine stays pure.
  nowMs?: number
}

// Maps (status, elapsed, landed) to exactly one render state. Never throws.
export function computeReturnState(input: ComputeReturnStateInput): ReturnState {
  const { status, elapsedMs } = input
  if (status === 'cancelled') return 'cancelled'
  if (status === 'failed') return 'failed'
  if (status === 'success') {
    const landed = input.landed ?? hasPaidStateLanded(input.profile ?? null, input.nowMs ?? Date.now())
    if (landed) return 'confirmed'
    if (elapsedMs >= POLL_MAX_MS) return 'timeout'
    return 'activating'
  }
  return 'idle'
}

// Reads the `status` param from a location search string, returning null for
// anything that is not a recognised Checkout_Return_Status.
export function parseReturnStatus(search: string): CheckoutReturnStatus | null {
  const value = new URLSearchParams(search).get('status')
  if (value === 'success' || value === 'cancelled' || value === 'failed') return value
  return null
}

// ─── Boost return identity (R15.11) ──────────────────────────────────────────

// The query param that carries the Yoco checkout id of the purchase being
// awaited. It is the same `yocoCheckoutId` the purchases list and the
// Boost_Scoreboard are keyed on, so the landed row is identified, never guessed.
export const RETURN_CHECKOUT_ID_PARAM = 'checkoutId'

// Params the return leg consumes and must not leave behind for a refresh to
// replay (R6.3).
export const RETURN_PARAMS = ['status', RETURN_CHECKOUT_ID_PARAM] as const

/**
 * Reads the awaited checkout id from a location search string.
 *
 * Bounded to the character set a Yoco checkout id uses, which is also the set
 * the `BOOST_CHECKOUT#` Idempotency_Marker key allows, so a hand-edited URL can
 * never turn into a lookup for something that could not be a marker.
 */
export function parseReturnCheckoutId(search: string): string | null {
  const value = new URLSearchParams(search).get(RETURN_CHECKOUT_ID_PARAM)
  if (value === null) return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 128) return null
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null
}

/** A boost purchase row, reduced to the field that identifies it. */
export interface BoostPurchaseIdentity {
  yocoCheckoutId: string
}

/**
 * Has the purchase the owner just paid for appeared in their purchases list?
 *
 * Identity, not arithmetic. The previous count baseline was taken at the first
 * poll, so a webhook that landed before that poll was already counted and the
 * list could never be seen to "grow": the owner watched "still processing" for
 * 60 seconds after a payment that had in fact succeeded (R15.11).
 *
 * Without an awaited id there is nothing to confirm, so this is false: the
 * banner times out and names support rather than claiming a confirmation it
 * cannot see.
 */
export function hasBoostPurchaseLanded(items: readonly BoostPurchaseIdentity[], checkoutId: string | null): boolean {
  if (checkoutId === null) return false
  return items.some((row) => row.yocoCheckoutId === checkoutId)
}
