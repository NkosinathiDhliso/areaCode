/**
 * Constellation beam DOM: vertical light pillars at country zoom.
 */

import type { NodeState } from '@area-code/shared/types'

import { BEAM_HIT_WIDTH_PX } from './carouselConstants'
import type { MarkerPresentationTier } from './markerPresentation'

export const BEAM_COLUMN_LAYER = 'beam-column'
export const BEAM_HIT_LAYER = 'beam-hit'

/** Pillar height (px) by Pulse_State — aliveness only, not business tier. */
const BEAM_HEIGHT: Record<NodeState, number> = {
  dormant: 44,
  quiet: 56,
  active: 72,
  buzzing: 92,
  popping: 112,
}

const BEAM_ANIM: Record<NodeState, { animation: string; speed: string }> = {
  dormant: { animation: 'breathe', speed: '4s' },
  quiet: { animation: 'breathe', speed: '3s' },
  active: { animation: 'pulse', speed: '1.5s' },
  buzzing: { animation: 'pulse', speed: '0.8s' },
  popping: { animation: 'pulse', speed: '0.4s' },
}

const BEAM_OPACITY: Record<NodeState, number> = {
  dormant: 0.35,
  quiet: 0.5,
  active: 0.65,
  buzzing: 0.8,
  popping: 0.95,
}

export function beamHeightForState(state: NodeState): number {
  return BEAM_HEIGHT[state]
}

/** Container size for a Constellation marker (wide hit column + tall beam). */
export function beamContainerSize(state: NodeState): { width: number; height: number } {
  const beamH = beamHeightForState(state)
  return { width: BEAM_HIT_WIDTH_PX, height: beamH + 16 }
}

function beamGradient(colour: string): string {
  return `linear-gradient(to top, ${colour} 0%, ${colour}88 18%, ${colour}33 55%, transparent 100%)`
}

/**
 * Append the beam column and hit target inside {@link scaleLayer}.
 * Idempotent if layers already exist.
 */
export function ensureBeamLayers(scaleLayer: HTMLElement, colour: string, state: NodeState, onTap: () => void): void {
  let hit = scaleLayer.querySelector(`[data-layer="${BEAM_HIT_LAYER}"]`) as HTMLElement | null
  if (!hit) {
    hit = document.createElement('div')
    hit.dataset.layer = BEAM_HIT_LAYER
    hit.addEventListener('mousedown', (e) => e.stopPropagation())
    hit.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true })
    hit.addEventListener('click', (e) => {
      e.stopPropagation()
      onTap()
    })
    scaleLayer.appendChild(hit)
  }

  let column = scaleLayer.querySelector(`[data-layer="${BEAM_COLUMN_LAYER}"]`) as HTMLElement | null
  if (!column) {
    column = document.createElement('div')
    column.dataset.layer = BEAM_COLUMN_LAYER
    column.setAttribute('aria-hidden', 'true')
    hit.appendChild(column)
  }

  const beamH = beamHeightForState(state)
  const opacity = BEAM_OPACITY[state]
  const anim = BEAM_ANIM[state]

  Object.assign(hit.style, {
    position: 'absolute',
    left: '50%',
    bottom: '0',
    transform: 'translateX(-50%)',
    width: `${BEAM_HIT_WIDTH_PX}px`,
    height: `${beamH + 8}px`,
    cursor: 'pointer',
    pointerEvents: 'auto',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
  })

  Object.assign(column.style, {
    width: '8px',
    height: `${beamH}px`,
    borderRadius: '9999px',
    background: beamGradient(colour),
    opacity: String(opacity),
    boxShadow: `0 0 12px ${colour}66, 0 0 24px ${colour}33`,
    pointerEvents: 'none',
    transformOrigin: 'bottom center',
    animation: `${anim.animation} ${anim.speed} ease-in-out infinite`,
  })

  // Ground glow at the anchor point.
  let glow = hit.querySelector('[data-layer="beam-glow"]') as HTMLElement | null
  if (!glow) {
    glow = document.createElement('div')
    glow.dataset.layer = 'beam-glow'
    hit.insertBefore(glow, column)
  }
  Object.assign(glow.style, {
    position: 'absolute',
    bottom: '0',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    background: `radial-gradient(circle, ${colour} 0%, transparent 70%)`,
    opacity: String(Math.min(1, opacity + 0.15)),
    pointerEvents: 'none',
  })
}

export function updateBeamLayers(scaleLayer: HTMLElement, colour: string, state: NodeState): void {
  const hit = scaleLayer.querySelector(`[data-layer="${BEAM_HIT_LAYER}"]`) as HTMLElement | null
  if (!hit) return
  const column = hit.querySelector(`[data-layer="${BEAM_COLUMN_LAYER}"]`) as HTMLElement | null
  const glow = hit.querySelector('[data-layer="beam-glow"]') as HTMLElement | null
  const beamH = beamHeightForState(state)
  const opacity = BEAM_OPACITY[state]
  const anim = BEAM_ANIM[state]

  Object.assign(hit.style, { height: `${beamH + 8}px` })
  if (column) {
    Object.assign(column.style, {
      height: `${beamH}px`,
      background: beamGradient(colour),
      opacity: String(opacity),
      boxShadow: `0 0 12px ${colour}66, 0 0 24px ${colour}33`,
      animation: `${anim.animation} ${anim.speed} ease-in-out infinite`,
    })
  }
  if (glow) {
    Object.assign(glow.style, {
      background: `radial-gradient(circle, ${colour} 0%, transparent 70%)`,
      opacity: String(Math.min(1, opacity + 0.15)),
    })
  }
}

/**
 * Toggle beam vs glyph/dot visibility and inactive dimming (40% when another
 * venue is active at Constellation zoom).
 */
export function applyPresentationTier(
  el: HTMLElement,
  tier: MarkerPresentationTier,
  isActive: boolean,
  dimInactive: boolean,
): void {
  const scaleLayer = el.querySelector('[data-layer="scale-layer"]') as HTMLElement | null
  if (!scaleLayer) return

  const beamHit = scaleLayer.querySelector(`[data-layer="${BEAM_HIT_LAYER}"]`) as HTMLElement | null
  const glyphWrapper = scaleLayer.querySelector('[data-layer="glyph-wrapper"]') as HTMLElement | null
  const halo = scaleLayer.querySelector('[data-layer="halo"]') as HTMLElement | null

  const showBeam = tier === 'beam'
  const showGlyphDot = tier !== 'beam'

  if (beamHit) {
    beamHit.style.display = showBeam ? 'flex' : 'none'
    beamHit.style.pointerEvents = showBeam ? 'auto' : 'none'
  }
  if (glyphWrapper) {
    glyphWrapper.style.opacity = showGlyphDot ? '1' : '0'
    glyphWrapper.style.pointerEvents = showGlyphDot ? 'auto' : 'none'
  }
  if (halo) {
    halo.style.display = showGlyphDot ? 'block' : 'none'
  }

  let opacity = '1'
  if (tier === 'beam' && dimInactive && !isActive) {
    opacity = '0.4'
  }
  scaleLayer.style.opacity = opacity
}
