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
      const flyOpts: Record<string, unknown> = { center: opts.center }
      if (opts.zoom !== undefined) flyOpts['zoom'] = opts.zoom
      map.flyTo(flyOpts as Parameters<typeof map.flyTo>[0])
    },
    setFeatureState: () => {},
    getZoom: () => map.getZoom(),
    getBounds: () => ({
      toArray: (): [[number, number], [number, number]] => {
        const b = map.getBounds()
        if (!b) return [[0, 0], [0, 0]]
        return [
          [b.getWest(), b.getSouth()],
          [b.getEast(), b.getNorth()],
        ]
      },
    }),
  }
}

/**
 * Initialises Mapbox GL JS once and persists across navigation.
 * mapRef is only set AFTER the map fires 'load', ensuring markers
 * added via useMapMarkers are properly geo-anchored.
 */
export function useMapInit() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const setMapInstance = useMapStore((s) => s.setMapInstance)
  // Force re-render when map becomes ready so useMapMarkers picks it up
  const [, setMapReady] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    console.log('[useMapInit] Container:', container.offsetWidth, 'x', container.offsetHeight)

    // Singleton already loaded and attached to same container
    if (singletonMap && singletonContainer === container && singletonLoaded) {
      console.log('[useMapInit] Reusing loaded singleton')
      mapRef.current = singletonMap
      setMapInstance(buildMapInstance(singletonMap))
      setMapReady(true)
      requestAnimationFrame(() => singletonMap?.resize())
      return
    }

    if (singletonMap) {
      singletonMap.remove()
      singletonMap = null
      singletonContainer = null
      singletonLoaded = false
    }

    if (!MAPBOX_TOKEN) {
      console.error('[useMapInit] VITE_MAPBOX_TOKEN is not set')
      return
    }

    console.log('[useMapInit] Creating map')
    mapboxgl.accessToken = MAPBOX_TOKEN

    const map = new mapboxgl.Map({
      container,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: 45,
      bearing: -10,
    })

    singletonMap = map
    singletonContainer = container

    // Only expose the map ref AFTER it's fully loaded
    map.on('load', () => {
      console.log('[useMapInit] Map loaded — markers can now be added')
      singletonLoaded = true
      mapRef.current = map
      setMapInstance(buildMapInstance(map))
      setMapReady(true)

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
    })

    map.scrollZoom.enable()
    map.dragPan.enable()

    const ro = new ResizeObserver(() => map.resize())
    ro.observe(container)

    return () => {
      ro.disconnect()
    }
  }, [setMapInstance])

  return { containerRef, mapRef }
}
