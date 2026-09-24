/**
 * Rate-limit configuration for the attribution writes (proof-of-demand R2.5).
 *
 * The existing DynamoDB TTL sliding window, keyed per IP like every other
 * limiter in the app. Sized for a consumer browsing venues on a night out —
 * opening a detail sheet, backing out, opening another — while still bounding
 * a client that tries to spray open rows across venues. The row itself is
 * merge-on-write and one per consumer per venue, so the limiter is about
 * request volume, not about the honesty of the count.
 */
export const VENUE_OPEN_RATE_LIMIT = {
  key: 'venue-open',
  max: 60,
  windowSeconds: 60,
} as const

/**
 * Route rate limit for `POST /v1/check-in` (proof-of-demand R15.9, decision 9).
 *
 * Ten a minute is far above any human pattern and it is the abuse control for
 * the one write that mints rewards, so the number is unchanged in every
 * environment, hard-coded here rather than read from an env var: a UAT-only
 * override would be a second source of truth for the same limit
 * (`no-fallbacks-no-legacy.md`).
 *
 * This is NOT the per-venue check-in cooldown, which already answers with its
 * own "you can check in here again in N" copy. This limiter is the burst guard,
 * so its copy names attempts, not the venue.
 */
export const CHECK_IN_ROUTE_RATE_LIMIT = {
  key: 'check-in',
  max: 10,
  windowSeconds: 60,
  message: (waitSeconds: number) => `Too many check-in attempts, wait ${waitSeconds} seconds.`,
} as const
