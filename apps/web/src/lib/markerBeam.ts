/**
 * Constellation beam DOM: inverted cone — tip at venue, wide mouth under glyph.
 */

import type { NodeState } from '@area-code/shared/types'

import { BEAM_HIT_WIDTH_PX } from './carouselConstants'
import type { MarkerPresentationTier } from './markerPresentation'

export const BEACON_STACK = 'beacon-stack'
export const BEAM_COLUMN_LAYER = 'beam-cone'
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
  /** Beam blend when hybrid with glyphs (0–1); boosts glow when < 1. */
  hybridStrength?: number
  /** Business tier footprint scale (width only, never opacity). */
  tierBaseScale?: number
  /** Glyph diameter for apex connector sizing. */
  glyphSize?: number
}

/** Pillar height (px) by Pulse_State — aliveness only, not business tier. */
const BEAM_HEIGHT: Record<NodeState, number> = {
  dormant: 62,
  quiet: 78,
  active: 98,
  buzzing: 128,
  popping: 158,
}

/** Cone top width (px) by Pulse_State before tier multiplier — wide mouth under glyph. */
const CONE_TOP: Record<NodeState, number> = {
  dormant: 26,
  quiet: 34,
  active: 46,
  buzzing: 62,
  popping: 82,
}

/** Wide at top (glyph), tip pinned to venue coordinate at bottom. */
const CONE_CLIP = 'polygon(4% 0%, 96% 0%, 50% 100%)'

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

function scaledBeamHeight(state: NodeState, pitchScale: number): number {
  return Math.round(BEAM_HEIGHT[state] * pitchScale)
}

function coneTopWidth(state: NodeState, tierScale: number, hybrid: boolean): number {
  const top = CONE_TOP[state] * tierScale * (hybrid ? 1.08 : 1)
  return Math.round(top)
}

function beamGradient(colour: string): string {
  // Bright at the venue tip (bottom), dissipating upward toward the glyph.
  return [
    `linear-gradient(to top,`,
    `${colour} 0%,`,
    `${colour}ee 6%,`,
    `${colour}cc 18%,`,
    `${colour}88 38%,`,
    `${colour}44 62%,`,
    `${colour}18 85%,`,
    `transparent 100%)`,
  ].join(' ')
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function animationForState(state: NodeState): string {
  const anim = BEAM_ANIM[state]
  return prefersReducedMotion() ? 'none' : `${anim.animation} ${anim.speed} ease-in-out infinite`
}

export function beamHeightForState(state: NodeState): number {
  return BEAM_HEIGHT[state]
}

/** Container size for a Constellation marker (wide hit column + tall beam + glyph). */
export function beamContainerSize(state: NodeState, tierScale = 1, glyphSize = 0): { width: number; height: number } {
  const beamH = beamHeightForState(state)
  const baseW = coneTopWidth(state, tierScale, false)
  return {
    width: Math.max(BEAM_HIT_WIDTH_PX, baseW + 8, glyphSize * 1.2),
    height: beamH + glyphSize + 12,
  }
}

/** Vertical stack that connects ground cone to glyph apex. */
export function ensureBeaconStack(scaleLayer: HTMLElement): HTMLElement {
  let stack = scaleLayer.querySelector(`[data-layer="${BEACON_STACK}"]`) as HTMLElement | null
  if (!stack) {
    stack = document.createElement('div')
    stack.dataset.layer = BEACON_STACK
    Object.assign(stack.style, {
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'flex-end',
      pointerEvents: 'none',
    })
    scaleLayer.appendChild(stack)
  }
  return stack
}

function applyBeamEmbellishments(
  hit: HTMLElement,
  colour: string,
  beamH: number,
  options: BeamVisualOptions,
  reducedMotion: boolean,
): void {
  let aurora = hit.querySelector('[data-layer="beam-aurora"]') as HTMLElement | null
  if (options.tasteMatch) {
    if (!aurora) {
      aurora = document.createElement('div')
      aurora.dataset.layer = 'beam-aurora'
      const cone = hit.querySelector(`[data-layer="${BEAM_COLUMN_LAYER}"]`)
      if (cone) hit.insertBefore(aurora, cone)
      else hit.appendChild(aurora)
    }
    Object.assign(aurora.style, {
      position: 'absolute',
      bottom: '6px',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '85%',
      height: `${beamH}px`,
      clipPath: CONE_CLIP,
      background: `linear-gradient(to top, transparent, ${colour}66, ${colour}44, transparent)`,
      filter: 'blur(3px)',
      pointerEvents: 'none',
      opacity: '0.9',
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
      top: '0',
      left: '50%',
      width: '3px',
      height: '20px',
      transform: 'translateX(-50%) rotate(-20deg)',
      background: `linear-gradient(to bottom, #fff, ${colour})`,
      borderRadius: '9999px',
      opacity: '0.95',
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

function applyConeStyles(
  cone: HTMLElement,
  colour: string,
  beamH: number,
  topW: number,
  opacity: number,
  hybrid: boolean,
): void {
  Object.assign(cone.style, {
    width: `${topW}px`,
    height: `${beamH}px`,
    clipPath: CONE_CLIP,
    background: beamGradient(colour),
    opacity: String(Math.min(1, opacity)),
    boxShadow: hybrid ? `0 0 14px ${colour}77, 0 0 28px ${colour}33` : `0 0 10px ${colour}55, 0 0 20px ${colour}22`,
    pointerEvents: 'none',
    transformOrigin: 'bottom center',
    animation: 'none',
    flexShrink: '0',
  })
}

/** Soft glow at the wide cone mouth where the glyph sits. */
function ensureMouthConnector(
  hit: HTMLElement,
  colour: string,
  topW: number,
  glyphSize: number,
  opacity: number,
): void {
  let mouth = hit.querySelector('[data-layer="beam-apex"]') as HTMLElement | null
  if (!mouth) {
    mouth = document.createElement('div')
    mouth.dataset.layer = 'beam-apex'
    hit.appendChild(mouth)
  }
  const w = Math.max(topW * 0.92, glyphSize * 0.72)
  const h = Math.max(8, Math.round(glyphSize * 0.22))
  Object.assign(mouth.style, {
    position: 'absolute',
    top: `${-Math.round(h * 0.35)}px`,
    left: '50%',
    transform: 'translateX(-50%)',
    width: `${w}px`,
    height: `${h}px`,
    borderRadius: '50%',
    background: `radial-gradient(ellipse, ${colour}cc 0%, ${colour}66 45%, transparent 72%)`,
    opacity: String(Math.min(1, opacity + 0.08)),
    pointerEvents: 'none',
    filter: `blur(${Math.max(1, h * 0.12)}px)`,
  })
}

function resolveBeamOpacity(state: NodeState, options?: BeamVisualOptions): number {
  let opacity = BEAM_OPACITY[state]
  if (options?.brushed) opacity = Math.min(1, opacity + 0.2)
  return opacity
}

/**
 * Append the cone beam and hit target inside {@link stackParent}.
 * Idempotent if layers already exist.
 */
export function ensureBeamLayers(
  stackParent: HTMLElement,
  colour: string,
  state: NodeState,
  onTap: () => void,
  options: BeamVisualOptions = {},
): void {
  let hit = stackParent.querySelector(`[data-layer="${BEAM_HIT_LAYER}"]`) as HTMLElement | null
  if (!hit) {
    hit = document.createElement('div')
    hit.dataset.layer = BEAM_HIT_LAYER
    hit.addEventListener('mousedown', (e) => e.stopPropagation())
    hit.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true })
    hit.addEventListener('click', (e) => {
      e.stopPropagation()
      onTap()
    })
    stackParent.insertBefore(hit, stackParent.firstChild)
  }

  let cone = hit.querySelector(`[data-layer="${BEAM_COLUMN_LAYER}"]`) as HTMLElement | null
  if (!cone) {
    cone = document.createElement('div')
    cone.dataset.layer = BEAM_COLUMN_LAYER
    cone.setAttribute('aria-hidden', 'true')
    hit.appendChild(cone)
  }

  const pitchScale = options.pitchScale ?? 1
  const tierScale = options.tierBaseScale ?? 1
  const hybrid = options.hybridStrength !== undefined && options.hybridStrength < 0.98
  const beamH = scaledBeamHeight(state, pitchScale * (hybrid ? 1.12 : 1))
  const topW = coneTopWidth(state, tierScale, hybrid)
  const opacity = resolveBeamOpacity(state, options) * (hybrid ? 1.08 : 1)
  const glyphSize = options.glyphSize ?? 24
  const reducedMotion = prefersReducedMotion()

  Object.assign(hit.style, {
    position: 'relative',
    width: `${Math.max(BEAM_HIT_WIDTH_PX, topW + 12)}px`,
    height: `${beamH + 6}px`,
    cursor: 'pointer',
    pointerEvents: 'auto',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexShrink: '0',
  })

  applyConeStyles(cone, colour, beamH, topW, opacity, hybrid)

  let glow = hit.querySelector('[data-layer="beam-glow"]') as HTMLElement | null
  if (!glow) {
    glow = document.createElement('div')
    glow.dataset.layer = 'beam-glow'
    hit.insertBefore(glow, cone)
  }
  const tipGlowPx = Math.max(8, Math.round(topW * 0.22))
  Object.assign(glow.style, {
    position: 'absolute',
    bottom: '0',
    left: '50%',
    transform: 'translate(-50%, 50%)',
    width: `${tipGlowPx}px`,
    height: `${tipGlowPx}px`,
    borderRadius: '50%',
    background: `radial-gradient(circle, ${colour} 0%, ${colour}aa 35%, transparent 70%)`,
    opacity: String(Math.min(1, opacity + 0.18)),
    pointerEvents: 'none',
  })

  ensureMouthConnector(hit, colour, topW, glyphSize, opacity)
  applyBeamEmbellishments(hit, colour, beamH, options, reducedMotion)
}

export function updateBeamLayers(
  stackParent: HTMLElement,
  colour: string,
  state: NodeState,
  options: BeamVisualOptions = {},
): void {
  const hit = stackParent.querySelector(`[data-layer="${BEAM_HIT_LAYER}"]`) as HTMLElement | null
  if (!hit) return
  const cone = hit.querySelector(`[data-layer="${BEAM_COLUMN_LAYER}"]`) as HTMLElement | null
  const glow = hit.querySelector('[data-layer="beam-glow"]') as HTMLElement | null
  const pitchScale = options.pitchScale ?? 1
  const tierScale = options.tierBaseScale ?? 1
  const hybrid = options.hybridStrength !== undefined && options.hybridStrength < 0.98
  const beamH = scaledBeamHeight(state, pitchScale * (hybrid ? 1.12 : 1))
  const topW = coneTopWidth(state, tierScale, hybrid)
  const opacity = resolveBeamOpacity(state, options) * (hybrid ? 1.08 : 1)
  const glyphSize = options.glyphSize ?? 24
  const reducedMotion = prefersReducedMotion()

  Object.assign(hit.style, {
    width: `${Math.max(BEAM_HIT_WIDTH_PX, topW + 12)}px`,
    height: `${beamH + 6}px`,
  })
  if (cone) applyConeStyles(cone, colour, beamH, topW, opacity, hybrid)
  if (glow) {
    const tipGlowPx = Math.max(8, Math.round(topW * 0.22))
    Object.assign(glow.style, {
      width: `${tipGlowPx}px`,
      height: `${tipGlowPx}px`,
      background: `radial-gradient(circle, ${colour} 0%, ${colour}aa 35%, transparent 70%)`,
      opacity: String(Math.min(1, opacity + 0.18)),
    })
  }
  ensureMouthConnector(hit, colour, topW, glyphSize, opacity)
  applyBeamEmbellishments(hit, colour, beamH, options, reducedMotion)
}

/** Pulse the glyph and cone together when beams are visible. */
export function syncBeaconAnimation(scaleLayer: HTMLElement, state: NodeState, beamVisible: boolean): void {
  const stack = scaleLayer.querySelector(`[data-layer="${BEACON_STACK}"]`) as HTMLElement | null
  const glyph = scaleLayer.querySelector('[data-layer="glyph-wrapper"]') as HTMLElement | null
  const halo = scaleLayer.querySelector('[data-layer="halo"]') as HTMLElement | null
  if (!stack || !glyph) return

  const anim = animationForState(state)
  if (beamVisible) {
    Object.assign(stack.style, { animation: anim, transformOrigin: 'bottom center' })
    glyph.style.animation = 'none'
    if (halo) halo.style.animation = 'none'
  } else {
    stack.style.animation = 'none'
    glyph.style.animation = anim
    if (halo) halo.style.animation = anim
  }
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
  pulseState: NodeState = 'active',
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
    beamHit.style.pointerEvents = tier === 'beam' && beamBlend >= 0.85 ? 'auto' : 'none'
  }
  if (glyphWrapper) {
    const glyphOpacity = tier === 'beam' ? Math.min(1, Math.max(0, 1 - beamBlend)) : 1
    glyphWrapper.style.opacity = String(glyphOpacity)
    glyphWrapper.style.pointerEvents = showGlyphDot && glyphOpacity > 0.15 ? 'auto' : 'none'
  }
  if (halo) {
    const showHalo = showGlyphDot || (showBeam && beamBlend < 0.98)
    halo.style.display = showHalo ? 'block' : 'none'
    if (showBeam && beamBlend < 0.98) {
      halo.style.opacity = String(Math.min(0.55, beamBlend * 0.7))
    }
  }

  syncBeaconAnimation(scaleLayer, pulseState, showBeam && beamBlend > 0.15)
  scaleLayer.style.opacity = '1'
}
