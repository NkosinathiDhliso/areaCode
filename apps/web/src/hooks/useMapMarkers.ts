import { TIER_SIZE_MULTIPLIER } from '@area-code/shared/constants'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import type { Node, NodeCategory, NodeState } from '@area-code/shared/types'
import mapboxgl from 'mapbox-gl'
import { createElement, useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ArchetypeGlyph } from '../components/ArchetypeGlyph'
import { DEFAULT_ARCHETYPE_ID, GLYPH_ZOOM_THRESHOLD, MIN_MARKER_ZOOM } from '../lib/carouselConstants'
import { getNodeState, getCategoryColour } from '../lib/mapHelpers'

/**
 * The three legibility tiers the Marker_Layer renders, selected purely by
 * the live Map_Canvas zoom (design Property 17):
 *
 * - `glyph`  - zoom ≥ `GLYPH_ZOOM_THRESHOLD` (12.5): detailed archetype glyph.
 * - `dot`    - zoom in `[MIN_MARKER_ZOOM, GLYPH_ZOOM_THRESHOLD)` (8 → 12.5):
 *              a simple category-coloured dot so a packed city-overview reads
 *              as clean density rather than a collage of tiny icons.
 * - `hidden` - zoom < `MIN_MARKER_ZOOM` (8): markers are hidden because at
 *              continent/globe zoom an individual venue marker covers a huge
 *              geographic area and visually detaches from the globe surface.
 *
 * `GLYPH_ZOOM_THRESHOLD` and `MIN_MARKER_ZOOM` are imported from
 * `carouselConstants` - the single shared home for the map-presentation
 * thresholds - so the carousel, camera, and marker layers all agree.
 */
export type MarkerPresentationTier = 'glyph' | 'dot' | 'hidden'

/**
 * Pure mapping from a zoom level to its {@link MarkerPresentationTier}.
 * Extracted as a total, side-effect-free function so it can be property-tested
 * (design Property 17, task 13.2) independently of the React/Mapbox wiring.
 *
 * Validates: Requirements 12.1, 12.2, 12.3
 */
export function presentationTierForZoom(zoom: number): MarkerPresentationTier {
  if (zoom >= GLYPH_ZOOM_THRESHOLD) return 'glyph'
  if (zoom < MIN_MARKER_ZOOM) return 'hidden'
  return 'dot'
}

/**
 * Pure predicate: is `nodeId` the current Active_Venue? Extracted so the
 * active-marker distinction (design Property 19, task 13.4) is testable without
 * a live map. Returns false when there is no Active_Venue.
 *
 * Validates: Requirements 12.6
 */
export function isActiveMarker(nodeId: string, activeVenueId: string | null): boolean {
  return activeVenueId !== null && nodeId === activeVenueId
}

/**
 * Returns a 0–1 visibility factor for the given zoom level - the
 * *presence* channel: should the marker be on screen at all, and how far
 * through the fade-in from the hidden tier is it.
 *
 * Stays consistent with {@link presentationTierForZoom}: it is exactly 0 in the
 * `hidden` tier and 1 in the `glyph` tier, ramping linearly across the `dot`
 * tier so the transition across a threshold is smooth and never detaches the
 * marker from its coordinates (design Property 18).
 *
 * This is composed with {@link zoomSizeFactor} (the *size* channel) into the
 * single transform scale applied to each marker's scale-layer in
 * {@link applyZoomScale}.
 */
export function scaleForZoom(zoom: number): number {
  if (zoom >= GLYPH_ZOOM_THRESHOLD) return 1
  if (zoom < MIN_MARKER_ZOOM) return 0
  return (zoom - MIN_MARKER_ZOOM) / (GLYPH_ZOOM_THRESHOLD - MIN_MARKER_ZOOM)
}

/**
 * The zoom at which a marker renders at exactly its designed pixel size
 * (`zoomSizeFactor === 1`). The `GLYPH_SIZE` table and the per-tier / per-state
 * sizing were tuned for the detailed glyph tier, so we anchor the zoom-aware
 * sizing at the glyph threshold: at and below it the factor stays ≤ 1, and as
 * the user zooms past it the glyph grows gently so a venue the user has zoomed
 * right up to reads as physically present on its block rather than staying a
 * fixed screen-space pip. Keeping the anchor here also makes the new sizing a
 * no-op at the threshold, so existing glyph-tier behaviour is unchanged.
 */
export const BASE_PRESENTATION_ZOOM = GLYPH_ZOOM_THRESHOLD

/** How much the glyph grows/shrinks per zoom level away from the base zoom. */
const ZOOM_SIZE_SLOPE = 0.12
/** Hard floor/ceiling so the glyph never collapses to nothing or swallows the map. */
const ZOOM_SIZE_MIN = 0.7
const ZOOM_SIZE_MAX = 1.6

/**
 * Returns a continuous size multiplier for the given zoom level, anchored on
 * {@link BASE_PRESENTATION_ZOOM} so the marker's pixel size *considers the map
 * zoom* instead of being a flat screen-space constant.
 *
 * - At the base zoom the factor is exactly 1 (designed size).
 * - Above the base zoom it grows by {@link ZOOM_SIZE_SLOPE} per level, capped
 *   at {@link ZOOM_SIZE_MAX}, so zooming in makes a venue feel closer.
 * - Below the base zoom it shrinks, floored at {@link ZOOM_SIZE_MIN}, so a
 *   packed regional overview reads as tidy density rather than a collage of
 *   full-size icons.
 *
 * Pure and total (clamped, never NaN for finite input) so it can be
 * property-tested independently of the Mapbox wiring, the same way
 * {@link scaleForZoom} is.
 */
export function zoomSizeFactor(zoom: number): number {
  const factor = 1 + (zoom - BASE_PRESENTATION_ZOOM) * ZOOM_SIZE_SLOPE
  return Math.min(ZOOM_SIZE_MAX, Math.max(ZOOM_SIZE_MIN, factor))
}

/** Data-layer tag for the inner element that owns the zoom transform. */
const SCALE_LAYER = 'scale-layer'

/**
 * Apply the zoom-driven visual scale to a marker.
 *
 * The scale is applied to an inner **scale-layer** element via the `transform`
 * property, NOT to the Mapbox-positioned root. This is load-bearing for keeping
 * markers locked to their coordinates: Mapbox writes
 * `transform: translate(screenX, screenY) …` onto the root element every frame.
 * The CSS `scale` property (and any transform on the root) composes as
 * `scale ∘ transform`, which scales that screen-position translate too -
 * displacing the marker by `(1 − scale) · (center − screenPos)`. Because
 * `screenPos` changes as the user pans, the marker visibly drifts off its
 * lng/lat whenever `scale ≠ 1`. Scaling a child element instead leaves the
 * root's translate untouched, so the marker stays geo-anchored at every zoom
 * (design Property 18).
 *
 * The applied scale combines the visibility ramp ({@link scaleForZoom}) with
 * the size response ({@link zoomSizeFactor}); the container's pointer-events are
 * gated on visibility alone so a faded-out marker never blocks map gestures.
 */
function applyZoomScale(markerEl: HTMLElement, zoom: number): void {
  const layer = markerEl.querySelector(`[data-layer="${SCALE_LAYER}"]`) as HTMLElement | null
  const visibility = scaleForZoom(zoom)
  if (layer) {
    layer.style.transform = `scale(${visibility * zoomSizeFactor(zoom)})`
  }
  markerEl.style.pointerEvents = visibility < 0.05 ? 'none' : ''
}

/**
 * Visual styling applied to the Active_Venue's marker so it is distinguished
 * from non-active markers (Requirement 12.6) and stays reachable when markers
 * overlap at a packed zoom (Requirement 12.5). Implemented on a dedicated ring
 * layer plus an elevated z-index, both toggled by {@link applyActiveStyling}.
 */
const ACTIVE_RING_LAYER = 'active-ring'

/** Marker sub-element that owns the React glyph mount. */
const GLYPH_HOST_LAYER = 'glyph-host'

/**
 * Per-Pulse_State animation, halo opacity, and ripple settings. The old
 * "core dot" layer has been retired (see R8.1 redesign): the
 * Archetype_Glyph is the marker now. Halo + ripple stay because they
 * are the Pulse_State channel (R8.5) and they don't compete with the
 * glyph for identity.
 */
const STATE_CONFIG: Record<NodeState, { animation: string; speed: string; haloOpacity: number; ripple: boolean }> = {
  dormant: { animation: 'breathe', speed: '4s', haloOpacity: 0.12, ripple: false },
  quiet: { animation: 'breathe', speed: '3s', haloOpacity: 0.2, ripple: false },
  active: { animation: 'pulse', speed: '1.5s', haloOpacity: 0.3, ripple: false },
  buzzing: { animation: 'pulse', speed: '0.8s', haloOpacity: 0.4, ripple: false },
  popping: { animation: 'pulse', speed: '0.4s', haloOpacity: 0.5, ripple: true },
}

/**
 * Glyph diameter per Pulse_State. Bigger Pulse_States get bigger
 * glyphs the same way the old core dot did, so density still reads at
 * the city-overview zoom. Floor of 16px (R8.9 floor of 8px is for the
 * inner SVG strokes, not the silhouette).
 */
const GLYPH_SIZE: Record<NodeState, number> = {
  dormant: 18,
  quiet: 22,
  active: 28,
  buzzing: 36,
  popping: 46,
}

function getGlyphSize(state: NodeState, score: number): number {
  const base = GLYPH_SIZE[state]
  return Math.min(base + score * 0.3, base * 1.8)
}

function buildMarkerElement(
  node: Node,
  glyphSize: number,
  colour: string,
  state: NodeState,
  liveCount: number,
  isActive: boolean,
  onTap: () => void,
): HTMLDivElement {
  void node
  const cfg = STATE_CONFIG[state]
  // Container is the Mapbox-positioned root: Mapbox writes a per-frame
  // `transform: translate(x,y) …` onto it to geo-anchor the marker. We must
  // NOT put a scale on this element (see applyZoomScale) - instead all visual
  // layers live inside `scaleLayer` and the zoom scale is applied there,
  // leaving the root's positioning translate untouched so the marker stays
  // locked to its lng/lat as the user pans and zooms.
  const totalSize = glyphSize * 3
  const container = document.createElement('div')
  container.className = 'node-marker'
  Object.assign(container.style, {
    width: `${totalSize}px`,
    height: `${totalSize}px`,
    // Must stay 'absolute' so Mapbox's per-frame `transform: translate(x,y)`
    // geo-anchors the marker to the map origin. Mapbox's `.mapboxgl-marker`
    // class sets this, but an inline value here would override the class -
    // 'relative' drops the marker back into normal flow and it visibly
    // drifts off its lng/lat as you pan/zoom.
    position: 'absolute',
    overflow: 'visible',
    pointerEvents: 'none',
  })

  // ── Scale layer ──
  // Owns the zoom transform (set by applyZoomScale) and is the containing
  // block + flex centre for every visual child. Fills the container exactly,
  // so its centre coincides with the geo-anchor and `transform: scale()`
  // scales the marker around that anchor without moving it off-coordinate.
  const scaleLayer = document.createElement('div')
  scaleLayer.dataset.layer = SCALE_LAYER
  Object.assign(scaleLayer.style, {
    position: 'absolute',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
    pointerEvents: 'none',
  })
  container.appendChild(scaleLayer)

  // ── Halo (Pulse_State channel) ──
  const haloSize = glyphSize * 2.2
  const blurRadius = state === 'popping' ? 16 : state === 'buzzing' ? 12 : 8
  const halo = document.createElement('div')
  Object.assign(halo.style, {
    position: 'absolute',
    width: `${haloSize}px`,
    height: `${haloSize}px`,
    borderRadius: '50%',
    background: `radial-gradient(circle, ${colour} 0%, transparent 70%)`,
    opacity: String(cfg.haloOpacity),
    filter: `blur(${blurRadius}px)`,
    animation: `${cfg.animation} ${cfg.speed} ease-in-out infinite`,
    pointerEvents: 'none',
  })
  halo.dataset.layer = 'halo'
  scaleLayer.appendChild(halo)

  // ── Popping ripple ──
  if (cfg.ripple) {
    const ripple = document.createElement('div')
    Object.assign(ripple.style, {
      position: 'absolute',
      width: `${glyphSize * 1.8}px`,
      height: `${glyphSize * 1.8}px`,
      borderRadius: '50%',
      border: `1.5px solid ${colour}`,
      opacity: '0.3',
      animation: 'ripple 2s ease-out infinite',
      pointerEvents: 'none',
    })
    ripple.dataset.layer = 'ripple'
    scaleLayer.appendChild(ripple)
  }

  // ── Glyph wrapper (the marker itself) ──
  // Owns the breathe / pulse animation that the old core dot used to
  // own, so the glyph's scale curve drives identity + alive-ness in one
  // element. Tap target is here - the glyph silhouette is what the user
  // is actually pointing at.
  const glyphWrapper = document.createElement('div')
  Object.assign(glyphWrapper.style, {
    position: 'relative',
    width: `${glyphSize}px`,
    height: `${glyphSize}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    animation: `${cfg.animation} ${cfg.speed} ease-in-out infinite`,
    cursor: 'pointer',
    pointerEvents: 'auto',
    // Soft drop-shadow so the silhouette reads on light tiles. Not a
    // glow per se - the halo handles glow. This is just edge separation.
    filter: state === 'dormant' ? 'none' : `drop-shadow(0 0 ${glyphSize * 0.25}px ${colour}66)`,
    // Smooth size transition so a mid-session tier upgrade (e.g.
    // starter → growth) rescales the glyph over 400ms rather than
    // snapping instantly (R8.6 crossfade / smooth transitions).
    transition: 'width 400ms ease, height 400ms ease',
  })
  glyphWrapper.dataset.layer = 'glyph-wrapper'
  glyphWrapper.addEventListener('mousedown', (e) => e.stopPropagation())
  glyphWrapper.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true })
  glyphWrapper.addEventListener('click', (e) => {
    e.stopPropagation()
    onTap()
  })

  // The React mount target. ArchetypeGlyph fills 100% of this host.
  const glyphHost = document.createElement('div')
  Object.assign(glyphHost.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  })
  glyphHost.dataset.layer = GLYPH_HOST_LAYER
  glyphWrapper.appendChild(glyphHost)
  scaleLayer.appendChild(glyphWrapper)

  // ── Live count badge (buzzing / popping only) ──
  // The badge shows the venue's Live_Check_In_Count (`mapStore.checkInCounts`),
  // the raw "how many people are here right now" headcount - distinct from the
  // weighted Pulse_Score that drives glyph size and animation.
  if ((state === 'buzzing' || state === 'popping') && liveCount > 0) {
    const badge = document.createElement('div')
    Object.assign(badge.style, {
      position: 'absolute',
      top: `${totalSize * 0.18}px`,
      right: `${totalSize * 0.18}px`,
      background: '#1e1e2e',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '9999px',
      padding: '2px 6px',
      fontSize: '11px',
      fontWeight: '600',
      color: '#f0f0f5',
      lineHeight: '1.3',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    })
    badge.textContent = liveCount > 99 ? '99+' : String(liveCount)
    badge.dataset.layer = 'badge'
    scaleLayer.appendChild(badge)
  }

  applyActiveStyling(container, isActive, colour)

  return container
}

/**
 * Toggle the Active_Venue distinction on a marker element. Exactly the
 * Active_Venue's marker carries the ring + elevated z-index; every other
 * marker has it removed (design Property 19). Idempotent and total so it can be
 * called freely on both build and update without leaking ring layers.
 *
 * Validates: Requirements 12.5, 12.6
 */
function applyActiveStyling(el: HTMLElement, isActive: boolean, colour: string): void {
  el.dataset.active = isActive ? 'true' : 'false'
  // The ring lives inside the scale-layer alongside the glyph so it scales with
  // the marker; fall back to the root only if the layer is somehow absent.
  const scaleLayer = (el.querySelector(`[data-layer="${SCALE_LAYER}"]`) as HTMLElement | null) ?? el
  let ring = scaleLayer.querySelector(`[data-layer="${ACTIVE_RING_LAYER}"]`) as HTMLElement | null

  if (isActive) {
    if (!ring) {
      ring = document.createElement('div')
      Object.assign(ring.style, {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        borderRadius: '50%',
        pointerEvents: 'none',
      })
      ring.dataset.layer = ACTIVE_RING_LAYER
      // Behind the glyph wrapper so the ring frames the marker without
      // covering the tap target.
      const glyphWrapper = scaleLayer.querySelector('[data-layer="glyph-wrapper"]')
      if (glyphWrapper) {
        scaleLayer.insertBefore(ring, glyphWrapper)
      } else {
        scaleLayer.appendChild(ring)
      }
    }
    // Size the ring off the live glyph wrapper so it tracks tier/state sizing.
    const glyphWrapper = scaleLayer.querySelector('[data-layer="glyph-wrapper"]') as HTMLElement | null
    const glyphSize = glyphWrapper ? parseFloat(glyphWrapper.style.width) || 0 : 0
    const ringSize = glyphSize * 1.5
    Object.assign(ring.style, {
      width: `${ringSize}px`,
      height: `${ringSize}px`,
      border: `2.5px solid ${colour}`,
      boxShadow: `0 0 0 2px rgba(255,255,255,0.55), 0 0 12px ${colour}`,
      background: 'transparent',
    })
    // Keep the Active_Venue's marker (and its tap target) above overlapping
    // neighbours at a packed zoom (Requirement 12.5). z-index belongs on the
    // Mapbox-positioned root so it orders this marker against its siblings.
    el.style.zIndex = '10'
  } else {
    if (ring) ring.remove()
    el.style.zIndex = ''
  }
}

function updateMarkerElement(
  el: HTMLElement,
  glyphSize: number,
  colour: string,
  state: NodeState,
  liveCount: number,
  isActive: boolean,
): void {
  const cfg = STATE_CONFIG[state]
  const totalSize = glyphSize * 3
  el.style.width = `${totalSize}px`
  el.style.height = `${totalSize}px`
  // The scale-layer mirrors the container box so its centre stays on the
  // geo-anchor; new ripple/badge nodes are mounted here, not on the root.
  const scaleLayer = (el.querySelector(`[data-layer="${SCALE_LAYER}"]`) as HTMLElement | null) ?? el

  // Halo
  const haloSize = glyphSize * 2.2
  const blurRadius = state === 'popping' ? 16 : state === 'buzzing' ? 12 : 8
  const halo = el.querySelector('[data-layer="halo"]') as HTMLElement | null
  if (halo) {
    Object.assign(halo.style, {
      width: `${haloSize}px`,
      height: `${haloSize}px`,
      background: `radial-gradient(circle, ${colour} 0%, transparent 70%)`,
      opacity: String(cfg.haloOpacity),
      filter: `blur(${blurRadius}px)`,
      animation: `${cfg.animation} ${cfg.speed} ease-in-out infinite`,
    })
  }

  // Ripple - add when entering popping, remove otherwise.
  let ripple = el.querySelector('[data-layer="ripple"]') as HTMLElement | null
  if (cfg.ripple) {
    if (!ripple) {
      ripple = document.createElement('div')
      Object.assign(ripple.style, {
        position: 'absolute',
        width: `${glyphSize * 1.8}px`,
        height: `${glyphSize * 1.8}px`,
        borderRadius: '50%',
        border: `1.5px solid ${colour}`,
        opacity: '0.3',
        animation: 'ripple 2s ease-out infinite',
        pointerEvents: 'none',
      })
      ripple.dataset.layer = 'ripple'
      // Insert before the glyph wrapper so it renders behind it.
      const glyphWrapper = scaleLayer.querySelector('[data-layer="glyph-wrapper"]')
      if (glyphWrapper) {
        scaleLayer.insertBefore(ripple, glyphWrapper)
      } else {
        scaleLayer.appendChild(ripple)
      }
    } else {
      Object.assign(ripple.style, {
        width: `${glyphSize * 1.8}px`,
        height: `${glyphSize * 1.8}px`,
        borderColor: colour,
      })
    }
  } else if (ripple) {
    ripple.remove()
  }

  // Glyph wrapper
  const glyphWrapper = el.querySelector('[data-layer="glyph-wrapper"]') as HTMLElement | null
  if (glyphWrapper) {
    Object.assign(glyphWrapper.style, {
      width: `${glyphSize}px`,
      height: `${glyphSize}px`,
      animation: `${cfg.animation} ${cfg.speed} ease-in-out infinite`,
      filter: state === 'dormant' ? 'none' : `drop-shadow(0 0 ${glyphSize * 0.25}px ${colour}66)`,
    })
  }

  // Live count badge - reflects the venue's Live_Check_In_Count, updated in
  // place on each `node:pulse_update` without detaching the marker (R18.1).
  let badge = el.querySelector('[data-layer="badge"]') as HTMLElement | null
  if ((state === 'buzzing' || state === 'popping') && liveCount > 0) {
    if (!badge) {
      badge = document.createElement('div')
      Object.assign(badge.style, {
        position: 'absolute',
        top: `${totalSize * 0.18}px`,
        right: `${totalSize * 0.18}px`,
        background: '#1e1e2e',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '9999px',
        padding: '2px 6px',
        fontSize: '11px',
        fontWeight: '600',
        color: '#f0f0f5',
        lineHeight: '1.3',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      })
      badge.dataset.layer = 'badge'
      scaleLayer.appendChild(badge)
    }
    badge.textContent = liveCount > 99 ? '99+' : String(liveCount)
  } else if (badge) {
    badge.remove()
  }

  applyActiveStyling(el, isActive, colour)
}

/**
 * Manages Mapbox markers for nodes. The marker is the Archetype_Glyph
 * itself - there is no longer a coloured core circle. Halo carries
 * Pulse_State, ripple carries the popping signal, the glyph carries
 * identity (which archetype the venue is catering to right now) plus
 * category colour through `dynamicContrastForCategory` + the
 * category-coloured drop-shadow on the glyph wrapper.
 */
export function useMapMarkers(
  mapRef: React.RefObject<mapboxgl.Map | null>,
  categoryFilter: NodeCategory | null,
  onNodeTap: (node: Node) => void,
  mapReady = false,
  activeVenueId: string | null = null,
) {
  const nodes = useMapStore((s) => s.nodes)
  const pulseScores = useMapStore((s) => s.pulseScores)
  const checkInCounts = useMapStore((s) => s.checkInCounts)
  const archetypeIds = useMapStore((s) => s.archetypeIds)
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map())
  // Per-marker React roots used to render <ArchetypeGlyph> inside each
  // marker. Tracked in parallel with `markersRef` so we can unmount the
  // root when the marker is removed.
  const glyphRootsRef = useRef<Map<string, Root>>(new Map())
  // Keep a stable ref to the latest onNodeTap so marker click handlers are never stale
  const onNodeTapRef = useRef(onNodeTap)
  onNodeTapRef.current = onNodeTap

  // Whether to render the detailed archetype icon (true) or a simple dot
  // (false), driven by the live map zoom. Starts true so the default
  // browsing zoom (13) shows icons immediately.
  const [showIcon, setShowIcon] = useState(true)

  // Track zoom and flip `showIcon` when crossing the threshold. Reading via
  // state (not a ref) lets the marker effect below re-run and re-render every
  // glyph host when the mode changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const syncFromZoom = () => {
      let zoom = GLYPH_ZOOM_THRESHOLD
      try {
        zoom = map.getZoom()
      } catch {
        /* map gone */
      }

      // HTML markers don't scale with Mapbox's WebGL zoom. We apply our own
      // zoom-aware scale (visibility ramp × size factor) to each marker's
      // inner scale-layer - never to the Mapbox-positioned root - so markers
      // shrink at low zoom and grow as you zoom in WITHOUT drifting off their
      // lng/lat. Crossing a threshold only changes the scale and the glyph/dot
      // render mode; the marker is never removed, so it stays geo-anchored
      // (R12.4, Property 18).
      for (const [, marker] of markersRef.current) {
        applyZoomScale(marker.getElement(), zoom)
      }

      // glyph tier → detailed icon; dot/hidden tiers → category dot (the
      // `hidden` tier additionally collapses to scale 0 above).
      setShowIcon((prev) => {
        const next = presentationTierForZoom(zoom) === 'glyph'
        return prev === next ? prev : next
      })
    }

    syncFromZoom()
    map.on('zoom', syncFromZoom)
    return () => {
      try {
        map.off('zoom', syncFromZoom)
      } catch {
        /* ignore */
      }
    }
  }, [mapRef, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) {
      return
    }

    let cancelled = false

    const addMarkers = () => {
      if (cancelled) return

      const nodeArray = Object.values(nodes)
      const filtered = categoryFilter ? nodeArray.filter((n) => n.category === categoryFilter) : nodeArray

      const filteredIds = new Set(filtered.map((n) => n.id))

      for (const [id, marker] of markersRef.current) {
        if (!filteredIds.has(id)) {
          marker.remove()
          markersRef.current.delete(id)
          const root = glyphRootsRef.current.get(id)
          if (root) {
            queueMicrotask(() => root.unmount())
            glyphRootsRef.current.delete(id)
          }
        }
      }

      for (const node of filtered) {
        const score = pulseScores[node.id] ?? 0
        const state = getNodeState(score)
        const liveCount = checkInCounts[node.id] ?? 0
        const active = isActiveMarker(node.id, activeVenueId)
        const tierMultiplier = TIER_SIZE_MULTIPLIER[node.businessTier ?? 'starter']
        const glyphSize = getGlyphSize(state, score) * tierMultiplier
        const colour = getCategoryColour(node.category)
        const existing = markersRef.current.get(node.id)
        // R7.8 / R8 fallback ladder: live archetype id from the store
        // (populated by `node:archetype_change`), then the node's
        // configured default, then the eclectic fallback.
        const archetypeId = archetypeIds[node.id] ?? node.defaultArchetypeId ?? DEFAULT_ARCHETYPE_ID

        if (existing) {
          existing.setLngLat([node.lng, node.lat])
          updateMarkerElement(existing.getElement(), glyphSize, colour, state, liveCount, active)
          renderGlyph(
            glyphRootsRef.current,
            existing.getElement(),
            node.id,
            archetypeId,
            state,
            node.category,
            showIcon,
          )
          continue
        }

        const el = buildMarkerElement(node, glyphSize, colour, state, liveCount, active, () => {
          onNodeTapRef.current(node)
        })

        const marker = new mapboxgl.Marker({
          element: el,
          anchor: 'center',
          // 'horizon' keeps the marker oriented relative to the globe's
          // horizon during bearing drift. Without this, markers can appear
          // to spin or drift visually as the globe rotates.
          rotationAlignment: 'horizon' as mapboxgl.MarkerOptions['rotationAlignment'],
        })
          .setLngLat([node.lng, node.lat])
          .addTo(map)

        // Sync scale to current zoom immediately so newly added markers don't
        // flash at full size before the next zoom event fires. Applied to the
        // scale-layer (inside applyZoomScale), never the positioned root.
        let curZoom = GLYPH_ZOOM_THRESHOLD
        try {
          curZoom = map.getZoom()
        } catch {
          /* ignore */
        }
        applyZoomScale(el, curZoom)

        markersRef.current.set(node.id, marker)
        renderGlyph(glyphRootsRef.current, el, node.id, archetypeId, state, node.category, showIcon)
      }
    }

    if (map.loaded()) {
      addMarkers()
    } else {
      map.once('load', addMarkers)
    }

    return () => {
      cancelled = true
      map.off('load', addMarkers)
    }
  }, [nodes, pulseScores, checkInCounts, archetypeIds, categoryFilter, activeVenueId, mapRef, mapReady, showIcon])

  // Tear down every glyph root on unmount so a remount of the map screen
  // doesn't leak React commits to dead DOM.
  useEffect(() => {
    const roots = glyphRootsRef.current
    return () => {
      for (const [, root] of roots) {
        queueMicrotask(() => root.unmount())
      }
      roots.clear()
    }
  }, [])
}

/**
 * Mount or update the marker's React subtree for its glyph host.
 *
 * When `showIcon` is true the full `ArchetypeGlyph` is rendered. Below the
 * zoom threshold (`showIcon` false) a simple category-coloured dot is rendered
 * instead, so a packed city-overview reads as clean density rather than a
 * collage of tiny detailed icons. The glyph is the marker either way - what
 * the `live_vibe_on_map` flag gates is the live `node:archetype_change`
 * subscription in `MapScreen`, not the rendering here.
 */
function renderGlyph(
  roots: Map<string, Root>,
  markerEl: HTMLElement,
  nodeId: string,
  archetypeId: string,
  state: NodeState,
  category: NodeCategory,
  showIcon: boolean,
): void {
  const host = markerEl.querySelector(`[data-layer="${GLYPH_HOST_LAYER}"]`) as HTMLElement | null
  if (!host) return

  let root = roots.get(nodeId)
  if (!root) {
    root = createRoot(host)
    roots.set(nodeId, root)
  }
  root.render(
    showIcon
      ? createElement(ArchetypeGlyph, {
          archetypeId,
          pulseState: state,
          category,
        })
      : createElement(DotMarker, { category, pulseState: state }),
  )
}

/**
 * Simple category-coloured dot shown at city-overview zoom in place of the
 * detailed archetype icon. Fills its host (the same `glyph-host` layer) so it
 * inherits the marker wrapper's breathe / pulse animation and sizing.
 */
function DotMarker({ category, pulseState }: { category: NodeCategory; pulseState: NodeState }) {
  const colour = getCategoryColour(category)
  const opacity = pulseState === 'dormant' ? 0.55 : 1
  return createElement('div', {
    'aria-hidden': true,
    style: {
      position: 'absolute',
      top: '50%',
      left: '50%',
      width: '62%',
      height: '62%',
      transform: 'translate(-50%, -50%)',
      borderRadius: '50%',
      background: colour,
      opacity,
      boxShadow: `0 0 0 1.5px rgba(0,0,0,0.25)`,
      pointerEvents: 'none',
    },
  })
}
