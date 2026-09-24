/**
 * Venue deep-link arrival (proof-of-demand R1.1, R1.5, R1.7, R12.3).
 *
 * Two URL shapes land a consumer on a single venue:
 *   - `/node/{slug}` - the shared link. An Amplify rewrite serves the
 *     Share_Preview HTML to crawlers; script-capable clients are redirected to
 *     the second shape, and clients that bypass the rewrite hit the SPA here.
 *   - `/map?venue={slug}&src={source}` - the redirect target, and the shape
 *     push notifications use (`src=push`).
 *
 * Both resolve to the `map` route. The `{ slug, source }` pair is stashed in
 * sessionStorage under `pendingVenueArrival` so a login round trip never loses
 * the source (R1.7), the same pattern `pendingQrCheckIn` uses. Both go through
 * the shared `safeStorage` helper, because sessionStorage throws in private-mode
 * browsers (R15.19).
 *
 * The arrival lands the venue as the Active_Venue in Browse_Mode via the
 * existing Focus_Signal path. Commit_Mode still opens only from the
 * "View details" control (`map-carousel.md`).
 */
import { OPEN_SOURCES, type OpenSource } from '@area-code/shared/constants/attribution'
import { readStoredJson, removeStored, writeStoredJson } from '@area-code/shared/lib/safeStorage'

/** sessionStorage key for the pending arrival. */
export const PENDING_VENUE_ARRIVAL_KEY = 'pendingVenueArrival'

export interface PendingVenueArrival {
  /** Venue slug, resolved to a node id once the city payload is loaded. */
  slug: string
  /** Where the arrival came from. Recorded as the Venue_Open's Open_Source. */
  source: OpenSource
}

/**
 * Source used when a deep link carries no (or an unrecognised) `src`. Both
 * arrival shapes are link surfaces, so `share` is the honest default; `map`
 * would claim an in-app open that did not happen.
 */
const DEFAULT_ARRIVAL_SOURCE: OpenSource = 'share'

/** Venue slugs are kebab-case; anything else is not a slug we can resolve. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/i

function normaliseSlug(raw: string | null | undefined): string | null {
  if (!raw) return null
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null
  }
  const slug = decoded.trim()
  return SLUG_PATTERN.test(slug) ? slug : null
}

function readSource(search: string): OpenSource {
  let src: string | null = null
  try {
    src = new URLSearchParams(search).get('src')
  } catch {
    src = null
  }
  const match = OPEN_SOURCES.find((s) => s === src)
  return match ?? DEFAULT_ARRIVAL_SOURCE
}

/**
 * Pure parse of the two deep-link shapes. Returns null for every other URL,
 * and for a `venue`/slug segment that is not a usable slug.
 */
export function parseVenueArrival(path: string, search: string): PendingVenueArrival | null {
  const nodeMatch = /^\/node\/([^/?#]+)\/?$/.exec(path)
  if (nodeMatch) {
    const slug = normaliseSlug(nodeMatch[1])
    return slug ? { slug, source: readSource(search) } : null
  }
  if (path === '/map' || path === '/map/') {
    let venue: string | null = null
    try {
      venue = new URLSearchParams(search).get('venue')
    } catch {
      venue = null
    }
    const slug = normaliseSlug(venue)
    return slug ? { slug, source: readSource(search) } : null
  }
  return null
}

/**
 * Stash the arrival, returning whether it will survive a sign-in round trip.
 * False in a private-mode browser: the arrival still resolves in this tab from
 * the URL, but a login redirect would lose the source.
 */
export function stashVenueArrival(arrival: PendingVenueArrival): boolean {
  return writeStoredJson('session', PENDING_VENUE_ARRIVAL_KEY, arrival)
}

/** The stashed arrival, or null when there is none or it is unreadable. */
export function readVenueArrival(): PendingVenueArrival | null {
  const parsed = readStoredJson('session', PENDING_VENUE_ARRIVAL_KEY) as {
    slug?: unknown
    source?: unknown
  } | null
  if (!parsed) return null
  const slug = typeof parsed.slug === 'string' ? normaliseSlug(parsed.slug) : null
  if (!slug) return null
  const source = OPEN_SOURCES.find((s) => s === parsed.source) ?? DEFAULT_ARRIVAL_SOURCE
  return { slug, source }
}

export function hasPendingVenueArrival(): boolean {
  return readVenueArrival() !== null
}

export function clearVenueArrival(): void {
  removeStored('session', PENDING_VENUE_ARRIVAL_KEY)
}

/**
 * Read the current URL, stash any arrival it carries, and normalise the address
 * bar to `/map` so a later back/forward does not replay the arrival. Called on
 * first paint and on popstate; returns the arrival it stashed, or null.
 */
export function captureVenueArrivalFromLocation(): PendingVenueArrival | null {
  const arrival = parseVenueArrival(window.location.pathname, window.location.search)
  if (!arrival) return null
  stashVenueArrival(arrival)
  if (window.location.pathname !== '/map' || window.location.search) {
    window.history.replaceState({ route: 'map' }, '', '/map')
  }
  return arrival
}
