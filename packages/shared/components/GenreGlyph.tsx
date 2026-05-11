/**
 * GenreGlyph — Map marker overlay showing genre icon.
 * Handles live vs predicted state, confidence thresholds, and accessibility.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7
 */
import { useState } from 'react'

import type { MusicGenre } from '../types'

// ============================================================================
// Genre Icon Map — emoji-based for lightweight rendering on map markers
// ============================================================================

const GENRE_ICONS: Record<MusicGenre, string> = {
  amapiano: '🎹',
  deep_house: '🎧',
  afrobeats: '🥁',
  hip_hop: '🎤',
  rnb: '🎵',
  kwaito: '🔊',
  gqom: '⚡',
  jazz: '🎷',
  rock: '🎸',
  pop: '🌟',
  gospel: '🙏',
  maskandi: '🪕',
}

const GENRE_LABELS: Record<MusicGenre, string> = {
  amapiano: 'Amapiano',
  deep_house: 'Deep House',
  afrobeats: 'Afrobeats',
  hip_hop: 'Hip Hop',
  rnb: 'R&B',
  kwaito: 'Kwaito',
  gqom: 'Gqom',
  jazz: 'Jazz',
  rock: 'Rock',
  pop: 'Pop',
  gospel: 'Gospel',
  maskandi: 'Maskandi',
}

// ============================================================================
// Constants
// ============================================================================

/** V1 display threshold — below this, no glyph is shown */
const CONFIDENCE_DISPLAY_THRESHOLD = 0.15

/** Low confidence range upper bound — shows "1 report" indicator */
const CONFIDENCE_LOW_THRESHOLD = 0.3

/** Muted opacity for predicted state */
const PREDICTED_OPACITY = 0.5

// ============================================================================
// Component
// ============================================================================

export interface GenreGlyphProps {
  /** The genre to display, or null if no genre available */
  genre: MusicGenre | null
  /** Confidence score (0.0 - 1.0) for the genre signal */
  confidence: number
  /** Whether this is a predicted genre (from taste profile) rather than a live report */
  isPredicted?: boolean
  /** Press handler for the glyph */
  onPress?: () => void
}

export function GenreGlyph({
  genre,
  confidence,
  isPredicted = false,
  onPress,
}: GenreGlyphProps) {
  const [showLabel, setShowLabel] = useState(false)

  // Don't render if no genre or confidence below display threshold (unless predicted)
  if (!genre) return null
  if (!isPredicted && confidence <= CONFIDENCE_DISPLAY_THRESHOLD) return null

  const icon = GENRE_ICONS[genre]
  const label = GENRE_LABELS[genre]
  const isLowConfidence = !isPredicted && confidence > CONFIDENCE_DISPLAY_THRESHOLD && confidence <= CONFIDENCE_LOW_THRESHOLD

  const handlePress = () => {
    setShowLabel((prev) => !prev)
    onPress?.()
  }

  return (
    <button
      type="button"
      onClick={handlePress}
      className="relative flex items-center justify-center"
      style={{
        minWidth: '44px',
        minHeight: '44px',
        opacity: isPredicted ? PREDICTED_OPACITY : 1,
      }}
      aria-label={
        isPredicted
          ? `Predicted genre: ${label}`
          : `Live genre: ${label}${isLowConfidence ? ', low confidence' : ''}`
      }
      aria-pressed={showLabel}
    >
      {/* Genre icon */}
      <span
        className="text-lg select-none pointer-events-none"
        role="img"
        aria-hidden="true"
      >
        {icon}
      </span>

      {/* Low confidence indicator */}
      {isLowConfidence && (
        <span
          className="absolute -bottom-1 -right-1 text-[9px] font-medium leading-none rounded-full px-1 py-0.5 bg-[var(--bg-raised)] text-[var(--text-secondary)]"
          aria-hidden="true"
        >
          1
        </span>
      )}

      {/* Tap label — shows on press */}
      {showLabel && (
        <span
          className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium rounded px-1.5 py-0.5 bg-[var(--bg-raised)] text-[var(--text-primary)] shadow-sm"
          role="tooltip"
        >
          {isPredicted ? 'Predicted' : label}
        </span>
      )}
    </button>
  )
}
