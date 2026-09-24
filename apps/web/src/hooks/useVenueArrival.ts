import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import { useEffect, useRef } from 'react'

import { clearVenueArrival, readVenueArrival } from '../lib/venueArrival'
import { reportVenueOpen } from '../lib/venueOpen'

/**
 * `useVenueArrival` - lands a share or push deep-link arrival on its venue
 * (proof-of-demand R1.1, R1.5, R1.7).
 *
 * The stash is written by `captureVenueArrivalFromLocation` before any
 * navigation (see `lib/venueArrival.ts`). Once the city payload is loaded this
 * hook resolves the stashed slug to a node id and hands it to the existing
 * Focus_Signal path (`mapStore.setFocusNodeId`), whose consumer in
 * `useCarouselSelection` flies to `MAP_ARRIVAL_ZOOM` and opens Browse_Mode with
 * the venue as the Active_Venue. No Commit_Mode auto-open: the detail sheet
 * still opens only from "View details" (`map-carousel.md`).
 *
 * The stash outlives an unauthenticated arrival on purpose. The venue is
 * surfaced either way (the map is public), but the Venue_Open belongs to a
 * consumer, so it is recorded on the first pass where the user is
 * authenticated - which is what makes a login round trip keep its source
 * (R1.5, R1.7). The stash is dropped once consumed, and also when the city
 * payload has loaded and simply does not contain the slug, so a stale link can
 * never block the normal cold open.
 */
export function useVenueArrival(mapReady: boolean): void {
  const nodes = useMapStore((s) => s.nodes)
  const setFocusNodeId = useMapStore((s) => s.setFocusNodeId)
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)

  // The last `{slug}|{auth state}` we focused. Keyed on the auth state so the
  // venue is restored once more after sign-in, when the login screen has taken
  // the map's place, without re-flying the camera on every nodes update.
  const lastFocusKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!mapReady) return
    const arrival = readVenueArrival()
    if (!arrival) return

    const node = Object.values(nodes).find((n) => n.slug === arrival.slug)
    if (!node) {
      // City payload still loading: wait for it. Loaded without the slug: the
      // link points at a venue this city payload does not carry, so drop it.
      if (Object.keys(nodes).length > 0) clearVenueArrival()
      return
    }

    const focusKey = `${arrival.slug}|${isAuthenticated ? 'auth' : 'anon'}`
    if (lastFocusKeyRef.current !== focusKey) {
      lastFocusKeyRef.current = focusKey
      setFocusNodeId(node.id)
    }

    // The Venue_Open is a consumer-authenticated record. Keep the stash until
    // then so the source survives the login round trip.
    if (!isAuthenticated) return

    clearVenueArrival()
    // The single place `share` and `push` opens are recorded (R2.1). The stash
    // is cleared first, so a re-render cannot record the same arrival twice.
    // Nothing else in the app may record a deep-link open.
    reportVenueOpen(node, arrival.source)
  }, [mapReady, nodes, isAuthenticated, setFocusNodeId])
}
