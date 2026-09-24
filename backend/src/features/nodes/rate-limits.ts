/**
 * Rate-limit configuration for the unauthenticated venue reads.
 *
 * One key shared by `GET /v1/nodes/:nodeSlug/public` and the Share_Preview
 * route `GET /v1/share/node/:slug` (proof-of-demand R12.2: the preview is rate
 * limited with the same key the public node route uses). Both serve the same
 * venue read to anyone with a link, so they share one per-IP budget rather than
 * each getting an independent allowance.
 *
 * Per IP per minute. Generous enough for a link doing the rounds in a group
 * chat (each crawler and reader arrives on its own IP) and for the handful of
 * requests one visitor makes, while still bounding a scraper walking slugs.
 */
export const PUBLIC_NODE_RATE_LIMIT = {
  key: 'node-public',
  max: 60,
  windowSeconds: 60,
} as const

/**
 * Rate limit for the Going toggle (proof-of-demand R9.1).
 *
 * Per IP per minute, on the shared DynamoDB TTL sliding window. A consumer
 * marking, changing their mind and marking again is a handful of calls; this
 * bounds a client spraying marks across venues without ever getting in the way
 * of a real hand on a real phone. The rows themselves are one per consumer per
 * venue per night, so the limiter is about request volume, not about the honesty
 * of the count.
 */
export const GOING_RATE_LIMIT = {
  key: 'going',
  max: 30,
  windowSeconds: 60,
} as const

/**
 * Rate limit for `GET /v1/nodes/:nodeId/who-is-here`
 * (proof-of-demand R15.9, decision 9).
 *
 * Sixty per ten minutes, in every environment. On a busy night a consumer opens
 * a dozen venue sheets in ten minutes and each open reads who's-here, so the old
 * twenty throttled ordinary curiosity and the `429` was indistinguishable from a
 * broken screen. Sixty still bounds scraping of a privacy-sensitive read.
 *
 * Hard-coded here, not behind an env override: one number, one home
 * (`no-fallbacks-no-legacy.md`). The copy names the moment rather than the
 * mechanism, because nothing the consumer did was wrong.
 */
export const WHO_IS_HERE_RATE_LIMIT = {
  key: 'who-is-here',
  max: 60,
  windowSeconds: 600,
  message: () => 'Slow down a moment, then tap to see who is here.',
} as const
