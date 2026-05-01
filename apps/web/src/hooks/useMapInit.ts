import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import type { MapInstance } from '@area-code/shared/types'

const MAPBOX_TOKEN = import.meta.env['VITE_MAPBOX_TOKEN'] as string | undefined

const DEFAULT_CENTER: [number, number] = [28.0473, -26.2041]
const DEFAULT_ZOOM = 13

let singletonMap: mapboxgl.Map | null = null
let singletonContainer: HTMLDivElement | null = null
let singletonLoaded = false

function buildMapInstance(map: mapboxgl.Map): MapInstance {
  return {
    flyTo: (opts) => {
      try {
        const flyOpts: Record<string, unknown> = { center: opts.center }
        if (opts.zoom !== undefined) flyOpts['zoom'] = opts.zoom
        map.flyTo(flyOpts as Parameters<typeof map.flyTo>[0])
      } catch {
        // Map may have been removed, ignore
      }
    },
    setFeatureState: () => {},
    getZoom: () => {
      try { return map.getZoom() } catch { return DEFAULT_ZOOM }
    },
    getBounds: () => ({
      toArray: (): [[number, number], [number, number]] => {
        try {
          const b = map.getBounds()
          if (!b) return [[0, 0], [0, 0]]
          return [
            [b.getWest(), b.getSouth()],
            [b.getEast(), b.getNorth()],
          ]
        } catch {
          return [[0, 0], [0, 0]]
        }
      },
    }),
  }
}

/**
 * Initialises Mapbox GL JS once and persists across navigation.
 * mapRef is only set AFTER the map fires 'load', ensuring markers
 * added via useMapMarkers are properly geo-anchored.
 *
 * Includes graceful error handling — if the map fails to load,
 * mapError is set so the UI can show a fallback instead of crashing.
 */
export function useMapInit() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const setMapInstance = useMapStore((s) => s.setMapInstance)
  // Increment counter when map becomes ready. This is more reliable than a
  // boolean that can flip false→true→false during React strict-mode remounts.
  const [mapReadyKey, setMapReadyKey] = useState(0)
  const [mapError, setMapError] = useState<string | null>(null)

  const retryMap = useCallback(() => {
    // Force cleanup and re-init
    if (singletonMap) {
      try { singletonMap.remove() } catch { /* already removed */ }
      singletonMap = null
      singletonContainer = null
      singletonLoaded = false
    }
    mapRef.current = null
    setMapError(null)
    setMapReadyKey(0)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // If there's an error state, don't try to init (wait for retry)
    if (mapError) return

    // Singleton already loaded and attached to same container
    if (singletonMap && singletonContainer === container && singletonLoaded) {
      mapRef.current = singletonMap
      setMapInstance(buildMapInstance(singletonMap))
      setMapReadyKey((k) => k + 1)
      requestAnimationFrame(() => {
        try { singletonMap?.resize() } catch { /* ignore */ }
      })
      return
    }

    if (singletonMap) {
      try { singletonMap.remove() } catch { /* already removed */ }
      singletonMap = null
      singletonContainer = null
      singletonLoaded = false
    }

    if (!MAPBOX_TOKEN) {
      setMapError('Map configuration missing. Please try again later.')
      return
    }

    try {
      mapboxgl.accessToken = MAPBOX_TOKEN

      const map = new mapboxgl.Map({
        container,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        pitch: 45,
        bearing: -10,
        failIfMajorPerformanceCaveat: false,
      })

      singletonMap = map
      singletonContainer = container

      // Handle map errors gracefully
      map.on('error', (e) => {
        // Don't crash on tile load errors or minor issues
        const msg = e.error?.message ?? ''
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
          // Network issue — map may still partially work, don't show error
          return
        }
        // Log but don't crash
        if (import.meta.env?.DEV) {
          console.warn('[useMapInit] Map error:', e.error)
        }
      })

      // Only expose the map ref AFTER it's fully loaded
      map.on('load', () => {
        singletonLoaded = true
        mapRef.current = map
        setMapInstance(buildMapInstance(map))
        setMapReadyKey((k) => k + 1)

        try {
          map.setFog({
            range: [0.5, 10],
            color: '#0a0a0f',
            'horizon-blend': 0.03,
          })

          const layers = map.getStyle().layers
          const labelLayer = layers?.find(
            (l) => l.type === 'symbol' && l.layout?.['text-field'],
          )

          map.addLayer(
            {
              id: '3d-buildings',
              source: 'composite',
              'source-layer': 'building',
              filter: ['==', 'extrude', 'true'],
              type: 'fill-extrusion',
              minzoom: 12,
              paint: {
                'fill-extrusion-color': '#161622',
                'fill-extrusion-height': ['get', 'height'],
                'fill-extrusion-base': ['get', 'min_height'],
                'fill-extrusion-opacity': 0.7,
              },
            },
            labelLayer?.id,
          )
        } catch {
          // 3D buildings are cosmetic — don't fail if they can't load
        }
      })

      map.scrollZoom.enable()
      map.dragPan.enable()

      const ro = new ResizeObserver(() => {
        try { map.resize() } catch { /* ignore */ }
      })
      ro.observe(container)

      // Timeout: if map doesn't load within 15s, show error
      const loadTimeout = setTimeout(() => {
        if (!singletonLoaded) {
          setMapError('Map is taking too long to load. Check your connection and try again.')
        }
      }, 15000)

      return () => {
        clearTimeout(loadTimeout)
        ro.disconnect()
        mapRef.current = null
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      if (import.meta.env?.DEV) {
        console.error('[useMapInit] Failed to create map:', message)
      }
      setMapError('Could not load the map. Please try again.')
      return
    }
  }, [setMapInstance, mapError])

  return { containerRef, mapRef, mapReady: mapReadyKey > 0, mapError, retryMap }
}
