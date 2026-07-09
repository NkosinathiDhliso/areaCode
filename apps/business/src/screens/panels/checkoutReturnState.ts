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
