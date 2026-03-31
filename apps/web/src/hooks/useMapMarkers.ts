import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import type { Node, NodeCategory, NodeState } from '@area-code/shared/types'
import { getNodeState, getCategoryColour } from '../lib/mapHelpers'

const STATE_CONFIG: Record<NodeState, { animation: string; speed: string; haloOpacity: number; ringOpacity: number }> = {
  dormant: { animation: 'breathe', speed: '4s',   haloOpacity: 0.12, ringOpacity: 0.08 },
  quiet:   { animation: 'breathe', speed: '3s',   haloOpacity: 0.2,  ringOpacity: 0.25 },
  active:  { animation: 'pulse',   speed: '1.5s', haloOpacity: 0.3,  ringOpacity: 0.5 },
  buzzing: { animation: 'pulse',   speed: '0.8s', haloOpacity: 0.4,  ringOpacity: 0.6 },
  popping: { animation: 'pulse',   speed: '0.4s', haloOpacity: 0.5,  ringOpacity: 0.7 },
}

// Bigger base sizes so nodes are actually visible on the map
const CORE_SIZE: Record<NodeState, number> = {
  dormant: 12,
  quiet:   16,
  active:  22,
  buzzing: 30,
  popping: 40,
}

function getCoreSize(state: NodeState, score: number): number {
  const base = CORE_SIZE[state]
  return Math.min(base + score * 0.3, base * 2)
}

function buildMarkerElement(
  node: Node,
  coreSize: number,
  colour: string,
  state: NodeState,
  score: number,
  onTap: () => void,
): HTMLDivElement {
  const cfg = STATE_CONFIG[state]
  // Container must be large enough for the halo + blur spread
  const totalSize = coreSize * 4
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
    // Let clicks on the transparent area pass through to the map
    pointerEvents: 'none',
  })

  // ── Layer 1: Blur halo ──
  const haloSize = coreSize * 2.5
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

  // ── Layer 2: Outer ring(s) ──
  if (state === 'popping') {
    const outerGlow = document.createElement('div')
    Object.assign(outerGlow.style, {
      position: 'absolute',
      width: `${coreSize * 2.2}px`,
      height: `${coreSize * 2.2}px`,
      borderRadius: '50%',
      border: `1.5px solid ${colour}`,
      opacity: '0.3',
      animation: `ripple 2s ease-out infinite`,
      pointerEvents: 'none',
    })
    container.appendChild(outerGlow)
  }

  const ring = document.createElement('div')
  Object.assign(ring.style, {
    position: 'absolute',
    width: `${coreSize * 1.7}px`,
    height: `${coreSize * 1.7}px`,
    borderRadius: '50%',
    border: `2px solid ${colour}`,
    opacity: String(cfg.ringOpacity),
    cursor: 'pointer',
    pointerEvents: 'auto',
  })
  ring.dataset.layer = 'ring'
  ring.addEventListener('mousedown', (e) => e.stopPropagation())
  ring.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true })
  ring.addEventListener('click', (e) => { e.stopPropagation(); onTap() })
  container.appendChild(ring)

  if (state === 'buzzing' || state === 'popping') {
    const innerRing = document.createElement('div')
    Object.assign(innerRing.style, {
      position: 'absolute',
      width: `${coreSize * 1.35}px`,
      height: `${coreSize * 1.35}px`,
      borderRadius: '50%',
      border: `1.5px solid ${colour}`,
      opacity: '0.35',
      pointerEvents: 'none',
    })
    container.appendChild(innerRing)
  }

  // ── Layer 3: Core dot ──
  const core = document.createElement('div')
  const glowSpread = coreSize * 0.5
  Object.assign(core.style, {
    position: 'relative',
    width: `${coreSize}px`,
    height: `${coreSize}px`,
    borderRadius: '50%',
    background: `radial-gradient(circle at 35% 35%, ${colour}ff, ${colour}cc 60%, ${colour}88)`,
    animation: `${cfg.animation} ${cfg.speed} ease-in-out infinite`,
    boxShadow: state === 'dormant'
      ? 'none'
      : `0 0 ${glowSpread}px ${colour}60, 0 0 ${glowSpread * 2}px ${colour}30`,
    cursor: 'pointer',
    pointerEvents: 'auto',
  })
  core.dataset.layer = 'core'
  // Stop mousedown/touchstart so Mapbox doesn't interpret it as a drag
  core.addEventListener('mousedown', (e) => e.stopPropagation())
  core.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true })
  core.addEventListener('click', (e) => { e.stopPropagation(); onTap() })
  container.appendChild(core)

  // ── Layer 4: Live count badge ──
  if ((state === 'buzzing' || state === 'popping') && score > 0) {
    const badge = document.createElement('div')
    Object.assign(badge.style, {
      position: 'absolute',
      top: `${totalSize * 0.15}px`,
      right: `${totalSize * 0.15}px`,
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
  coreSize: number,
  colour: string,
  state: NodeState,
  score: number,
): void {
  const cfg = STATE_CONFIG[state]
  const totalSize = coreSize * 4
  el.style.width = `${totalSize}px`
  el.style.height = `${totalSize}px`

  const haloSize = coreSize * 2.5
  const blurRadius = state === 'popping' ? 16 : state === 'buzzing' ? 12 : 8
  const halo = el.querySelector('[data-layer="halo"]') as HTMLElement | null
  if (halo) {
    Object.assign(halo.style, {
      width: `${haloSize}px`, height: `${haloSize}px`,
      background: `radial-gradient(circle, ${colour} 0%, transparent 70%)`,
      opacity: String(cfg.haloOpacity),
      filter: `blur(${blurRadius}px)`,
      animation: `${cfg.animation} ${cfg.speed} ease-in-out infinite`,
    })
  }

  const ring = el.querySelector('[data-layer="ring"]') as HTMLElement | null
  if (ring) {
    Object.assign(ring.style, {
      width: `${coreSize * 1.7}px`, height: `${coreSize * 1.7}px`,
      borderColor: colour, opacity: String(cfg.ringOpacity),
    })
  }

  const glowSpread = coreSize * 0.5
  const core = el.querySelector('[data-layer="core"]') as HTMLElement | null
  if (core) {
    Object.assign(core.style, {
      width: `${coreSize}px`, height: `${coreSize}px`,
      background: `radial-gradient(circle at 35% 35%, ${colour}ff, ${colour}cc 60%, ${colour}88)`,
      animation: `${cfg.animation} ${cfg.speed} ease-in-out infinite`,
      boxShadow: state === 'dormant' ? 'none'
        : `0 0 ${glowSpread}px ${colour}60, 0 0 ${glowSpread * 2}px ${colour}30`,
    })
  }

  let badge = el.querySelector('[data-layer="badge"]') as HTMLElement | null
  if ((state === 'buzzing' || state === 'popping') && score > 0) {
    if (!badge) {
      badge = document.createElement('div')
      Object.assign(badge.style, {
        position: 'absolute', top: `${totalSize * 0.15}px`, right: `${totalSize * 0.15}px`,
        background: '#1e1e2e', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '9999px', padding: '2px 6px', fontSize: '11px',
        fontWeight: '600', color: '#f0f0f5', lineHeight: '1.3',
        whiteSpace: 'nowrap', pointerEvents: 'none',
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
 * Manages Mapbox markers for nodes. Creates multi-layered animated markers
 * with blur halo, outer ring, core dot, and live count badge.
 */
export function useMapMarkers(
  mapRef: React.RefObject<mapboxgl.Map | null>,
  categoryFilter: NodeCategory | null,
  onNodeTap: (node: Node) => void,
  mapReady = false,
) {
  const nodes = useMapStore((s) => s.nodes)
  const pulseScores = useMapStore((s) => s.pulseScores)
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map())
  // Keep a stable ref to the latest onNodeTap so marker click handlers are never stale
  const onNodeTapRef = useRef(onNodeTap)
  onNodeTapRef.current = onNodeTap

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) {
      return
    }

    let cancelled = false

    // Wait for map style to be loaded before adding markers
    const addMarkers = () => {
      if (cancelled) return

      const nodeArray = Object.values(nodes)
      const filtered = categoryFilter
        ? nodeArray.filter((n) => n.category === categoryFilter)
        : nodeArray

      const filteredIds = new Set(filtered.map((n) => n.id))

      for (const [id, marker] of markersRef.current) {
        if (!filteredIds.has(id)) {
          marker.remove()
          markersRef.current.delete(id)
        }
      }

      for (const node of filtered) {
        const score = pulseScores[node.id] ?? 0
        const state = getNodeState(score)
        const coreSize = getCoreSize(state, score)
        const colour = getCategoryColour(node.category)
        const existing = markersRef.current.get(node.id)

        if (existing) {
          existing.setLngLat([node.lng, node.lat])
          updateMarkerElement(existing.getElement(), coreSize, colour, state, score)
          continue
        }

        const el = buildMarkerElement(node, coreSize, colour, state, score, () => {
          onNodeTapRef.current(node)
        })

        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([node.lng, node.lat])
          .addTo(map)

        markersRef.current.set(node.id, marker)
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
  }, [nodes, pulseScores, categoryFilter, mapRef, mapReady])
}
