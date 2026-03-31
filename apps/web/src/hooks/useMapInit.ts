import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import type { MapInstance } from '@area-code/shared/types'

const MAPBOX_TOKEN = import.meta.env['VITE_MAPBOX_TOKEN'] as string | undefined

const DEFAULT_CENTER: [number, number] = [28.0473, -26.2041]
const DEFAULT_ZOOM = 13

// Module-level singleton so React StrictMode double-mount doesn't destroy the map.
// We also track which DOM node it was attached to.
let singletonMap: mapboxgl.Map | null = null
let singletonContainer: HTMLDivElement | null = null

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
 * Uses a module-level singleton to survive React StrictMode double-mount.
 */
export function useMapInit() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const setMapInstance = useMapStore((s) => s.setMapInstance)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    console.log('[useMapInit] Container found, dimensions:', container.offsetWidth, 'x', container.offsetHeight)

    // If singleton exists and is attached to this same DOM node, just restore refs
    if (singletonMap && singletonContainer === container) {
      console.log('[useMapInit] Reusing singleton map (StrictMode remount)')
      mapRef.current = singletonMap
      setMapInstance(buildMapInstance(singletonMap))
      requestAnimationFrame(() => singletonMap?.resize())
      return
    }

    // If singleton exists but container changed (shouldn't happen in normal flow),
    // destroy the old one
    if (singletonMap) {
      console.log('[useMapInit] Container changed, destroying old map')
      singletonMap.remove()
      singletonMap = null
      singletonContainer = null
    }

    if (!MAPBOX_TOKEN) {
      console.error('[useMapInit] VITE_MAPBOX_TOKEN is not set — map will not render.')
      return
    }

    console.log('[useMapInit] Creating new Mapbox map, token length:', MAPBOX_TOKEN.length)

    mapboxgl.accessToken = MAPBOX_TOKEN

    const map = new mapboxgl.Map({
      container,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: 45,
      bearing: -10,
    })

    map.on('load', () => {
      console.log('[useMapInit] Map loaded successfully')
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

    // Ensure map fills container once layout is settled
    map.once('style.load', () => map.resize())

    singletonMap = map
    singletonContainer = container
    mapRef.current = map
    setMapInstance(buildMapInstance(map))

    // ResizeObserver to handle container dimension changes
    const ro = new ResizeObserver(() => {
      map.resize()
    })
    ro.observe(container)

    return () => {
      ro.disconnect()
      // Do NOT call map.remove() — singleton survives StrictMode remount
    }
  }, [setMapInstance])

  return { containerRef, mapRef }
}
