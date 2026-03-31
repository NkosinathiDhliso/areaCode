import type { MapViewProps } from '../types/map'

/**
 * MapView — platform abstraction wrapper.
 * Web: Mapbox GL JS (implemented in apps/web)
 * Mobile: @rnmapbox/maps (implemented in apps/mobile)
 *
 * This is the shared interface. Each platform provides its own implementation
 * and passes it through the MapView props. The shared code never imports
 * Mapbox directly.
 */
export function MapView(_props: MapViewProps) {
  // Platform-specific implementations override this.
  // This stub exists so shared code can reference the type.
  return null
}
