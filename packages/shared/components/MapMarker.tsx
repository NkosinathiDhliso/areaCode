/**
 * Dynamic Map Marker component with pulse-based sizing, animations, and z-ordering.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 30.4
 */
import { useMemo } from 'react'

import { computeMarkerStyle } from '../lib/markerUtils'
import type { NodeCategory } from '../types'

export interface MapMarkerProps {
  /** Pulse score (0+) */
  pulseScore: number
  /** ISO timestamp when boost expires, or null */
  boostUntil: string | null
  /** Node category for color */
  category: NodeCategory
  /** Whether marker is in the visible viewport */
  isInViewport: boolean
  /** Whether the animation budget is exhausted */
  animationBudgetExhausted: boolean
  /** User prefers reduced motion */
  prefersReducedMotion: boolean
  /** Whether device is low-end (hardwareConcurrency <= 4) */
  isLowEndDevice: boolean
  /** Click handler */
  onClick?: () => void
  /** Accessible label */
  label?: string
}

const categoryColorVar: Record<NodeCategory, string> = {
  food: 'var(--node-food)',
  coffee: 'var(--node-coffee)',
  nightlife: 'var(--node-nightlife)',
  retail: 'var(--node-retail)',
  fitness: 'var(--node-fitness)',
  arts: 'var(--node-arts)',
}

const categoryGlowVar: Record<NodeCategory, string> = {
  food: 'var(--node-food-glow)',
  coffee: 'var(--node-coffee-glow)',
  nightlife: 'var(--node-nightlife-glow)',
  retail: 'var(--node-retail-glow)',
  fitness: 'var(--node-fitness-glow)',
  arts: 'var(--node-arts-glow)',
}

export function MapMarker({
  pulseScore,
  boostUntil,
  category,
  isInViewport,
  animationBudgetExhausted,
  prefersReducedMotion,
  isLowEndDevice,
  onClick,
  label,
}: MapMarkerProps) {
  const isBoosted = boostUntil != null && new Date(boostUntil).getTime() > Date.now()

  const style = useMemo(
    () => computeMarkerStyle(
      pulseScore,
      isBoosted,
      isInViewport,
      animationBudgetExhausted,
      prefersReducedMotion,
    ),
    [pulseScore, isBoosted, isInViewport, animationBudgetExhausted, prefersReducedMotion],
  )

  const color = categoryColorVar[category]
  const glowColor = categoryGlowVar[category]
  const diameter = style.radius * 2

  // Build animation class
  let animationClass = ''
  if (style.hasAnimation) {
    if (style.animationType === 'breathing') {
      animationClass = 'animate-marker-breathe'
    } else if (style.animationType === 'pulsing') {
      animationClass = 'animate-marker-pulse'
    }
  }

  // Glow shadow (disabled on low-end devices)
  const glowShadow = !isLowEndDevice && style.glowIntensity > 0
    ? `0 0 ${8 + style.glowIntensity * 12}px ${glowColor}`
    : 'none'

  return (
    <button
      onClick={onClick}
      className={`absolute flex items-center justify-center ${animationClass}`}
      style={{
        width: `${style.touchTarget}px`,
        height: `${style.touchTarget}px`,
        zIndex: style.zIndex,
        transform: 'translate(-50%, -50%)',
      }}
      aria-label={label ?? `Venue marker, activity level ${pulseScore}`}
      type="button"
    >
      {/* Gold ring for boosted markers */}
      {style.hasGoldRing && (
        <div
          className="absolute rounded-full border-2"
          style={{
            width: `${diameter + 6}px`,
            height: `${diameter + 6}px`,
            borderColor: 'var(--color-boost-gold)',
            boxShadow: `0 0 8px var(--color-boost-glow)`,
          }}
        />
      )}

      {/* Main marker circle */}
      <div
        className="rounded-full"
        style={{
          width: `${diameter}px`,
          height: `${diameter}px`,
          backgroundColor: color,
          boxShadow: glowShadow,
        }}
      />
    </button>
  )
}
