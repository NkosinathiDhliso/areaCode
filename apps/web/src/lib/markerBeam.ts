/**
 * Constellation beam DOM: vertical light pillars at country zoom.
 */

import type { NodeState } from '@area-code/shared/types'

import { BEAM_HIT_WIDTH_PX } from './carouselConstants'
import type { MarkerPresentationTier } from './markerPresentation'

export const BEAM_COLUMN_LAYER = 'beam-column'
export const BEAM_HIT_LAYER = 'beam-hit'

/** Optional Constellation beam embellishments (Phase D/E). */
export interface BeamVisualOptions {
  /** 3D pitch scales pillar height; flat map uses 1. */
  pitchScale?: number
  /** Consumer taste matches venue live archetype. */
  tasteMatch?: boolean
  /** Venue has a live event/offer get. */
  hasLiveGet?: boolean
  /** Finger sweep proximity brighten. */
  brushed?: boolean
}

/** Pillar height (px) by Pulse_State — aliveness only, not business tier. */
const BEAM_HEIGHT: Record<NodeState, number> = {
  dormant: 62,
  quiet: 78,
  active: 98,
  buzzing: 128,
  popping: 158,
}

function scaledBeamHeight(state: NodeState, pitchScale: number): number {
  return Math.round(BEAM_HEIGHT[state] * pitchScale)
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

function applyBeamEmbellishments(
  hit: HTMLElement,
  colour: string,
  options: BeamVisualOptions,
  reducedMotion: boolean,
): void {
  let aurora = hit.querySelector('[data-layer="beam-aurora"]') as HTMLElement | null
  if (options.tasteMatch) {
    if (!aurora) {
      aurora = document.createElement('div')
      aurora.dataset.layer = 'beam-aurora'
      hit.appendChild(aurora)
    }
    Object.assign(aurora.style, {
      position: 'absolute',
      bottom: '0',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '14px',
      height: '100%',
      borderRadius: '9999px',
      background: `linear-gradient(to top, transparent, ${colour}55, transparent)`,
      filter: 'blur(4px)',
      pointerEvents: 'none',
      opacity: '0.85',
    })
  } else if (aurora) {
    aurora.remove()
  }

  let comet = hit.querySelector('[data-layer="beam-comet"]') as HTMLElement | null
  if (options.hasLiveGet) {
    if (!comet) {
      comet = document.createElement('div')
      comet.dataset.layer = 'beam-comet'
      hit.appendChild(comet)
    }
    Object.assign(comet.style, {
      position: 'absolute',
      top: '4px',
      left: '50%',
      width: '2px',
      height: '18px',
      transform: 'translateX(-50%) rotate(-25deg)',
      background: `linear-gradient(to bottom, #fff, ${colour})`,
      borderRadius: '9999px',
      opacity: '0.9',
      pointerEvents: 'none',
      animation: reducedMotion ? 'none' : 'pulse 0.6s ease-in-out infinite',
    })
  } else if (comet) {
    comet.remove()
  }

  if (options.brushed) {
    hit.style.filter = 'brightness(1.35)'
  } else {
    hit.style.filter = ''
  }
}

function resolveBeamOpacity(state: NodeState, options?: BeamVisualOptions): number {
  let opacity = BEAM_OPACITY[state]
  if (options?.brushed) opacity = Math.min(1, opacity + 0.2)
  return opacity
}

/**
 * Append the beam column and hit target inside {@link scaleLayer}.
 * Idempotent if layers already exist.
 */
export function ensureBeamLayers(
  scaleLayer: HTMLElement,
  colour: string,
  state: NodeState,
  onTap: () => void,
  options: BeamVisualOptions = {},
): void {
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

  const pitchScale = options.pitchScale ?? 1
  const beamH = scaledBeamHeight(state, pitchScale)
  const opacity = resolveBeamOpacity(state, options)
  const anim = BEAM_ANIM[state]
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

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
    width: '10px',
    height: `${beamH}px`,
    borderRadius: '9999px',
    background: beamGradient(colour),
    opacity: String(opacity),
    boxShadow: `0 0 12px ${colour}66, 0 0 24px ${colour}33`,
    pointerEvents: 'none',
    transformOrigin: 'bottom center',
    animation: reducedMotion ? 'none' : `${anim.animation} ${anim.speed} ease-in-out infinite`,
  })

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

  applyBeamEmbellishments(hit, colour, options, reducedMotion)
}

export function updateBeamLayers(
  scaleLayer: HTMLElement,
  colour: string,
  state: NodeState,
  options: BeamVisualOptions = {},
): void {
  const hit = scaleLayer.querySelector(`[data-layer="${BEAM_HIT_LAYER}"]`) as HTMLElement | null
  if (!hit) return
  const column = hit.querySelector(`[data-layer="${BEAM_COLUMN_LAYER}"]`) as HTMLElement | null
  const glow = hit.querySelector('[data-layer="beam-glow"]') as HTMLElement | null
  const pitchScale = options.pitchScale ?? 1
  const beamH = scaledBeamHeight(state, pitchScale)
  const opacity = resolveBeamOpacity(state, options)
  const anim = BEAM_ANIM[state]
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  Object.assign(hit.style, { height: `${beamH + 8}px` })
  if (column) {
    Object.assign(column.style, {
      height: `${beamH}px`,
      background: beamGradient(colour),
      opacity: String(opacity),
      boxShadow: `0 0 12px ${colour}66, 0 0 24px ${colour}33`,
      animation: reducedMotion ? 'none' : `${anim.animation} ${anim.speed} ease-in-out infinite`,
    })
  }
  if (glow) {
    Object.assign(glow.style, {
      background: `radial-gradient(circle, ${colour} 0%, transparent 70%)`,
      opacity: String(Math.min(1, opacity + 0.15)),
    })
  }
  applyBeamEmbellishments(hit, colour, options, reducedMotion)
}

/**
 * Toggle beam vs glyph/dot visibility. Beams can persist as a hybrid layer at
 * reduced opacity when zoomed in ({@link beamBlend} < 1).
 */
export function applyPresentationTier(
  el: HTMLElement,
  tier: MarkerPresentationTier,
  isActive: boolean,
  dimInactive: boolean,
  beamBlend = 1,
): void {
  const scaleLayer = el.querySelector('[data-layer="scale-layer"]') as HTMLElement | null
  if (!scaleLayer) return

  const beamHit = scaleLayer.querySelector(`[data-layer="${BEAM_HIT_LAYER}"]`) as HTMLElement | null
  const glyphWrapper = scaleLayer.querySelector('[data-layer="glyph-wrapper"]') as HTMLElement | null
  const halo = scaleLayer.querySelector('[data-layer="halo"]') as HTMLElement | null

  const showBeam = beamBlend > 0.02
  const showGlyphDot = tier !== 'beam' || beamBlend < 0.98

  if (beamHit) {
    beamHit.style.display = showBeam ? 'flex' : 'none'
    let beamOpacity = beamBlend
    if (tier === 'beam' && dimInactive && !isActive) beamOpacity *= 0.4
    beamHit.style.opacity = String(beamOpacity)
    // Decorative beams when zoomed in — glyph/dot owns taps.
    beamHit.style.pointerEvents = tier === 'beam' && beamBlend >= 0.85 ? 'auto' : 'none'
  }
  if (glyphWrapper) {
    const glyphOpacity = tier === 'beam' ? Math.min(1, Math.max(0, 1 - beamBlend)) : 1
    glyphWrapper.style.opacity = String(glyphOpacity)
    glyphWrapper.style.pointerEvents = showGlyphDot && glyphOpacity > 0.15 ? 'auto' : 'none'
  }
  if (halo) {
    halo.style.display = showGlyphDot ? 'block' : 'none'
  }

  scaleLayer.style.opacity = '1'
}
