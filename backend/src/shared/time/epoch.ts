/**
 * Epoch seconds as a distinct type — the fix for a bug class, not a style choice.
 *
 * Presence records, DynamoDB TTLs and the expiry sweep are all in epoch
 * SECONDS; `Date.now()` and every ISO round-trip are in MILLISECONDS. Both are
 * `number`, so the compiler was happy to let the rewards near-me read hand a
 * millisecond instant to a seconds parameter, which made every live presence
 * record look long expired and every venue behind a get read as empty
 * (proof-of-demand R15.4).
 *
 * Branding costs one call at each boundary and makes that mistake a type error.
 * Parameters that mean epoch seconds take `EpochSeconds`; the value can only be
 * produced by the constructors here, each of which names its input unit.
 */

declare const EPOCH_SECONDS_BRAND: unique symbol

/** A whole number of seconds since the Unix epoch. */
export type EpochSeconds = number & { readonly [EPOCH_SECONDS_BRAND]: 'EpochSeconds' }

/** Now, in epoch seconds. */
export function nowEpochSeconds(): EpochSeconds {
  return epochSecondsFromMs(Date.now())
}

/** Epoch seconds for an epoch-millisecond instant, truncated to the whole second. */
export function epochSecondsFromMs(epochMs: number): EpochSeconds {
  return Math.floor(epochMs / 1000) as EpochSeconds
}

/**
 * Accept a value that is ALREADY epoch seconds (a stored `expiresAt`, an
 * `endedAt` read back off a record, a worker's sweep instant). Truncated, so a
 * fractional second cannot leak through.
 */
export function epochSeconds(seconds: number): EpochSeconds {
  return Math.floor(seconds) as EpochSeconds
}
