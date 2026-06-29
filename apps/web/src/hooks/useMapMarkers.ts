import { TIER_SIZE_MULTIPLIER } from '@area-code/shared/constants'
import { useLocationStore, useMapStore } from '@area-code/shared/stores'
import { useUserStore } from '@area-code/shared/stores/userStore'
import type { Node, NodeCategory, NodeState } from '@area-code/shared/types'
import mapboxgl from 'mapbox-gl'
import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ArchetypeGlyph } from '../components/ArchetypeGlyph'
import { canRecenter } from '../lib/cameraControl'
import { DEFAULT_ARCHETYPE_ID, GLYPH_ZOOM_THRESHOLD, PULSE_TEMPO } from '../lib/carouselConstants'
import { vibeRank } from '../lib/carouselRanking'
import { getNodeState, getCategoryColour } from '../lib/mapHelpers'
import {
  beamContainerSize,
  ensureBeaconStack,
  ensureBeamLayers,
  updateBeamLayers,
  applyPresentationTier,
  type BeamVisualOptions,
} from '../lib/markerBeam'
import {
  BASE_PRESENTATION_ZOOM,
  beamBlendForZoom,
  constellationVisibleIds,
  isActiveMarker,
  markerVisibilityScale,
  presentationTierForZoom,
  scaleForZoom,
  zoomSizeFactor,
  type MarkerPresentationTier,
} from '../lib/markerPresentation'

export {
  BASE_PRESENTATION_ZOOM,
  beamBlendForZoom,
  isActiveMarker,
  markerVisibilityScale,
  presentationTierForZoom,
  scaleForZoom,
  zoomSizeFactor,
  type MarkerPresentationTier,
}

/**
 * The three legibility tiers the Marker_Layer renders, selected purely by
 * the live Map_Canvas zoom (design Property 17):
 *
 * - `glyph`  - zoom ≥ `GLYPH_ZOOM_THRESHOLD` (12.5): detailed archetype glyph.
 * - `dot`    - zoom in `[MIN_MARKER_ZOOM, GLYPH_ZOOM_THRESHOLD)` (8 → 12.5):
 *              a simple category-coloured dot so a packed city-overview reads
 *              as clean density rather than a collage of tiny icons.
 * - `beam`   - zoom < `MIN_MARKER_ZOOM` (Constellation mode): pulse-driven
 *              sky beams anchored at the venue. See constellation-mode.md.
 *
 * `GLYPH_ZOOM_THRESHOLD` and `MIN_MARKER_ZOOM` are imported from
 * `carouselConstants` - the single shared home for the map-presentation
 * thresholds - so the carousel, camera, and marker layers all agree.
 */

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
 * displacing the marker by `(1 - scale) · (center - screenPos)`. Because
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
  const visibility = markerVisibilityScale(zoom)
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
  dormant: { ...PULSE_TEMPO.dormant, haloOpacity: 0.12, ripple: false },
  quiet: { ...PULSE_TEMPO.quiet, haloOpacity: 0.2, ripple: false },
  active: { ...PULSE_TEMPO.active, haloOpacity: 0.3, ripple: false },
  buzzing: { ...PULSE_TEMPO.buzzing, haloOpacity: 0.4, ripple: false },
  popping: { ...PULSE_TEMPO.popping, haloOpacity: 0.5, ripple: true },
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
  beamOptions: BeamVisualOptions = {},
  onCommitZoom?: () => void,
): HTMLDivElement {
  const cfg = STATE_CONFIG[state]
  const tierScale = beamOptions.tierBaseScale ?? 1
  const beamBox = beamContainerSize(state, tierScale, glyphSize)
  const glyphFootprint = glyphSize * 3
  const totalSize = Math.max(glyphFootprint, beamBox.height)
  const totalWidth = Math.max(glyphFootprint, beamBox.width)
  const container = document.createElement('div')
  container.className = 'node-marker'
  // Tag the marker with its node id so the camera can locate this exact marker
  // and frame its glyph apex (not just the geo-anchored beam tip) when flying
  // the Active_Venue into the band above the carousel (see `cameraControl`).
  container.dataset.nodeId = node.id
  Object.assign(container.style, {
    width: `${totalWidth}px`,
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
    alignItems: 'flex-end',
    justifyContent: 'center',
    overflow: 'visible',
    pointerEvents: 'none',
  })
  container.appendChild(scaleLayer)

  const beaconStack = ensureBeaconStack(scaleLayer)

  let lastBeamTapAt = 0
  ensureBeamLayers(
    beaconStack,
    colour,
    state,
    () => {
      const now = Date.now()
      if (now - lastBeamTapAt < 350 && onCommitZoom) {
        lastBeamTapAt = 0
        onCommitZoom()
        return
      }
      lastBeamTapAt = now
      onTap()
    },
    { ...beamOptions, glyphSize },
  )

  // ── Glyph wrapper (rides the apex at the TOP of the beam) ──
  // Bat-Signal: the beam's tip is pinned to the venue coordinate at the bottom
  // and widens upward into the sky; the glyph sits on the wide cone mouth at
  // the top of that light pillar - NOT down on the ground coordinate.
  const glyphWrapper = document.createElement('div')
  Object.assign(glyphWrapper.style, {
    position: 'relative',
    width: `${glyphSize}px`,
    height: `${glyphSize}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '-4px',
    cursor: 'pointer',
    pointerEvents: 'auto',
    filter: state === 'dormant' ? 'none' : `drop-shadow(0 0 ${glyphSize * 0.25}px ${colour}66)`,
    transition: 'width 400ms ease, height 400ms ease',
    zIndex: '2',
  })
  glyphWrapper.dataset.layer = 'glyph-wrapper'
  glyphWrapper.addEventListener('mousedown', (e) => e.stopPropagation())
  glyphWrapper.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true })
  glyphWrapper.addEventListener('click', (e) => {
    e.stopPropagation()
    onTap()
  })

  const glyphHost = document.createElement('div')
  Object.assign(glyphHost.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '2',
  })
  glyphHost.dataset.layer = GLYPH_HOST_LAYER
  glyphWrapper.appendChild(glyphHost)

  // ── Halo (Pulse_State channel, frames the glyph) ──
  const haloSize = glyphSize * 2.2
  const blurRadius = state === 'popping' ? 16 : state === 'buzzing' ? 12 : 8
  const halo = document.createElement('div')
  Object.assign(halo.style, {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: `${haloSize}px`,
    height: `${haloSize}px`,
    borderRadius: '50%',
    background: `radial-gradient(circle, ${colour} 0%, transparent 70%)`,
    opacity: String(cfg.haloOpacity),
    filter: `blur(${blurRadius}px)`,
    animation: `${cfg.animation} ${cfg.speed} ease-in-out infinite`,
    pointerEvents: 'none',
    zIndex: '0',
  })
  halo.dataset.layer = 'halo'
  glyphWrapper.appendChild(halo)

  if (cfg.ripple) {
    const ripple = document.createElement('div')
    Object.assign(ripple.style, {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: `${glyphSize * 1.8}px`,
      height: `${glyphSize * 1.8}px`,
      borderRadius: '50%',
      border: `1.5px solid ${colour}`,
      opacity: '0.3',
      animation: 'ripple 2s ease-out infinite',
      pointerEvents: 'none',
      zIndex: '1',
    })
    ripple.dataset.layer = 'ripple'
    glyphWrapper.appendChild(ripple)
  }

  // Place the glyph at the TOP of the flex column (before the beam hit) so the
  // beam descends from it to the venue coordinate. Appending it would stack the
  // glyph *below* the beam - back on the ground coordinate, which is the bug
  // this fixes.
  beaconStack.insertBefore(glyphWrapper, beaconStack.firstChild)

  // ── Live count badge (buzzing / popping only) ──
  // The badge shows the venue's Live_Check_In_Count (`mapStore.checkInCounts`),
  // the raw "how many people are here right now" headcount - distinct from the
  // weighted Pulse_Score that drives glyph size and animation.
  if ((state === 'buzzing' || state === 'popping') && liveCount > 0) {
    const badge = document.createElement('div')
    Object.assign(badge.style, {
      position: 'absolute',
      top: '-6px',
      right: '-6px',
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
    // Pin the count to the glyph (top of the beam) so it rides the apex with
    // the symbol rather than floating near the ground coordinate.
    glyphWrapper.appendChild(badge)
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
  // The ring must be centred on the GLYPH at the beam apex, not on the middle
  // of the tall marker container. The container is `beamHeight + glyphSize`
  // tall and the glyph rides at its TOP, so a ring positioned at 50% of the
  // container lands halfway down the beam stem. Mounting the ring INSIDE the
  // glyph wrapper (the same anchor the halo uses) makes `top/left: 50%` resolve
  // against the glyph box, so the circle always frames the glyph.
  const scaleLayer = (el.querySelector(`[data-layer="${SCALE_LAYER}"]`) as HTMLElement | null) ?? el
  const glyphWrapper = scaleLayer.querySelector('[data-layer="glyph-wrapper"]') as HTMLElement | null
  const ringHost = glyphWrapper ?? scaleLayer
  let ring = ringHost.querySelector(`[data-layer="${ACTIVE_RING_LAYER}"]`) as HTMLElement | null

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
        // Behind the glyph host (z-index 2) but above the halo (z-index 0) so
        // the ring frames the glyph without covering the tap/identity layer.
        zIndex: '1',
      })
      ring.dataset.layer = ACTIVE_RING_LAYER
      ringHost.insertBefore(ring, ringHost.firstChild)
    }
    // Size the ring off the live glyph wrapper so it tracks tier/state sizing.
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
  beamOptions: BeamVisualOptions = {},
): void {
  const cfg = STATE_CONFIG[state]
  const tierScale = beamOptions.tierBaseScale ?? 1
  const beamBox = beamContainerSize(state, tierScale, glyphSize)
  const glyphFootprint = glyphSize * 3
  const totalSize = Math.max(glyphFootprint, beamBox.height)
  const totalWidth = Math.max(glyphFootprint, beamBox.width)
  el.style.width = `${totalWidth}px`
  el.style.height = `${totalSize}px`
  const scaleLayer = (el.querySelector(`[data-layer="${SCALE_LAYER}"]`) as HTMLElement | null) ?? el
  const glyphWrapper = el.querySelector('[data-layer="glyph-wrapper"]') as HTMLElement | null

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

  let ripple = el.querySelector('[data-layer="ripple"]') as HTMLElement | null
  if (cfg.ripple) {
    if (!ripple && glyphWrapper) {
      ripple = document.createElement('div')
      Object.assign(ripple.style, {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: `${glyphSize * 1.8}px`,
        height: `${glyphSize * 1.8}px`,
        borderRadius: '50%',
        border: `1.5px solid ${colour}`,
        opacity: '0.3',
        animation: 'ripple 2s ease-out infinite',
        pointerEvents: 'none',
        zIndex: '1',
      })
      ripple.dataset.layer = 'ripple'
      glyphWrapper.appendChild(ripple)
    } else if (ripple) {
      Object.assign(ripple.style, {
        width: `${glyphSize * 1.8}px`,
        height: `${glyphSize * 1.8}px`,
        borderColor: colour,
      })
    }
  } else if (ripple) {
    ripple.remove()
  }

  if (glyphWrapper) {
    Object.assign(glyphWrapper.style, {
      width: `${glyphSize}px`,
      height: `${glyphSize}px`,
      filter: state === 'dormant' ? 'none' : `drop-shadow(0 0 ${glyphSize * 0.25}px ${colour}66)`,
    })
  }

  // Live count badge - reflects the venue's Live_Check_In_Count, updated in
  // place on each `node:pulse_update` without detaching the marker (R18.1).
  let badge = el.querySelector('[data-layer="badge"]') as HTMLElement | null
  if ((state === 'buzzing' || state === 'popping') && liveCount > 0) {
    if (!badge && glyphWrapper) {
      badge = document.createElement('div')
      Object.assign(badge.style, {
        position: 'absolute',
        top: '-6px',
        right: '-6px',
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
      // Pin to the glyph (top of the beam), matching buildMarkerElement.
      glyphWrapper.appendChild(badge)
    }
    if (badge) badge.textContent = liveCount > 99 ? '99+' : String(liveCount)
  } else if (badge) {
    badge.remove()
  }

  const scaleLayerForBeam = (el.querySelector(`[data-layer="${SCALE_LAYER}"]`) as HTMLElement | null) ?? el
  const beaconStack = ensureBeaconStack(scaleLayerForBeam)
  updateBeamLayers(beaconStack, colour, state, { ...beamOptions, glyphSize })

  applyActiveStyling(el, isActive, colour)
}

export interface MapMarkerExtras {
  is3D?: boolean
  brushedNodeId?: string | null
  onCommitZoom?: (node: Node) => void
}

/** 3D pitch multiplier for Constellation beam height (matches useMapInit). */
const BEAM_PITCH_SCALE_3D = 1.35

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
  extras: MapMarkerExtras = {},
) {
  const { is3D = true, brushedNodeId = null, onCommitZoom } = extras
  const nodes = useMapStore((s) => s.nodes)
  const pulseScores = useMapStore((s) => s.pulseScores)
  const checkInCounts = useMapStore((s) => s.checkInCounts)
  const archetypeIds = useMapStore((s) => s.archetypeIds)
  const hasLiveGets = useMapStore((s) => s.hasLiveGets)
  const consumerArchetypeId = useUserStore((s) => s.user?.archetypeId ?? null)
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map())
  // Per-marker React roots used to render <ArchetypeGlyph> inside each
  // marker. Tracked in parallel with `markersRef` so we can unmount the
  // root when the marker is removed.
  const glyphRootsRef = useRef<Map<string, Root>>(new Map())
  // Keep a stable ref to the latest onNodeTap so marker click handlers are never stale
  const onNodeTapRef = useRef(onNodeTap)
  onNodeTapRef.current = onNodeTap
  const onCommitZoomRef = useRef(onCommitZoom)
  onCommitZoomRef.current = onCommitZoom

  const beamOptionsFor = useCallback(
    (nodeId: string, zoom: number, glyphSize: number): BeamVisualOptions => {
      const node = nodes[nodeId]
      const venueArchetype = archetypeIds[nodeId] ?? node?.defaultArchetypeId ?? null
      const blend = beamBlendForZoom(zoom)
      const tierScale = TIER_SIZE_MULTIPLIER[node?.businessTier ?? 'starter']
      return {
        pitchScale: is3D ? BEAM_PITCH_SCALE_3D : 1,
        tasteMatch: !!(consumerArchetypeId && venueArchetype && consumerArchetypeId === venueArchetype),
        hasLiveGet: !!hasLiveGets[nodeId],
        brushed: brushedNodeId === nodeId,
        hybridStrength: blend < 0.98 ? blend : undefined,
        tierBaseScale: tierScale,
        glyphSize,
      }
    },
    [nodes, archetypeIds, consumerArchetypeId, hasLiveGets, is3D, brushedNodeId],
  )

  // Presentation tier (beam / dot / glyph), driven by live map zoom.
  const [presentationTier, setPresentationTier] = useState<MarkerPresentationTier>('glyph')
  const [mapZoom, setMapZoom] = useState(GLYPH_ZOOM_THRESHOLD)

  // Track zoom and flip presentation tier when crossing thresholds.
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
      setMapZoom(zoom)

      const tier = presentationTierForZoom(zoom)
      const blend = beamBlendForZoom(zoom)
      // Dim non-selected markers whenever a venue is active. The beam tier
      // gates this on `tier === 'beam'` itself; the glyph/dot tiers use it to
      // fade neighbours so the selected glyph stands out in a cluster.
      const dimInactive = activeVenueId !== null

      for (const [nodeId, marker] of markersRef.current) {
        const el = marker.getElement()
        applyZoomScale(el, zoom)
        const isActive = el.dataset.active === 'true'
        const score = useMapStore.getState().pulseScores[nodeId] ?? 0
        const pulseState = getNodeState(score)
        applyPresentationTier(el, tier, isActive, dimInactive, blend, pulseState)

        const node = useMapStore.getState().nodes[nodeId]
        if (node && blend < 0.98) {
          const state = pulseState
          const colour = getCategoryColour(node.category)
          const tierMultiplier = TIER_SIZE_MULTIPLIER[node.businessTier ?? 'starter']
          const glyphSize = getGlyphSize(state, score) * tierMultiplier
          const scaleLayer = el.querySelector(`[data-layer="${SCALE_LAYER}"]`) as HTMLElement | null
          if (scaleLayer) {
            const beaconStack = ensureBeaconStack(scaleLayer)
            updateBeamLayers(beaconStack, colour, state, beamOptionsFor(nodeId, zoom, glyphSize))
          }
        }
      }

      setPresentationTier((prev) => (prev === tier ? prev : tier))
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
  }, [mapRef, mapReady, activeVenueId, beamOptionsFor])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) {
      return
    }

    let cancelled = false

    const addMarkers = () => {
      if (cancelled) return

      let curZoom = GLYPH_ZOOM_THRESHOLD
      try {
        curZoom = map.getZoom()
      } catch {
        /* ignore */
      }

      const tier = presentationTierForZoom(curZoom)
      const beamBlend = beamBlendForZoom(curZoom)
      const showIcon = tier === 'glyph'
      const dimInactive = activeVenueId !== null

      const nodeArray = Object.values(nodes)
      const filtered = categoryFilter ? nodeArray.filter((n) => n.category === categoryFilter) : nodeArray

      const positionFresh = canRecenter(useLocationStore.getState().capturedAt, Date.now())
      const mapState = useMapStore.getState()
      const ranked = vibeRank({
        venues: filtered,
        pulseScores: mapState.pulseScores,
        checkInCounts: mapState.checkInCounts,
        lastKnownPosition: useLocationStore.getState().lastKnownPosition,
        positionFresh,
        consumerArchetypeId: useUserStore.getState().user?.archetypeId ?? null,
        venueArchetypeIds: mapState.archetypeIds,
        friendsAtVenue: mapState.friendsAtVenue,
        hasLiveGets: mapState.hasLiveGets,
      })
      const beamCap = constellationVisibleIds(ranked, curZoom, activeVenueId, pulseScores)

      const filteredIds = new Set(filtered.filter((n) => beamCap === null || beamCap.has(n.id)).map((n) => n.id))

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
        if (beamCap !== null && !beamCap.has(node.id)) continue

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
          updateMarkerElement(
            existing.getElement(),
            glyphSize,
            colour,
            state,
            liveCount,
            active,
            beamOptionsFor(node.id, curZoom, glyphSize),
          )
          renderGlyph(
            glyphRootsRef.current,
            existing.getElement(),
            node.id,
            archetypeId,
            state,
            node.category,
            showIcon,
          )
          applyPresentationTier(existing.getElement(), tier, active, dimInactive, beamBlend, state)
          applyZoomScale(existing.getElement(), curZoom)
          continue
        }

        const el = buildMarkerElement(
          node,
          glyphSize,
          colour,
          state,
          liveCount,
          active,
          () => onNodeTapRef.current(node),
          beamOptionsFor(node.id, curZoom, glyphSize),
          () => onCommitZoomRef.current?.(node),
        )

        const marker = new mapboxgl.Marker({
          element: el,
          anchor: 'bottom',
          // 'horizon' keeps the marker oriented relative to the globe's
          // horizon during bearing drift. Without this, markers can appear
          // to spin or drift visually as the globe rotates.
          rotationAlignment: 'horizon' as mapboxgl.MarkerOptions['rotationAlignment'],
        })
          .setLngLat([node.lng, node.lat])
          .addTo(map)

        applyZoomScale(el, curZoom)
        applyPresentationTier(el, tier, active, dimInactive, beamBlend, state)

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
  }, [
    nodes,
    pulseScores,
    checkInCounts,
    archetypeIds,
    categoryFilter,
    activeVenueId,
    mapRef,
    mapReady,
    presentationTier,
    mapZoom,
    is3D,
    brushedNodeId,
    hasLiveGets,
    consumerArchetypeId,
    beamOptionsFor,
  ])

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
