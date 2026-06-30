import { useTheme } from '@area-code/shared/hooks/useTheme'
import { useLocationStore } from '@area-code/shared/stores/locationStore'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import type { MapInstance } from '@area-code/shared/types'
import mapboxgl from 'mapbox-gl'
import { useEffect, useRef, useState, useCallback } from 'react'

const MAPBOX_TOKEN = import.meta.env['VITE_MAPBOX_TOKEN'] as string | undefined

/**
 * Default camera: a full South-Africa overview. The map opens showing the
 * whole country and only zooms to the user's surroundings when they tap the
 * Recenter (locate) button - see `recenterUser` and `USER_VIEW_ZOOM`.
 */
const COUNTRY_CENTER: [number, number] = [25.0, -29.0]
const COUNTRY_ZOOM = 5

/**
 * Zoom the Recenter button flies to: roughly a 20 km radius around the user on
 * a typical phone viewport. (At ~zoom 10 and mid-SA latitude one screen width
 * spans ~40-50 km, i.e. a ~20-25 km radius.) Kept as a zoom level rather than
 * a `fitBounds` so the existing R1 recenter tests - which assert a `flyTo`
 * with a center + duration - keep passing.
 */
const USER_VIEW_ZOOM = 10

/** Fallback zoom for `getZoom()` if the live map read throws. */
const DEFAULT_ZOOM = 13
const PITCH_3D = 55
const PITCH_FLAT = 0
const BEARING_3D = -17

type ThemeMode = 'light' | 'dark'

/**
 * Mapbox Standard (GL JS v3) is a single style serving both themes. Light and
 * dark are no longer two separate basemaps swapped via `setStyle` - they are
 * one style relit at runtime by the `lightPreset` config property (`day` vs
 * `night`), which the theme-sync effect flips in place with no full reload.
 *
 * Standard provides, natively and GPU-optimised: dynamic lighting with real
 * shadows + ambient occlusion, 3D buildings, modelled landmarks, 3D trees, and
 * its own sky/atmosphere. That replaces the hand-rolled sky layer, fog, and
 * `fill-extrusion` building layer the v2 dark/light styles needed. The only
 * custom layer we still manage is terrain (Standard does not enable it itself).
 */
const STANDARD_STYLE = 'mapbox://styles/mapbox/standard'

/** Resolved theme → Standard `lightPreset`. */
const LIGHT_PRESET: Record<ThemeMode, 'day' | 'night'> = {
  dark: 'night',
  light: 'day',
}

const TERRAIN_SOURCE_ID = 'mapbox-dem'

/** Standard's import id, the namespace its config properties live under. */
const BASEMAP_IMPORT_ID = 'basemap'

/**
 * `setConfigProperty` is GL JS v3 surface that the bundled mapbox-gl types do
 * not always expose. Narrow to an optional method so calls are type-safe and
 * degrade to a no-op rather than throwing if the runtime predates it.
 */
type MapWithConfig = mapboxgl.Map & {
  setConfigProperty?: (importId: string, config: string, value: unknown) => void
}

interface BasemapConfig {
  lightPreset: 'day' | 'night'
  show3dObjects: boolean
  showPointOfInterestLabels: boolean
  showPlaceLabels: boolean
  showRoadLabels: boolean
  showTransitLabels: boolean
}

/**
 * Standard `basemap` configuration. We render our own venue glyphs and beams,
 * so Mapbox's own POI pins stay off (less clutter, less fill-rate); place and
 * road labels stay on so the city still reads as a real place behind the
 * constellation. `show3dObjects` is the heavy realism switch (buildings,
 * landmarks, trees, shadows, AO) and is gated by {@link shouldEnable3dObjects}.
 */
function basemapConfig(theme: ThemeMode, show3d: boolean): BasemapConfig {
  return {
    lightPreset: LIGHT_PRESET[theme],
    show3dObjects: show3d,
    showPointOfInterestLabels: false,
    showPlaceLabels: true,
    showRoadLabels: true,
    showTransitLabels: false,
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Coarse low-end detection for phones. Deliberately conservative: only ≤3GB RAM
 * or ≤2 logical cores counts as low-end, so genuine mid-range Androids (4GB+ /
 * 4+ cores) still get the full 3D city. Used to decide whether the expensive
 * shadow/ambient-occlusion pass of Standard's 3D objects is worth enabling.
 */
function isLowEndDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  const cores = navigator.hardwareConcurrency
  if (typeof mem === 'number' && mem > 0 && mem <= 3) return true
  if (typeof cores === 'number' && cores > 0 && cores <= 2) return true
  return false
}

/**
 * Whether to switch on Standard's full 3D objects at startup. Off when the user
 * asked for reduced motion or on low-end hardware, where the shadow/AO pass is
 * the most expensive part of each frame. The user can still force it on/off via
 * the 3D toggle (`setPitch3D`).
 */
function shouldEnable3dObjects(): boolean {
  return !prefersReducedMotion() && !isLowEndDevice()
}

/** Set a Standard `basemap` config property, no-op if unsupported. */
function setBasemapConfig(map: mapboxgl.Map, key: string, value: unknown): void {
  try {
    ;(map as MapWithConfig).setConfigProperty?.(BASEMAP_IMPORT_ID, key, value)
  } catch {
    /* config is cosmetic - fail open */
  }
}

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
 * Adds the terrain DEM and enables real elevation so mountains and valleys lift
 * off the map plane. Standard supplies its own sky/atmosphere, dynamic
 * lighting, 3D buildings and landmarks via the `basemap` config, so terrain is
 * the only custom layer we still hand-manage. Called on initial style load and
 * on any future style swap.
 */
function applyTerrain(map: mapboxgl.Map): void {
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
    /* terrain is cosmetic - fail open */
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

  /**
   * No-op retained for MapControls API compatibility (drift removed).
   */
  const pauseIdleDrift = useCallback((ms: number) => {
    void ms
  }, [])

  const setPitch3D = useCallback((on: boolean) => {
    setIs3D(on)
    const map = mapRef.current
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
    // Tie Standard's 3D objects to the 3D toggle: flat mode also sheds the
    // expensive shadow/ambient-occlusion pass, a real battery lever on phones.
    // Explicit user intent here overrides the startup device gate.
    setBasemapConfig(map, 'show3dObjects', on)
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
      map.easeTo({ bearing: 0, duration: 600 })
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
      map.flyTo({ center: [pos.lng, pos.lat], zoom: USER_VIEW_ZOOM, duration: 1000 })
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
    const enable3d = shouldEnable3dObjects()

    let map: mapboxgl.Map
    try {
      mapboxgl.accessToken = MAPBOX_TOKEN

      map = new mapboxgl.Map({
        container,
        style: STANDARD_STYLE,
        // Standard config: relit per theme via lightPreset, with 3D objects
        // (buildings/landmarks/trees/shadows) gated on device capability.
        config: {
          [BASEMAP_IMPORT_ID]: basemapConfig(initialTheme, enable3d),
        } as unknown as mapboxgl.MapOptions['config'],
        // Open on a full-country overview; the user zooms in via Recenter.
        center: COUNTRY_CENTER,
        zoom: COUNTRY_ZOOM,
        pitch: PITCH_3D,
        bearing: BEARING_3D,
        antialias: true,
        failIfMajorPerformanceCaveat: false,
        // Globe projection uses spherical math for marker screen-coordinate
        // projection. Without this, the implicit mercator projection at very
        // low zoom + high pitch produces incorrect screen positions, causing
        // markers to detach from the globe surface (mapbox-gl issue #12592).
        projection: 'globe' as unknown as mapboxgl.ProjectionSpecification,
        // Prevent zooming out past a meaningful regional overview.
        minZoom: 4,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      if (import.meta.env?.DEV) {
        console.error('[useMapInit] Failed to create map:', message)
      }
      setMapError('Could not load the map. Please try again.')
      return
    }

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

    // style.load fires both on initial style load AND every time setStyle()
    // swaps the basemap. Re-apply terrain every time. Standard's sky, lighting,
    // 3D buildings and landmarks come from the `basemap` config, not custom
    // layers, so terrain is all that needs re-binding here.
    map.on('style.load', () => {
      applyTerrain(map)
      suppressCtrlLinkFocus(container)
    })

    // Keep Mapbox's attribution/logo links out of the keyboard tab order.
    // Observe only the control corners (not the whole container) so the
    // frequent marker DOM churn from socket updates never triggers this.
    const ctrlEl: HTMLElement = container!
    const ctrlObserver = new MutationObserver(() => suppressCtrlLinkFocus(ctrlEl))
    const watchCtrlCorners = () => {
      suppressCtrlLinkFocus(ctrlEl)
      ctrlEl
        .querySelectorAll(
          '.mapboxgl-ctrl-bottom-left, .mapboxgl-ctrl-bottom-right, .mapboxgl-ctrl-top-right, .mapboxgl-ctrl-top-left',
        )
        .forEach((corner) => ctrlObserver.observe(corner, { childList: true, subtree: true }))
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

    const ro = new ResizeObserver(() => {
      try {
        map.resize()
      } catch {
        /* ignore */
      }
    })
    ro.observe(container)

    // Timeout: if map doesn't load within 15s, show error.
    const loadTimeout = setTimeout(() => {
      if (!loadedRef.current) {
        setMapError('Map is taking too long to load. Check your connection and try again.')
      }
    }, 15000)

    return () => {
      clearTimeout(loadTimeout)
      ro.disconnect()
      ctrlObserver.disconnect()
      // Fully tear down the map on unmount so a stale, detached instance can
      // never block re-initialisation when the Map tab is reopened.
      try {
        map.remove()
      } catch {
        /* already removed */
      }
      if (mapRef.current === map) mapRef.current = null
      loadedRef.current = false
      themeRef.current = null
    }
    // `resolved` is intentionally omitted from deps. The init effect reads it
    // to seed the initial lightPreset config, but theme changes after init are
    // handled by the dedicated theme-sync effect below via setConfigProperty.
    // Including it here would re-create the entire map on every theme flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setMapInstance, mapError])

  // ── Reactive theme sync ──
  // Whenever the resolved theme flips (SAST 06:00 transition, user toggle, or
  // the auto path re-evaluating), relight the Standard basemap in place via the
  // `lightPreset` config (day↔night). This is far cheaper than the old
  // setStyle() swap: no full style reload, no re-binding terrain, and markers
  // (HTML elements anchored to lng/lat) never flicker.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (themeRef.current === resolved) return
    themeRef.current = resolved
    setBasemapConfig(map, 'lightPreset', LIGHT_PRESET[resolved])
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
