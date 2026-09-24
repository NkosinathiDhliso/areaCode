// One home for the consumer venue deep-link shape (proof-of-demand R1.1, R2.1,
// R12.3).
//
// `/map?venue={slug}&src={source}` is the single in-app arrival URL. The
// consumer app parses it in `apps/web/src/lib/venueArrival.ts`, stashes
// `{ slug, source }`, lands the venue as the Active_Venue in Browse_Mode, and
// records the Venue_Open with that source. Every server-side producer of the
// link routes through here so the shape and the `src` values cannot drift from
// the parser: the Share_Preview redirect (`src=share`) and every push
// notification click-through (`src=push`).
//
// A relative path, not an absolute URL: both consumers (the Share_Preview
// document and the service worker's `openWindow`) already resolve it against the
// consumer origin.

import type { OpenSource } from '@area-code/shared/constants/attribution'

/**
 * In-app destination for a venue arrival: `/map?venue={slug}&src={source}`.
 *
 * The slug is URL-encoded, so a caller cannot inject extra query parameters
 * through it. Returns a path, not an absolute URL, because both callers resolve
 * it against the consumer origin already.
 */
export function venueArrivalPath(slug: string, source: OpenSource): string {
  return `/map?venue=${encodeURIComponent(slug)}&src=${source}`
}

/**
 * Click-through fragment for a push notification's `data` (R2.1). Spread into
 * the notification `data` object:
 *
 * ```ts
 * data: { nodeId, ...pushVenueUrl(node.slug) }
 * ```
 *
 * The service worker reads `data.url` on `notificationclick`, so this is what
 * makes a push land on the venue card with `src=push` instead of on `/`. A
 * missing slug yields no key at all: a notification that cannot name its venue
 * falls back to the app's default landing rather than pointing at a link that
 * resolves to nothing.
 */
export function pushVenueUrl(slug: string | null | undefined): { url?: string } {
  if (typeof slug !== 'string' || slug.trim() === '') return {}
  return { url: venueArrivalPath(slug.trim(), 'push') }
}
