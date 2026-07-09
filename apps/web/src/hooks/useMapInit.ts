import { useTheme } from '@area-code/shared/hooks/useTheme'
import { useLocationStore } from '@area-code/shared/stores/locationStore'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import type { MapInstance } from '@area-code/shared/types'
// Type-only import: erased at build time so the Mapbox GL runtime is NOT pulled
// into the initial chunk. The runtime is loaded lazily via `loadMapboxGl()`
// inside the init effect below (Bundle_Budget R9.1).
import type mapboxgl from 'mapbox-gl'
import { useEffect, useRef, useState, useCallback } from 'react'

import { USER_VIEW_ZOOM } from '../lib/cameraControl'
import { cameraMotion } from '../lib/cameraEasing'
import { deviceTier } from '../lib/deviceTier'
import { loadMapboxGl } from '../lib/mapboxLoader'
import { PITCH_3D, PITCH_FLAT, MAX_PITCH, pitchForZoom, computeRampTarget } from '../lib/pitchRamp'

const MAPBOX_TOKEN = import.meta.env['VITE_MAPBOX_TOKEN'] as string | undefined

/**
 * Default camera: a full South-Africa overview. The map opens showing the
 * whole country and only zooms to the user's surroundings when they tap the
 * Recenter (locate) button - see `recenterUser` and `USER_VIEW_ZOOM`.
 */
const COUNTRY_CENTER: [number, number] = [25.0, -29.0]
const COUNTRY_ZOOM = 5

/** Fallback zoom for `getZoom()` if the live map read throws. */
const DEFAULT_ZOOM = 13
const BEARING_3D = -20

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
  /** Terrain DEM exaggeration - how hard real elevation lifts off the plane. */
  terrainExaggeration: number
  buildingColor: string
  /** Colour the tallest towers reach - the top of the height gradient. */
  buildingTopColor: string
  buildingOpacity: number
  /** Multiplies every building's real height for an exaggerated skyline. */
  buildingVerticalScale: number
  /** Self-illumination so towers glow against a dark map (0-1+). */
  buildingEmissiveStrength: number
  /** Contact-shadow darkening where walls meet the ground (0-1). */
  ambientOcclusionIntensity: number
  ambientOcclusionRadius: number
  /** Pooled light spilling from the base of each tower. */
  floodLightColor: string
  floodLightIntensity: number
  // Sky paint values map to mapbox-gl's sky layer paint props
  skyAtmosphereColor: string
  skyAtmosphereHaloColor: string
  skyAtmosphereSun: [number, number]
  skyAtmosphereSunIntensity: number
  /** Scene lights (ambient fill + a directional sun that casts real shadows). */
  ambientLightColor: string
  ambientLightIntensity: number
  directionalLightColor: string
  directionalLightIntensity: number
  /** [azimuthal 0-360, polar 0-90] - the sun's position in the sky. */
  directionalLightDirection: [number, number]
}

const ATMOSPHERE: Record<ThemeMode, AtmosphereConfig> = {
  dark: {
    fog: {
      color: '#0a0e16',
      'high-color': '#243049',
      'horizon-blend': 0.08,
      'space-color': '#03050a',
      'star-intensity': 0.8,
      range: [0.4, 14],
    },
    terrainExaggeration: 1.9,
    buildingColor: '#1c2536',
    buildingTopColor: '#3a4d78',
    buildingOpacity: 0.95,
    buildingVerticalScale: 1.45,
    // Towers read as dark mass with a subtle self-glow, not lit panels.
    buildingEmissiveStrength: 0.3,
    ambientOcclusionIntensity: 0.5,
    ambientOcclusionRadius: 3.5,
    floodLightColor: '#3d5a99',
    floodLightIntensity: 0.3,
    // Night sky: a dim slate dome (proven dark values), not a bright daytime
    // blue. The sun intensity drives most of the sky brightness, so it stays
    // low - a high value here was what washed dark mode out at country zoom.
    skyAtmosphereColor: 'rgba(85, 110, 145, 1)',
    skyAtmosphereHaloColor: 'rgba(150, 180, 210, 0.6)',
    skyAtmosphereSun: [25, 88],
    skyAtmosphereSunIntensity: 4,
    // Scene lights stay dim in dark mode: enough directional rake to keep the
    // skyline 3D, not enough to light the city up like day.
    ambientLightColor: '#9fb4d8',
    ambientLightIntensity: 0.4,
    directionalLightColor: '#dfe8ff',
    directionalLightIntensity: 0.6,
    directionalLightDirection: [215, 30],
  },
  light: {
    fog: {
      color: '#e6ecf2',
      'high-color': '#aebfd6',
      'horizon-blend': 0.1,
      'space-color': '#c2d2e6',
      'star-intensity': 0,
      range: [0.5, 16],
    },
    terrainExaggeration: 1.9,
    buildingColor: '#d8d2c8',
    buildingTopColor: '#f0e6d2',
    buildingOpacity: 0.97,
    buildingVerticalScale: 1.4,
    buildingEmissiveStrength: 0.1,
    ambientOcclusionIntensity: 0.45,
    ambientOcclusionRadius: 3.0,
    floodLightColor: '#fff1d6',
    floodLightIntensity: 0.25,
    skyAtmosphereColor: 'rgba(175, 200, 225, 1)',
    skyAtmosphereHaloColor: 'rgba(230, 240, 250, 0.9)',
    skyAtmosphereSun: [20, 78],
    skyAtmosphereSunIntensity: 12,
    ambientLightColor: '#fff6e8',
    ambientLightIntensity: 0.7,
    directionalLightColor: '#fff4e0',
    directionalLightIntensity: 1.0,
    directionalLightDirection: [200, 40],
  },
}

const TERRAIN_SOURCE_ID = 'mapbox-dem'
const SKY_LAYER_ID = 'sky-atmosphere'
const BUILDING_LAYER_ID = '3d-buildings'

/**
 * Mapbox GL renders its attribution and logo as real `<a>` links in the map
 * control corners. By default they are in the keyboard tab order, so a user
 * tabbing through the page lands on them and Enter navigates the whole app
 * away to mapbox.com - a focus trap that ejects keyboard users from the app.
 *
 * We pull these anchors out of the tab order (`tabindex="-1"`) while leaving
 * them visible and mouse-clickable, which keeps Mapbox attribution compliant
 * with their TOS. The attribution control re-renders its inner HTML whenever a
 * source's attribution changes, so we re-apply on every control-corner
 * mutation rather than once.
 */
function suppressCtrlLinkFocus(container: HTMLElement): void {
  container.querySelectorAll<HTMLAnchorElement>('.mapboxgl-ctrl a').forEach((a) => {
    a.setAttribute('tabindex', '-1')
  })
}

/**
 * Re-applies every custom layer/source we manage. Called on initial style
 * load and on every subsequent style swap (theme switch).
 *
 * This is the "4D" stack, layered for depth: real terrain relief, an
 * atmosphere dome + fog for aerial perspective, a directional sun that casts
 * genuine shadows across the city, and tall buildings carved by ambient
 * occlusion at their feet and flood-light glow at their base.
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
    // Low-tier devices use exaggeration 1.0 (flat terrain) to save GPU (Req 7.1).
    const exaggeration = deviceTier === 'high' ? cfg.terrainExaggeration : 1.0
    map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration })
  } catch {
    /* terrain is cosmetic - fail open */
  }

  // ── Scene lighting (ambient fill + directional sun) ──
  // A directional light with cast-shadows is what turns flat extrusions into
  // a city with real raking shadows - the single biggest "4D" upgrade. Ambient
  // light keeps the shadowed sides from going pure black.
  // Low-tier devices skip cast-shadows to stay within GPU budget (Req 7.1).
  try {
    const lights = [
      {
        id: 'ambient-light',
        type: 'ambient',
        properties: {
          color: cfg.ambientLightColor,
          intensity: cfg.ambientLightIntensity,
        },
      },
      {
        id: 'directional-light',
        type: 'directional',
        properties: {
          color: cfg.directionalLightColor,
          intensity: cfg.directionalLightIntensity,
          direction: cfg.directionalLightDirection,
          'cast-shadows': deviceTier === 'high',
          'shadow-intensity': deviceTier === 'high' ? 1 : 0,
        },
      },
    ]
    ;(map as unknown as { setLights: (l: unknown) => void }).setLights(lights)
  } catch {
    /* lighting is cosmetic - fail open on older renderers */
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
      map.setPaintProperty(SKY_LAYER_ID, 'sky-atmosphere-sun', cfg.skyAtmosphereSun)
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

  // ── 3D buildings: tall, glowing, AO-carved, flood-lit ──
  // Height is graded by floor count AND exaggerated via vertical-scale for a
  // dramatic skyline. Ambient occlusion darkens the wall/ground contact,
  // flood light pools warm/cool light at the base, emissive strength makes
  // towers self-glow against a dark map, and rounded roofs soften the tops.
  const buildingColorExpr = [
    'interpolate',
    ['linear'],
    ['get', 'height'],
    0,
    cfg.buildingColor,
    60,
    cfg.buildingColor,
    200,
    cfg.buildingTopColor,
  ]
  const buildingPaint = {
    'fill-extrusion-color': buildingColorExpr,
    'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 12, 0, 12.6, ['get', 'height']],
    'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 12, 0, 12.6, ['get', 'min_height']],
    'fill-extrusion-opacity': cfg.buildingOpacity,
    // Vertical gradient + emissive give the "4D" lift: bases stay grounded,
    // tops catch the light and glow.
    'fill-extrusion-vertical-gradient': true,
    'fill-extrusion-vertical-scale': cfg.buildingVerticalScale,
    'fill-extrusion-emissive-strength': cfg.buildingEmissiveStrength,
    'fill-extrusion-ambient-occlusion-intensity': cfg.ambientOcclusionIntensity,
    'fill-extrusion-ambient-occlusion-radius': cfg.ambientOcclusionRadius,
    'fill-extrusion-ambient-occlusion-ground-radius': cfg.ambientOcclusionRadius,
    'fill-extrusion-flood-light-color': cfg.floodLightColor,
    'fill-extrusion-flood-light-intensity': cfg.floodLightIntensity,
    'fill-extrusion-flood-light-ground-radius': 12,
    'fill-extrusion-flood-light-wall-radius': 12,
    'fill-extrusion-rounded-roof': true,
    // Low-tier devices skip per-extrusion cast shadows (Req 7.1).
    'fill-extrusion-cast-shadows': deviceTier === 'high',
  } as Record<string, unknown> as mapboxgl.FillExtrusionLayerSpecification['paint']

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
          // Lower minzoom so the skyline rises into view earlier on approach.
          minzoom: 11,
          paint: buildingPaint,
        },
        labelLayer?.id,
      )
    } else {
      // Re-apply the full enhanced paint set on theme swap.
      const setPaint = map.setPaintProperty.bind(map) as (id: string, prop: string, value: unknown) => void
      for (const [prop, value] of Object.entries(buildingPaint as Record<string, unknown>)) {
        try {
          setPaint(BUILDING_LAYER_ID, prop, value)
        } catch {
          /* property unsupported on this renderer - skip */
        }
      }
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
        if (opts.offset !== undefined) flyOpts['offset'] = opts.offset
        if (opts.duration !== undefined) flyOpts['duration'] = opts.duration
        if (opts.minZoom !== undefined) flyOpts['minZoom'] = opts.minZoom
        if (opts.easing !== undefined) flyOpts['easing'] = opts.easing
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
    getPitch: () => {
      try {
        return map.getPitch()
      } catch {
        return PITCH_FLAT
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
 * Initialises Mapbox GL JS for the lifetime of the MapScreen mount.
 *
 * MapScreen is kept mounted across tab switches in App.tsx (it is hidden with
 * `display:none`, not unmounted), so this map is created once and persists
 * while the user moves between tabs - no re-init flash on every navigation.
 * It is only torn down on a genuine unmount (logout / auth gate) or via
 * `retryMap`. This hook owns that lifecycle: it creates the map on mount and
 * fully removes it on unmount. (A previous module-level singleton tried to
 * persist the map across navigation, but because each remount got a brand-new
 * container DOM node the singleton could be left detached and the map would
 * "refuse to reopen". Keeping the component - and therefore its container -
 * mounted is the deterministic version of the same goal.)
 *
 * mapRef is only set AFTER the map fires 'load', ensuring markers added via
 * useMapMarkers are properly geo-anchored.
 *
 * Theme-aware: watches the resolved theme and swaps the basemap style, sky
 * tint, fog palette, and 3D building colour to match light or dark mode.
 *
 * Includes graceful error handling - if the map fails to load, mapError is set
 * so the UI can show a fallback instead of crashing.
 */
export function useMapInit() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  // Tracks the map's loaded() readiness without depending on mapbox internals.
  const loadedRef = useRef(false)
  // The basemap theme currently applied to mapRef.current. Lets the theme-sync
  // effect avoid redundant setStyle() calls.
  const themeRef = useRef<ThemeMode | null>(null)
  const setMapInstance = useMapStore((s) => s.setMapInstance)
  // Subscribe to the resolved theme directly so the init effect seeds the
  // correct initial style and the theme-sync effect can react to flips.
  const { resolved } = useTheme()
  // Increment counter when map becomes ready. More reliable than a boolean
  // that can flip during React strict-mode remounts.
  const [mapReadyKey, setMapReadyKey] = useState(0)
  const [mapError, setMapError] = useState<string | null>(null)
  const [is3D, setIs3D] = useState(true)
  const [bearing, setBearing] = useState(BEARING_3D)
  // Live mirror of `is3D` for the zoom handler (which closes over its initial
  // value). When flat, the zoom-driven pitch ramp is suspended.
  const is3DRef = useRef(is3D)
  is3DRef.current = is3D
  // True while the user is mid two-finger pitch gesture, so the auto pitch
  // ramp does not fight a deliberate manual tilt.
  const manualPitchRef = useRef(false)
  // Sticky offset (degrees) between the user's manually chosen pitch and the
  // ramp's value at that zoom, captured when a manual tilt gesture ends. The
  // ramp preserves this offset on later zooms instead of snapping the camera
  // back to the ramp value - a two-finger tilt to the horizon survives the
  // next pinch or wheel zoom. Reset by the 3D toggle (a deliberate re-baseline).
  const manualPitchOffsetRef = useRef(0)

  /**
   * No-op retained for MapControls API compatibility (drift removed).
   */
  const pauseIdleDrift = useCallback((ms: number) => {
    void ms
  }, [])

  const setPitch3D = useCallback((on: boolean) => {
    setIs3D(on)
    // A deliberate mode toggle re-baselines the camera: drop any sticky manual
    // tilt so the ramp owns the pitch again.
    manualPitchOffsetRef.current = 0
    const map = mapRef.current
    if (!map) return
    try {
      // When re-enabling 3D, tilt to the pitch that matches the current zoom
      // (street-level if zoomed in, overview if far out) rather than a fixed
      // angle, so the toggle is consistent with the zoom-driven ramp.
      let targetPitch = PITCH_3D
      try {
        targetPitch = pitchForZoom(map.getZoom())
      } catch {
        /* fall back to overview pitch */
      }
      map.easeTo({
        pitch: on ? targetPitch : PITCH_FLAT,
        bearing: on ? BEARING_3D : 0,
        ...cameraMotion(800),
      })
    } catch {
      /* ignore */
    }
  }, [])

  /**
   * Snap the bearing back to north when the user taps Compass_Button.
   *
   * Reads through `mapRef.current` so a teardown-recreate cycle via `retryMap`
   * wires the latest map instance (Live Vibe on Map R1.1).
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
      map.easeTo({ bearing: 0, ...cameraMotion(600) })
    } catch {
      /* ignore */
    }
  }, [])

  /**
   * Fly the map to the consumer's Last_Known_Position when the user taps
   * Recenter_Button, zooming to roughly a 20 km radius (`USER_VIEW_ZOOM`).
   *
   * Reads through `mapRef.current` (R1.1) and gates on the position's
   * freshness via `Date.now() - capturedAt <= 60000` (R1.3) so a stale fix
   * does not pull the map to where the user no longer is.
   *
   * Early-out branches:
   *   - Map ref absent or not yet `loaded()`: silent debug log, no throw (R1.6).
   *   - No `lastKnownPosition` or `capturedAt`: silent no-op.
   *   - Position older than 60s: silent no-op (R1.4).
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
      map.flyTo({
        center: [pos.lng, pos.lat],
        zoom: USER_VIEW_ZOOM,
        ...cameraMotion(1000),
      })
    } catch {
      /* ignore */
    }
  }, [])

  const retryMap = useCallback(() => {
    // Force cleanup and re-init. The init effect re-runs when mapError flips
    // back to null and recreates the map against the live container.
    if (mapRef.current) {
      try {
        mapRef.current.remove()
      } catch {
        /* already removed */
      }
      mapRef.current = null
    }
    loadedRef.current = false
    setMapError(null)
    setMapReadyKey(0)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // If there's an error state, don't try to init (wait for retry).
    if (mapError) return

    // A live map already exists for this mount (e.g. an unexpected effect
    // re-run that isn't an error transition) - nothing to do.
    if (mapRef.current) return

    if (!MAPBOX_TOKEN) {
      setMapError('Map configuration missing. Please try again later.')
      return
    }

    const initialTheme: ThemeMode = resolved
    themeRef.current = initialTheme

    // Created once the Mapbox runtime resolves. The cleanup closure reads these,
    // so they live in the effect scope rather than the async callback.
    let createdMap: mapboxgl.Map | null = null
    let cancelled = false
    let ro: ResizeObserver | null = null
    let ctrlObserver: MutationObserver | null = null

    // Start the load timeout BEFORE the dynamic import so a slow module fetch on
    // a poor connection surfaces the same "taking too long" error as a slow map
    // load. The only user-visible change on a slow load is the existing loading
    // spinner showing a moment longer while the Mapbox chunk downloads (R9.1).
    const loadTimeout = setTimeout(() => {
      if (!loadedRef.current) {
        setMapError('Map is taking too long to load. Check your connection and try again.')
      }
    }, 15000)

    // Load Mapbox GL JS lazily so its large runtime is split out of the initial
    // JS chunk (Bundle_Budget R9.1). The map screen shows its existing loading
    // state until the module resolves and the map fires 'load'.
    loadMapboxGl()
      .then((gl) => {
        // The effect was torn down (unmount / retry / error), the container
        // detached, or another path already built the map while the module was
        // loading - abort so we never leak a second map.
        if (cancelled || !containerRef.current || mapRef.current) return

        let created: mapboxgl.Map
        try {
          gl.accessToken = MAPBOX_TOKEN

          created = new gl.Map({
            container,
            style: STYLE_URL[initialTheme],
            // Open on a full-country overview; the user zooms in via Recenter.
            center: COUNTRY_CENTER,
            zoom: COUNTRY_ZOOM,
            pitch: PITCH_3D,
            bearing: BEARING_3D,
            // Low-tier devices skip antialias to stay within GPU budget (Req 7.1).
            antialias: deviceTier === 'high',
            failIfMajorPerformanceCaveat: false,
            // Globe projection uses spherical math for marker screen-coordinate
            // projection. Without this, the implicit mercator projection at very
            // low zoom + high pitch produces incorrect screen positions, causing
            // markers to detach from the globe surface (mapbox-gl issue #12592).
            projection: 'globe' as unknown as mapboxgl.ProjectionSpecification,
            // Prevent zooming out past a meaningful regional overview.
            minZoom: 4,
            // Allow the zoom-driven pitch ramp to reach near-ground street level.
            maxPitch: MAX_PITCH,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error'
          if (import.meta.env?.DEV) {
            console.error('[useMapInit] Failed to create map:', message)
          }
          setMapError('Could not load the map. Please try again.')
          return
        }

        // Const binding so the event-handler closures below see a non-null map
        // (a reassignable `let` would not narrow inside nested callbacks).
        const map = created
        createdMap = map

        // Track bearing changes so the compass UI reflects reality. Quantised to
        // whole degrees: 'rotate' fires every frame of a rotate gesture, and a raw
        // setBearing re-rendered the entire MapScreen tree per frame. The compass
        // icon cannot show sub-degree rotation anyway.
        map.on('rotate', () => {
          try {
            const rounded = Math.round(map.getBearing())
            setBearing((prev) => (prev === rounded ? prev : rounded))
          } catch {
            /* ignore */
          }
        })

        // ── Street-level immersion: zoom-driven pitch ramp ──
        // After each zoom settles, ease the camera toward the pitch that matches
        // the new zoom, so diving into a venue feels like dropping to where you'd
        // be standing. Two invariants:
        //   1. Applied on 'zoomend' via easeTo, never per 'zoom' frame via
        //      setPitch. setPitch is jumpTo under the hood: it stops any in-flight
        //      camera animation, so a per-frame ramp aborted wheel-zoom easing and
        //      selection fly-tos mid-flight (the same bug class map-carousel.md
        //      records for setBearing) and made zooming feel stuttery.
        //   2. The target honours the sticky manual offset, so a deliberate
        //      two-finger tilt is preserved across later zooms instead of the view
        //      snapping back to the ramp value.
        // Suspended in flat mode and while the user is manually pitching.
        const applyZoomPitch = () => {
          if (!is3DRef.current || manualPitchRef.current) return
          try {
            const target = computeRampTarget(map.getZoom(), manualPitchOffsetRef.current)
            if (Math.abs(map.getPitch() - target) > 1) {
              map.easeTo({ pitch: target, ...cameraMotion(450) })
            }
          } catch {
            /* pitch is cosmetic - fail open */
          }
        }
        map.on('zoomend', applyZoomPitch)
        // Only a real user gesture carries originalEvent; our own easeTo does not.
        // Flag manual pitch so the ramp yields to a deliberate two-finger tilt.
        map.on('pitchstart', (e) => {
          if ((e as { originalEvent?: unknown }).originalEvent) manualPitchRef.current = true
        })
        map.on('pitchend', () => {
          // Capture the offset a manual tilt chose (relative to the ramp at the
          // current zoom) so later zooms preserve the user's intent.
          if (manualPitchRef.current) {
            try {
              manualPitchOffsetRef.current = map.getPitch() - pitchForZoom(map.getZoom())
            } catch {
              /* keep the previous offset */
            }
          }
          manualPitchRef.current = false
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

        // style.load fires both on initial style load AND every time setStyle()
        // swaps the basemap (e.g. dark↔light theme switch). Re-apply terrain,
        // sky, fog, and 3D buildings every time.
        map.on('style.load', () => {
          applyCustomLayers(map, themeRef.current ?? 'dark')
          suppressCtrlLinkFocus(container)
        })

        // Keep Mapbox's attribution/logo links out of the keyboard tab order.
        // Observe only the control corners (not the whole container) so the
        // frequent marker DOM churn from socket updates never triggers this.
        const ctrlEl: HTMLElement = container!
        // Const binding so the nested forEach closure sees a non-null observer
        // (the outer `let` would not narrow inside the callback).
        const obs = new MutationObserver(() => suppressCtrlLinkFocus(ctrlEl))
        ctrlObserver = obs
        const watchCtrlCorners = () => {
          suppressCtrlLinkFocus(ctrlEl)
          ctrlEl
            .querySelectorAll(
              '.mapboxgl-ctrl-bottom-left, .mapboxgl-ctrl-bottom-right, .mapboxgl-ctrl-top-right, .mapboxgl-ctrl-top-left',
            )
            .forEach((corner) => obs.observe(corner, { childList: true, subtree: true }))
        }
        watchCtrlCorners()

        // Only expose the map ref AFTER it's fully loaded.
        map.on('load', () => {
          loadedRef.current = true
          mapRef.current = map
          setMapInstance(buildMapInstance(map))
          setMapReadyKey((k) => k + 1)
          suppressCtrlLinkFocus(container)
        })

        map.scrollZoom.enable()
        map.dragPan.enable()
        map.touchZoomRotate.enableRotation()

        ro = new ResizeObserver(() => {
          try {
            map.resize()
          } catch {
            /* ignore */
          }
        })
        ro.observe(container)
      })
      .catch((err) => {
        // The module itself failed to load (offline, chunk fetch error). Surface
        // the same graceful fallback the map screen already renders (R9.1).
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Unknown error'
        if (import.meta.env?.DEV) {
          console.error('[useMapInit] Failed to load Mapbox GL:', message)
        }
        setMapError('Could not load the map. Please try again.')
      })

    return () => {
      cancelled = true
      clearTimeout(loadTimeout)
      ro?.disconnect()
      ctrlObserver?.disconnect()
      // Fully tear down the map on unmount so a stale, detached instance can
      // never block re-initialisation when the Map tab is reopened.
      try {
        createdMap?.remove()
      } catch {
        /* already removed */
      }
      if (createdMap && mapRef.current === createdMap) mapRef.current = null
      loadedRef.current = false
      themeRef.current = null
    }
    // `resolved` is intentionally omitted from deps. The init effect reads it
    // to seed the initial style URL, but theme changes after init are handled
    // by the dedicated theme-sync effect below via setStyle(). Including it
    // here would re-create the entire map on every theme flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setMapInstance, mapError])

  // ── Reactive theme sync ──
  // Whenever the resolved theme flips (SAST 06:00 transition, user toggle, or
  // the auto path re-evaluating), swap the basemap style. The `style.load`
  // listener re-applies terrain, sky, fog, and 3D buildings on every swap.
  // Markers are HTML elements anchored to lng/lat, so they survive untouched.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (themeRef.current === resolved) return
    themeRef.current = resolved
    try {
      // diff: false forces a clean reload so terrain re-binds reliably.
      map.setStyle(STYLE_URL[resolved], { diff: false } as Parameters<typeof map.setStyle>[1])
    } catch {
      /* ignore - style.load handler will re-apply layers next time */
    }
  }, [resolved, mapReadyKey])

  // Idle bearing drift removed - continuous rotation caused dizziness.

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
