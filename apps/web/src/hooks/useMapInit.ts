import { useLocationStore } from '@area-code/shared/stores/locationStore'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import type { MapInstance } from '@area-code/shared/types'
import mapboxgl from 'mapbox-gl'
import { useEffect, useRef, useState, useCallback } from 'react'

const MAPBOX_TOKEN = import.meta.env['VITE_MAPBOX_TOKEN'] as string | undefined

const DEFAULT_CENTER: [number, number] = [28.0473, -26.2041]
const DEFAULT_ZOOM = 13
const PITCH_3D = 55
const PITCH_FLAT = 0
const BEARING_3D = -17

type ThemeMode = 'light' | 'dark'

const STYLE_URL: Record<ThemeMode, string> = {
  dark: 'mapbox://styles/mapbox/dark-v11',
  light: 'mapbox://styles/mapbox/light-v11',
}

interface AtmosphereConfig {
  fog: {
    color: string
    'high-color': string
    'horizon-blend': number
    'space-color': string
    'star-intensity': number
    range: [number, number]
  }
  buildingColor: string
  buildingOpacity: number
  // Sky paint values map to mapbox-gl's sky layer paint props
  skyAtmosphereColor: string
  skyAtmosphereHaloColor: string
  skyAtmosphereSun: [number, number]
  skyAtmosphereSunIntensity: number
}

const ATMOSPHERE: Record<ThemeMode, AtmosphereConfig> = {
  dark: {
    fog: {
      color: '#0c1018',
      'high-color': '#1a2030',
      'horizon-blend': 0.04,
      'space-color': '#05070b',
      'star-intensity': 0.5,
      range: [0.5, 12],
    },
    buildingColor: '#1c2536',
    buildingOpacity: 0.78,
    skyAtmosphereColor: 'rgba(85, 110, 145, 1)',
    skyAtmosphereHaloColor: 'rgba(169, 203, 224, 0.7)',
    skyAtmosphereSun: [0, 90],
    skyAtmosphereSunIntensity: 4,
  },
  light: {
    fog: {
      color: '#e6ecf2',
      'high-color': '#bccadb',
      'horizon-blend': 0.06,
      'space-color': '#cdd9e7',
      'star-intensity': 0,
      range: [0.6, 14],
    },
    buildingColor: '#d8d2c8',
    buildingOpacity: 0.92,
    skyAtmosphereColor: 'rgba(180, 200, 220, 1)',
    skyAtmosphereHaloColor: 'rgba(220, 230, 240, 0.8)',
    skyAtmosphereSun: [0, 80],
    skyAtmosphereSunIntensity: 8,
  },
}

const TERRAIN_SOURCE_ID = 'mapbox-dem'
const SKY_LAYER_ID = 'sky-atmosphere'
const BUILDING_LAYER_ID = '3d-buildings'

let singletonMap: mapboxgl.Map | null = null
let singletonContainer: HTMLDivElement | null = null
let singletonLoaded = false
let singletonStyleTheme: ThemeMode | null = null

function readDocumentTheme(): ThemeMode {
  if (typeof document === 'undefined') return 'dark'
  const t = document.documentElement.getAttribute('data-theme')
  return t === 'light' ? 'light' : 'dark'
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Re-applies every custom layer/source we manage. Called on initial style
 * load and on every subsequent style swap (theme switch).
 */
function applyCustomLayers(map: mapboxgl.Map, theme: ThemeMode): void {
  const cfg = ATMOSPHERE[theme]

  // ── Terrain DEM source ──
  // Adds real elevation so mountains & valleys lift off the map plane.
  try {
    if (!map.getSource(TERRAIN_SOURCE_ID)) {
      map.addSource(TERRAIN_SOURCE_ID, {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      })
    }
    map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.4 })
  } catch {
    /* terrain is cosmetic — fail open */
  }

  // ── Sky atmosphere layer ──
  // Gives the horizon real depth: a tinted dome of sky behind buildings.
  try {
    if (!map.getLayer(SKY_LAYER_ID)) {
      map.addLayer({
        id: SKY_LAYER_ID,
        type: 'sky',
        paint: {
          'sky-type': 'atmosphere',
          'sky-atmosphere-color': cfg.skyAtmosphereColor,
          'sky-atmosphere-halo-color': cfg.skyAtmosphereHaloColor,
          'sky-atmosphere-sun': cfg.skyAtmosphereSun,
          'sky-atmosphere-sun-intensity': cfg.skyAtmosphereSunIntensity,
        } as Record<string, unknown> as mapboxgl.SkyLayerSpecification['paint'],
      })
    } else {
      map.setPaintProperty(SKY_LAYER_ID, 'sky-atmosphere-color', cfg.skyAtmosphereColor)
      map.setPaintProperty(SKY_LAYER_ID, 'sky-atmosphere-halo-color', cfg.skyAtmosphereHaloColor)
      map.setPaintProperty(SKY_LAYER_ID, 'sky-atmosphere-sun-intensity', cfg.skyAtmosphereSunIntensity)
    }
  } catch {
    /* sky is cosmetic */
  }

  // ── Atmospheric fog ──
  // Pulls the horizon back, deepens the perspective.
  try {
    map.setFog(cfg.fog as unknown as mapboxgl.FogSpecification)
  } catch {
    /* fog is cosmetic */
  }

  // ── 3D buildings, height-graded by floor count for a layered city feel ──
  try {
    const layers = map.getStyle().layers
    const labelLayer = layers?.find((l) => l.type === 'symbol' && l.layout?.['text-field'])

    if (!map.getLayer(BUILDING_LAYER_ID)) {
      map.addLayer(
        {
          id: BUILDING_LAYER_ID,
          source: 'composite',
          'source-layer': 'building',
          filter: ['==', 'extrude', 'true'],
          type: 'fill-extrusion',
          minzoom: 12,
          paint: {
            // Color graduates with height so taller buildings stand out
            'fill-extrusion-color': [
              'interpolate',
              ['linear'],
              ['get', 'height'],
              0,
              cfg.buildingColor,
              60,
              cfg.buildingColor,
              200,
              theme === 'dark' ? '#2a3650' : '#cdb89d',
            ],
            'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 13.5, ['get', 'height']],
            'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 13, 0, 13.5, ['get', 'min_height']],
            'fill-extrusion-opacity': cfg.buildingOpacity,
            // Vertical gradient adds the "4D" lift: bases stay grounded,
            // tops catch a hint of light.
            'fill-extrusion-vertical-gradient': true,
          },
        },
        labelLayer?.id,
      )
    } else {
      map.setPaintProperty(BUILDING_LAYER_ID, 'fill-extrusion-color', [
        'interpolate',
        ['linear'],
        ['get', 'height'],
        0,
        cfg.buildingColor,
        60,
        cfg.buildingColor,
        200,
        theme === 'dark' ? '#2a3650' : '#cdb89d',
      ])
      map.setPaintProperty(BUILDING_LAYER_ID, 'fill-extrusion-opacity', cfg.buildingOpacity)
    }
  } catch {
    /* extrusions are cosmetic */
  }
}

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
      try {
        return map.getZoom()
      } catch {
        return DEFAULT_ZOOM
      }
    },
    getBounds: () => ({
      toArray: (): [[number, number], [number, number]] => {
        try {
          const b = map.getBounds()
          if (!b)
            return [
              [0, 0],
              [0, 0],
            ]
          return [
            [b.getWest(), b.getSouth()],
            [b.getEast(), b.getNorth()],
          ]
        } catch {
          return [
            [0, 0],
            [0, 0],
          ]
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
 * Theme-aware: watches `data-theme` on <html> and swaps the basemap style,
 * sky tint, fog palette, and 3D building colour to match light or dark mode.
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
  const [is3D, setIs3D] = useState(true)
  const [bearing, setBearing] = useState(BEARING_3D)
  const driftRafRef = useRef<number | null>(null)

  const setPitch3D = useCallback((on: boolean) => {
    setIs3D(on)
    const map = singletonMap
    if (!map) return
    try {
      map.easeTo({
        pitch: on ? PITCH_3D : PITCH_FLAT,
        bearing: on ? BEARING_3D : 0,
        duration: 800,
      })
    } catch {
      /* ignore */
    }
  }, [])

  const resetNorth = useCallback(() => {
    const map = singletonMap
    if (!map) return
    try {
      map.easeTo({ bearing: 0, duration: 600 })
    } catch {
      /* ignore */
    }
  }, [])

  const recenterUser = useCallback(() => {
    const map = singletonMap
    if (!map) return
    const pos = useLocationStore.getState().lastKnownPosition
    if (!pos) return
    try {
      map.flyTo({ center: [pos.lng, pos.lat], zoom: DEFAULT_ZOOM, duration: 1000 })
    } catch {
      /* ignore */
    }
  }, [])

  const retryMap = useCallback(() => {
    // Force cleanup and re-init
    if (singletonMap) {
      try {
        singletonMap.remove()
      } catch {
        /* already removed */
      }
      singletonMap = null
      singletonContainer = null
      singletonLoaded = false
      singletonStyleTheme = null
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
        try {
          singletonMap?.resize()
        } catch {
          /* ignore */
        }
      })
      return
    }

    if (singletonMap) {
      try {
        singletonMap.remove()
      } catch {
        /* already removed */
      }
      singletonMap = null
      singletonContainer = null
      singletonLoaded = false
      singletonStyleTheme = null
    }

    if (!MAPBOX_TOKEN) {
      setMapError('Map configuration missing. Please try again later.')
      return
    }

    const initialTheme = readDocumentTheme()

    try {
      mapboxgl.accessToken = MAPBOX_TOKEN

      const map = new mapboxgl.Map({
        container,
        style: STYLE_URL[initialTheme],
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        pitch: PITCH_3D,
        bearing: BEARING_3D,
        antialias: true,
        failIfMajorPerformanceCaveat: false,
      })

      singletonMap = map
      singletonContainer = container
      singletonStyleTheme = initialTheme

      // Track bearing changes so the compass UI reflects reality.
      map.on('rotate', () => {
        try {
          setBearing(map.getBearing())
        } catch {
          /* ignore */
        }
      })

      // Handle map errors gracefully
      map.on('error', (e) => {
        const msg = e.error?.message ?? ''
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
          return
        }
        if (import.meta.env?.DEV) {
          console.warn('[useMapInit] Map error:', e.error)
        }
      })

      // style.load fires both on initial style load AND every time
      // setStyle() swaps the basemap (e.g. dark↔light theme switch).
      // We re-apply terrain, sky, fog, and 3D buildings every time.
      map.on('style.load', () => {
        const theme = singletonStyleTheme ?? readDocumentTheme()
        applyCustomLayers(map, theme)
      })

      // Only expose the map ref AFTER it's fully loaded
      map.on('load', () => {
        singletonLoaded = true
        mapRef.current = map
        setMapInstance(buildMapInstance(map))
        setMapReadyKey((k) => k + 1)
      })

      map.scrollZoom.enable()
      map.dragPan.enable()
      map.touchZoomRotate.enableRotation()

      const ro = new ResizeObserver(() => {
        try {
          map.resize()
        } catch {
          /* ignore */
        }
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

  // ── Theme observer ──
  // Watch <html data-theme="..."> and swap the basemap when it changes.
  // Markers are HTML elements, so they survive style swaps untouched.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement

    const swapStyle = () => {
      const map = singletonMap
      if (!map) return
      const next = readDocumentTheme()
      if (singletonStyleTheme === next) return
      singletonStyleTheme = next
      try {
        // diff: false forces a clean reload so terrain re-binds reliably.
        // Cast because mapbox-gl's declared SetStyleOptions marks fields
        // as required even though the runtime accepts a partial object.
        map.setStyle(STYLE_URL[next], { diff: false } as Parameters<typeof map.setStyle>[1])
      } catch {
        /* ignore — style.load handler will re-apply layers next time */
      }
    }

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'data-theme') {
          swapStyle()
          return
        }
      }
    })
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })

    return () => observer.disconnect()
  }, [])

  // ── Idle bearing drift ──
  // A near-imperceptible rotation (≈ 0.3°/sec) while the user is idle.
  // Mission-aligned: the city is alive, even when the user is still.
  // Pauses on user interaction and respects prefers-reduced-motion.
  useEffect(() => {
    if (!singletonLoaded || !is3D) return
    if (prefersReducedMotion()) return

    let lastTime = performance.now()
    let interacting = false
    let interactionTimer: ReturnType<typeof setTimeout> | null = null

    const map = singletonMap
    if (!map) return

    const markInteraction = () => {
      interacting = true
      if (interactionTimer) clearTimeout(interactionTimer)
      // Resume drift 4s after the last interaction
      interactionTimer = setTimeout(() => {
        interacting = false
      }, 4000)
    }

    map.on('mousedown', markInteraction)
    map.on('touchstart', markInteraction)
    map.on('wheel', markInteraction)

    const tick = (now: number) => {
      const delta = now - lastTime
      lastTime = now

      if (!interacting && singletonMap === map) {
        try {
          const current = map.getBearing()
          // 0.3 degrees per second, wraps cleanly through 360
          const next = (((current + (0.3 * delta) / 1000) % 360) + 360) % 360
          map.setBearing(next > 180 ? next - 360 : next)
        } catch {
          /* ignore */
        }
      }

      driftRafRef.current = requestAnimationFrame(tick)
    }

    driftRafRef.current = requestAnimationFrame(tick)

    return () => {
      if (driftRafRef.current !== null) {
        cancelAnimationFrame(driftRafRef.current)
        driftRafRef.current = null
      }
      if (interactionTimer) clearTimeout(interactionTimer)
      try {
        map.off('mousedown', markInteraction)
        map.off('touchstart', markInteraction)
        map.off('wheel', markInteraction)
      } catch {
        /* ignore */
      }
    }
  }, [is3D, mapReadyKey])

  return {
    containerRef,
    mapRef,
    mapReady: mapReadyKey > 0,
    mapError,
    retryMap,
    is3D,
    setPitch3D,
    bearing,
    resetNorth,
    recenterUser,
  }
}
