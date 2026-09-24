/**
 * Venue_Open, consumer web wiring (proof-of-demand R2.1, R2.2).
 *
 * The one place the web app turns "a venue was opened" into a recorded
 * Venue_Open. It reads the Last_Known_Position from the shared location store,
 * applies the same freshness gate the map's Recenter_Control and `vibeRank` use
 * (`canRecenter` / `POSITION_FRESHNESS_WINDOW`), and hands the resulting
 * boolean to the shared client (`packages/shared/lib/venueOpen.ts`), which posts
 * `{ source, away }`.
 *
 * The position itself never leaves the device: only the boolean crosses the
 * wire, and only ever as `true`, `false` or `null` (R2.2, R11.1).
 *
 * Callers: the deep-link arrival effect (`useVenueArrival`, share and push) and
 * the Commit_Mode mount effect (`NodeDetailContent`, search and map). A card
 * selection in Browse_Mode is not an open.
 */
import type { OpenSource } from '@area-code/shared/constants/attribution'
import { computeAwayFlag, recordVenueOpen } from '@area-code/shared/lib/venueOpen'
import { useLocationStore } from '@area-code/shared/stores/locationStore'

import { canRecenter } from './cameraControl'

/** The venue fields the Away_Gate needs. Satisfied by a `Node`. */
export interface OpenedVenue {
  id: string
  lat: number
  lng: number
}

/**
 * Record a Venue_Open for `venue`, computing `away` from a fresh position.
 *
 * Fire-and-forget: the shared client swallows its own failures, so this returns
 * void and never rejects. Safe to call from an effect body.
 */
export function reportVenueOpen(venue: OpenedVenue, source: OpenSource): void {
  const { lastKnownPosition, capturedAt } = useLocationStore.getState()
  const away = computeAwayFlag({
    position: lastKnownPosition,
    positionFresh: canRecenter(capturedAt, Date.now()),
    venue: { lat: venue.lat, lng: venue.lng },
  })
  void recordVenueOpen(venue.id, source, away)
}
