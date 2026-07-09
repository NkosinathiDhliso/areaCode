import type mapboxgl from 'mapbox-gl'

/**
 * The Mapbox GL JS namespace (the module's default export). Kept as a type so
 * importing it here is erased at build time and never pulls the runtime into
 * the initial chunk.
 */
export type MapboxGL = typeof mapboxgl

// Resolved module, cached after the first successful load so Mapbox is fetched
// exactly once for the app's lifetime.
let loaded: MapboxGL | null = null
// In-flight load, so concurrent callers (useMapInit racing an early render)
// share one network fetch rather than each triggering their own import().
let inFlight: Promise<MapboxGL> | null = null

/**
 * Dynamically import Mapbox GL JS. The `import('mapbox-gl')` here is what
 * splits the large Mapbox runtime out of the consumer app's initial JS chunk
 * (Bundle_Budget R9.1): it is fetched only when the map first initialises,
 * behind the map screen's existing loading state.
 *
 * Idempotent: the resolved module is cached and every later call returns it
 * (or the single in-flight promise) instead of importing again.
 */
export async function loadMapboxGl(): Promise<MapboxGL> {
  if (loaded) return loaded
  if (!inFlight) {
    inFlight = import('mapbox-gl').then((mod) => {
      loaded = mod.default
      return loaded
    })
  }
  return inFlight
}

/**
 * The already-loaded Mapbox GL module, or `null` if {@link loadMapboxGl} has
 * not resolved yet. `useMapMarkers` reads this synchronously: markers only
 * ever render after the map is ready (`mapReady`), by which point
 * `useMapInit` has already resolved {@link loadMapboxGl}, so the module is
 * guaranteed present at the marker-building call site.
 */
export function getMapboxGl(): MapboxGL | null {
  return loaded
}
