/**
 * Venue_Open, client side (proof-of-demand R2.1, R2.2, R2.6, R11.1).
 *
 * The consumer half of the receipt. A Venue_Open says "this consumer looked at
 * this venue before they walked in", and the check-in service later resolves it
 * through the Away_Gate into `foundVia`. Two triggers, and only two, record one:
 *
 *   - a share or push deep-link arrival (`useVenueArrival` in `apps/web`), with
 *     the source the link carried
 *   - a Commit_Mode open (the venue detail sheet), with `search` or `map`
 *
 * Selecting a card in Browse_Mode is deliberately NOT an open: it is a single
 * carousel step, too cheap a signal to sell to an owner, and recording it would
 * write a KV row on every swipe.
 *
 * Privacy (R2.2, R11.1): the request body is `{ source, away }` and nothing
 * else. `away` is a single boolean computed here from the device's own position;
 * the coordinates never leave the device, and the stored row holds no location,
 * no device data and no display name. When no fresh position is available the
 * flag is `null` (unknown) and the server falls back to the time arm of the
 * Away_Gate, which errs toward `walk_in`.
 */
import { AWAY_DISTANCE_METRES, type OpenSource } from '../constants/attribution'

import { api } from './api'
import { haversineDistance } from './geoUtils'
import { trackEvent } from './usageEvents'

export type { OpenSource }

/** Inputs to the Away_Gate distance arm. All read from client memory. */
export interface AwayFlagInput {
  /** The Last_Known_Position, or null/undefined when none was ever captured. */
  position: { lat: number; lng: number } | null | undefined
  /**
   * Whether {@link position} is inside the Position_Freshness_Window. The caller
   * owns the freshness decision (the web app uses `canRecenter`), because a
   * stale fix is worse than no fix: it could claim the consumer was away when
   * they are standing at the bar.
   */
  positionFresh: boolean
  /** The venue being opened. */
  venue: { lat: number; lng: number }
}

/**
 * Pure Away_Gate distance arm: `away = distance > AWAY_DISTANCE_METRES`.
 *
 * Returns `null` (unknown) when there is no fresh position, or when any
 * coordinate is not finite. 500 m is the maximum check-in radius, so a
 * borderline or missing position resolves toward `walk_in` rather than
 * inventing demand the map did not create.
 *
 * Total and side-effect free: safe to call with raw store values.
 */
export function computeAwayFlag({ position, positionFresh, venue }: AwayFlagInput): boolean | null {
  if (!positionFresh || !position) return null
  const coords = [position.lat, position.lng, venue.lat, venue.lng]
  if (!coords.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const metres = haversineDistance(position.lat, position.lng, venue.lat, venue.lng) * 1000
  return metres > AWAY_DISTANCE_METRES
}

/**
 * Record a Venue_Open: `POST /v1/nodes/:nodeId/open` with `{ source, away }`.
 *
 * Emits the aggregate `venue_open` usage event alongside the record, carrying
 * the source only (R2.6) - consent-gated inside `trackEvent`, and never a venue
 * id, so the two signals cannot be joined into a browsing history.
 *
 * Never throws. The open is instrumentation for the owner's receipt, not
 * something the consumer asked for, so a failure must not surface as an error
 * toast or block the venue they came to see. A lost open simply reads as a
 * Walk_In, which is the honest default.
 */
export async function recordVenueOpen(nodeId: string, source: OpenSource, away: boolean | null): Promise<void> {
  trackEvent('venue_open', { source })
  try {
    await api.post(`/v1/nodes/${encodeURIComponent(nodeId)}/open`, { source, away })
  } catch {
    // Unauthenticated, offline, or rate limited. Silent by design (see above).
  }
}
