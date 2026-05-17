import { createElement, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import mapboxgl from 'mapbox-gl'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import type { Node, NodeCategory, NodeState } from '@area-code/shared/types'
import { getNodeState, getCategoryColour } from '../lib/mapHelpers'
import { ArchetypeGlyph } from '../components/ArchetypeGlyph'

/**
 * Default Live_Archetype id used while no live value has arrived for a
 * node and the node has no `defaultArchetypeId`. Mirrors R7.8's
 * eclectic-fallback rule on the rendering side, so the glyph is never
 * blank.
 */
const DEFAULT_ARCHETYPE_ID = 'archetype-eclectic'

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
  score: number,
  onTap: () => void,
): HTMLDivElement {
  void node
  const cfg = STATE_CONFIG[state]
  // Container holds the halo, the optional ripple ring, the glyph mount,
  // and the optional live-count badge. Sized off the glyph so the halo
  // can extend past the silhouette on every Pulse_State.
  const totalSize = glyphSize * 3
  const container = document.createElement('div')
  container.className = 'node-marker'
  Object.assign(container.style, {
    width: `${totalSize}px`,
    height: `${totalSize}px`,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    overflow: 'visible',
    pointerEvents: 'none',
  })

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
  container.appendChild(halo)

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
    container.appendChild(ripple)
  }

  // ── Glyph wrapper (the marker itself) ──
  // Owns the breathe / pulse animation that the old core dot used to
  // own, so the glyph's scale curve drives identity + alive-ness in one
  // element. Tap target is here — the glyph silhouette is what the user
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
    // glow per se — the halo handles glow. This is just edge separation.
    filter: state === 'dormant' ? 'none' : `drop-shadow(0 0 ${glyphSize * 0.25}px ${colour}66)`,
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
  container.appendChild(glyphWrapper)

  // ── Live count badge (buzzing / popping only) ──
  if ((state === 'buzzing' || state === 'popping') && score > 0) {
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
    badge.textContent = score > 99 ? '99+' : String(score)
    badge.dataset.layer = 'badge'
    container.appendChild(badge)
  }

  return container
}

function updateMarkerElement(
  el: HTMLElement,
  glyphSize: number,
  colour: string,
  state: NodeState,
  score: number,
): void {
  const cfg = STATE_CONFIG[state]
  const totalSize = glyphSize * 3
  el.style.width = `${totalSize}px`
  el.style.height = `${totalSize}px`

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

  // Ripple — add when entering popping, remove otherwise.
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
      const glyphWrapper = el.querySelector('[data-layer="glyph-wrapper"]')
      if (glyphWrapper) {
        el.insertBefore(ripple, glyphWrapper)
      } else {
        el.appendChild(ripple)
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

  // Live count badge
  let badge = el.querySelector('[data-layer="badge"]') as HTMLElement | null
  if ((state === 'buzzing' || state === 'popping') && score > 0) {
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
      el.appendChild(badge)
    }
    badge.textContent = score > 99 ? '99+' : String(score)
  } else if (badge) {
    badge.remove()
  }
}

/**
 * Manages Mapbox markers for nodes. The marker is the Archetype_Glyph
 * itself — there is no longer a coloured core circle. Halo carries
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
) {
  const nodes = useMapStore((s) => s.nodes)
  const pulseScores = useMapStore((s) => s.pulseScores)
  const archetypeIds = useMapStore((s) => s.archetypeIds)
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map())
  // Per-marker React roots used to render <ArchetypeGlyph> inside each
  // marker. Tracked in parallel with `markersRef` so we can unmount the
  // root when the marker is removed.
  const glyphRootsRef = useRef<Map<string, Root>>(new Map())
  // Keep a stable ref to the latest onNodeTap so marker click handlers are never stale
  const onNodeTapRef = useRef(onNodeTap)
  onNodeTapRef.current = onNodeTap

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
        const glyphSize = getGlyphSize(state, score)
        const colour = getCategoryColour(node.category)
        const existing = markersRef.current.get(node.id)
        // R7.8 / R8 fallback ladder: live archetype id from the store
        // (populated by `node:archetype_change`), then the node's
        // configured default, then the eclectic fallback.
        const archetypeId = archetypeIds[node.id] ?? node.defaultArchetypeId ?? DEFAULT_ARCHETYPE_ID

        if (existing) {
          existing.setLngLat([node.lng, node.lat])
          updateMarkerElement(existing.getElement(), glyphSize, colour, state, score)
          renderGlyph(glyphRootsRef.current, existing.getElement(), node.id, archetypeId, state, node.category)
          continue
        }

        const el = buildMarkerElement(node, glyphSize, colour, state, score, () => {
          onNodeTapRef.current(node)
        })

        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([node.lng, node.lat]).addTo(map)

        markersRef.current.set(node.id, marker)
        renderGlyph(glyphRootsRef.current, el, node.id, archetypeId, state, node.category)
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
  }, [nodes, pulseScores, archetypeIds, categoryFilter, mapRef, mapReady])

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
 * Mount or update the ArchetypeGlyph React subtree for a marker's
 * glyph host. The glyph is now the marker (no flag gate) — what the
 * `live_vibe_on_map` flag still gates is the live `node:archetype_change`
 * subscription in `MapScreen`, which controls how often the
 * `archetypeIds` cache updates. While the flag is off, the glyph still
 * renders using `defaultArchetypeId ?? 'archetype-eclectic'`.
 */
function renderGlyph(
  roots: Map<string, Root>,
  markerEl: HTMLElement,
  nodeId: string,
  archetypeId: string,
  state: NodeState,
  category: NodeCategory,
): void {
  const host = markerEl.querySelector(`[data-layer="${GLYPH_HOST_LAYER}"]`) as HTMLElement | null
  if (!host) return

  let root = roots.get(nodeId)
  if (!root) {
    root = createRoot(host)
    roots.set(nodeId, root)
  }
  root.render(
    createElement(ArchetypeGlyph, {
      archetypeId,
      pulseState: state,
      category,
    }),
  )
}
