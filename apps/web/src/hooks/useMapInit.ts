import { useTheme } from '@area-code/shared/hooks/useTheme'
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
  // Subscribe to the resolved theme directly. Using useTheme() (rather than
  // reading data-theme off the DOM) is important because:
  //   1. data-theme isn't applied until useTheme()'s effect runs, which
  //      may be AFTER this hook's init effect on first paint, leaving the
  //      map locked to the dark default.
  //   2. A reactive value lets us key the style-swap effect on it directly,
  //      no MutationObserver gymnastics.
  const { resolved } = useTheme()
  // Increment counter when map becomes ready. This is more reliable than a
  // boolean that can flip false→true→false during React strict-mode remounts.
  const [mapReadyKey, setMapReadyKey] = useState(0)
  const [mapError, setMapError] = useState<string | null>(null)
  const [is3D, setIs3D] = useState(true)
  const [bearing, setBearing] = useState(BEARING_3D)
  const driftRafRef = useRef<number | null>(null)
  /**
   * Timestamp (Date.now()) until which the idle bearing-drift should remain
   * paused. The drift `tick` reads this on every frame, and `pauseIdleDrift`
   * (plus the existing mousedown/touchstart/wheel handlers) extends it.
   *
   * R1.5 requires at least 4000ms of pause after a Compass/Recenter tap, so
   * callers pass `pauseIdleDrift(4000)`.
   */
  const driftPausedUntilRef = useRef<number>(0)

  /**
   * Pause idle bearing-drift for at least `ms` milliseconds.
   *
   * Used by Map_Sidebar (R1.5) so that a compass or recenter tap doesn't
   * have the city slowly counter-rotating against the user's intent for the
   * next animation frame. Idempotent and monotonic: calling it with a
   * smaller `ms` while a longer pause is already pending is a no-op.
   */
  const pauseIdleDrift = useCallback((ms: number) => {
    const until = Date.now() + Math.max(0, ms)
    if (until > driftPausedUntilRef.current) {
      driftPausedUntilRef.current = until
    }
  }, [])

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

  /**
   * Snap the bearing back to north when the user taps Compass_Button.
   *
   * Reads through `mapRef.current` (not the module-level `singletonMap`) so a
   * teardown-recreate cycle via `retryMap` wires the latest map instance
   * (Live Vibe on Map R1.1, design "Frontend: R1 sidebar correctness").
   *
   * Early-out branches:
   *   - Map ref absent or not yet `loaded()`: silent debug log, no throw (R1.6).
   *   - Bearing already within ±1° of north: no-op, no animation, no error (R1.2).
   */
  const resetNorth = useCallback(() => {
    const map = mapRef.current
    if (!map || !map.loaded()) {
      if (import.meta.env?.DEV) {
        console.debug('[useMapInit] resetNorth ignored: map not loaded')
      }
      return
    }
    try {
      const current = map.getBearing()
      // R1.2: within ±1° of north (0°) is a successful no-op. Compute the
      // shortest signed angular distance from `current` to 0, robust to any
      // bearing magnitude mapbox-gl might return.
      const delta = Math.abs(((((current + 180) % 360) + 360) % 360) - 180)
      if (delta <= 1) {
        return
      }
      map.easeTo({ bearing: 0, duration: 600 })
    } catch {
      /* ignore */
    }
  }, [])

  /**
   * Fly the map to the consumer's Last_Known_Position when the user taps
   * Recenter_Button.
   *
   * Reads through `mapRef.current` (R1.1) and gates on the position's
   * freshness via `Date.now() - capturedAt <= 60000` (R1.3) so a stale fix
   * does not pull the map to where the user no longer is.
   *
   * Early-out branches:
   *   - Map ref absent or not yet `loaded()`: silent debug log, no throw (R1.6).
   *   - No `lastKnownPosition` or `capturedAt`: silent no-op.
   *   - Position older than 60s: silent no-op (the button itself renders
   *     disabled in this state per R1.4, but the callback also enforces).
   */
  const recenterUser = useCallback(() => {
    const map = mapRef.current
    if (!map || !map.loaded()) {
      if (import.meta.env?.DEV) {
        console.debug('[useMapInit] recenterUser ignored: map not loaded')
      }
      return
    }
    const { lastKnownPosition: pos, capturedAt } = useLocationStore.getState()
    if (!pos || !capturedAt) return
    if (Date.now() - capturedAt > 60_000) return
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

    const initialTheme: ThemeMode = resolved

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
        const theme = singletonStyleTheme ?? 'dark'
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
    // `resolved` is intentionally omitted from deps. The init effect reads
    // it to seed the initial style URL, but theme changes after init are
    // handled by the dedicated theme-sync effect below via setStyle().
    // Including it here would re-create the entire map on every theme flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setMapInstance, mapError])

  // ── Reactive theme sync ──
  // Whenever the resolved theme flips (e.g. SAST 06:00 transition,
  // user toggles mode in profile, or the auto path re-evaluates),
  // swap the basemap style. The `style.load` listener installed above
  // re-applies terrain, sky, fog, and 3D buildings on every swap.
  // Markers are HTML elements anchored to lng/lat, so they survive untouched.
  useEffect(() => {
    const map = singletonMap
    if (!map) return
    if (singletonStyleTheme === resolved) return
    singletonStyleTheme = resolved
    try {
      // diff: false forces a clean reload so terrain re-binds reliably.
      // Cast because mapbox-gl's declared SetStyleOptions marks fields
      // as required even though the runtime accepts a partial object.
      map.setStyle(STYLE_URL[resolved], { diff: false } as Parameters<typeof map.setStyle>[1])
    } catch {
      /* ignore — style.load handler will re-apply layers next time */
    }
  }, [resolved, mapReadyKey])

  // ── Idle bearing drift ──
  // A near-imperceptible rotation (≈ 0.3°/sec) while the user is idle.
  // Mission-aligned: the city is alive, even when the user is still.
  // Pauses on user interaction and respects prefers-reduced-motion.
  //
  // The pause is shared with `pauseIdleDrift(ms)` (R1.5) via
  // `driftPausedUntilRef`, so a Compass/Recenter tap can extend the pause
  // independently of the mousedown/touchstart/wheel handlers below.
  useEffect(() => {
    if (!singletonLoaded || !is3D) return
    if (prefersReducedMotion()) return

    let lastTime = performance.now()
    let interactionTimer: ReturnType<typeof setTimeout> | null = null

    const map = singletonMap
    if (!map) return

    const markInteraction = () => {
      // Resume drift 4s after the last interaction.
      driftPausedUntilRef.current = Date.now() + 4000
      if (interactionTimer) clearTimeout(interactionTimer)
      interactionTimer = setTimeout(() => {
        // No-op timer: kept so we still clear it on cleanup. The drift loop
        // checks `driftPausedUntilRef` directly each frame.
      }, 4000)
    }

    map.on('mousedown', markInteraction)
    map.on('touchstart', markInteraction)
    map.on('wheel', markInteraction)

    const tick = (now: number) => {
      const delta = now - lastTime
      lastTime = now

      const paused = Date.now() < driftPausedUntilRef.current
      if (!paused && singletonMap === map) {
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
    pauseIdleDrift,
  }
}
