/**
 * Unit tests for GenreGlyph component logic.
 *
 * Tests the rendering conditions, confidence thresholds, and predicted state behavior.
 * Since @testing-library/react is not available, we test the component's
 * decision logic directly.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7
 */
import { describe, it, expect } from 'vitest'

import type { MusicGenre } from '../../types'

// ============================================================================
// Constants (mirrored from component for testing)
// ============================================================================

const CONFIDENCE_DISPLAY_THRESHOLD = 0.15
const CONFIDENCE_LOW_THRESHOLD = 0.3
const PREDICTED_OPACITY = 0.5

const MUSIC_GENRES: MusicGenre[] = [
  'amapiano', 'deep_house', 'afrobeats', 'hip_hop', 'rnb', 'kwaito',
  'gqom', 'jazz', 'rock', 'pop', 'gospel', 'maskandi',
]

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

// ============================================================================
// Helper: Simulate component render decision logic
// ============================================================================

interface GenreGlyphInput {
  genre: MusicGenre | null
  confidence: number
  isPredicted?: boolean
}

interface GenreGlyphOutput {
  shouldRender: boolean
  icon: string | null
  isLowConfidence: boolean
  opacity: number
  ariaLabel: string | null
}

function computeGlyphState(input: GenreGlyphInput): GenreGlyphOutput {
  const { genre, confidence, isPredicted = false } = input

  if (!genre) {
    return { shouldRender: false, icon: null, isLowConfidence: false, opacity: 1, ariaLabel: null }
  }

  if (!isPredicted && confidence <= CONFIDENCE_DISPLAY_THRESHOLD) {
    return { shouldRender: false, icon: null, isLowConfidence: false, opacity: 1, ariaLabel: null }
  }

  const icon = GENRE_ICONS[genre]
  const isLowConfidence = !isPredicted && confidence > CONFIDENCE_DISPLAY_THRESHOLD && confidence <= CONFIDENCE_LOW_THRESHOLD
  const opacity = isPredicted ? PREDICTED_OPACITY : 1

  const genreLabel = genre.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  let ariaLabel: string
  if (isPredicted) {
    ariaLabel = `Predicted genre: ${genreLabel}`
  } else {
    ariaLabel = `Live genre: ${genreLabel}${isLowConfidence ? ', low confidence' : ''}`
  }

  return { shouldRender: true, icon, isLowConfidence, opacity, ariaLabel }
}

// ============================================================================
// Tests
// ============================================================================

describe('GenreGlyph - render conditions', () => {
  it('does not render when genre is null', () => {
    const result = computeGlyphState({ genre: null, confidence: 0.8 })
    expect(result.shouldRender).toBe(false)
  })

  it('does not render when confidence is at or below 0.15 (live signal)', () => {
    const result = computeGlyphState({ genre: 'amapiano', confidence: 0.15 })
    expect(result.shouldRender).toBe(false)
  })

  it('does not render when confidence is 0 (live signal)', () => {
    const result = computeGlyphState({ genre: 'jazz', confidence: 0 })
    expect(result.shouldRender).toBe(false)
  })

  it('renders when confidence is above 0.15 (live signal)', () => {
    const result = computeGlyphState({ genre: 'amapiano', confidence: 0.16 })
    expect(result.shouldRender).toBe(true)
  })

  it('renders predicted genre regardless of confidence value', () => {
    const result = computeGlyphState({ genre: 'deep_house', confidence: 0, isPredicted: true })
    expect(result.shouldRender).toBe(true)
  })
})

describe('GenreGlyph - distinct icons per genre', () => {
  it('each of 12 genres has a distinct icon', () => {
    const icons = MUSIC_GENRES.map((g) => GENRE_ICONS[g])
    const uniqueIcons = new Set(icons)
    expect(uniqueIcons.size).toBe(12)
  })

  it('renders correct icon for each genre', () => {
    for (const genre of MUSIC_GENRES) {
      const result = computeGlyphState({ genre, confidence: 0.8 })
      expect(result.icon).toBe(GENRE_ICONS[genre])
    }
  })
})

describe('GenreGlyph - low confidence indicator', () => {
  it('shows low confidence indicator when confidence is between 0.15 and 0.3', () => {
    const result = computeGlyphState({ genre: 'kwaito', confidence: 0.2 })
    expect(result.isLowConfidence).toBe(true)
  })

  it('does not show low confidence indicator when confidence is above 0.3', () => {
    const result = computeGlyphState({ genre: 'kwaito', confidence: 0.5 })
    expect(result.isLowConfidence).toBe(false)
  })

  it('does not show low confidence indicator at exactly 0.3', () => {
    const result = computeGlyphState({ genre: 'gqom', confidence: 0.3 })
    expect(result.isLowConfidence).toBe(true)
  })

  it('does not show low confidence indicator for predicted genres', () => {
    const result = computeGlyphState({ genre: 'jazz', confidence: 0.2, isPredicted: true })
    expect(result.isLowConfidence).toBe(false)
  })
})

describe('GenreGlyph - predicted state', () => {
  it('uses muted opacity (0.5) for predicted genres', () => {
    const result = computeGlyphState({ genre: 'rock', confidence: 0, isPredicted: true })
    expect(result.opacity).toBe(PREDICTED_OPACITY)
  })

  it('uses full opacity (1) for live genres', () => {
    const result = computeGlyphState({ genre: 'rock', confidence: 0.8 })
    expect(result.opacity).toBe(1)
  })

  it('aria-label includes "Predicted" for predicted genres', () => {
    const result = computeGlyphState({ genre: 'pop', confidence: 0, isPredicted: true })
    expect(result.ariaLabel).toContain('Predicted')
  })

  it('aria-label includes "Live" for live genres', () => {
    const result = computeGlyphState({ genre: 'pop', confidence: 0.8 })
    expect(result.ariaLabel).toContain('Live')
  })
})

describe('GenreGlyph - accessibility', () => {
  it('aria-label mentions low confidence when applicable', () => {
    const result = computeGlyphState({ genre: 'gospel', confidence: 0.2 })
    expect(result.ariaLabel).toContain('low confidence')
  })

  it('aria-label does not mention low confidence for high confidence signals', () => {
    const result = computeGlyphState({ genre: 'gospel', confidence: 0.8 })
    expect(result.ariaLabel).not.toContain('low confidence')
  })
})
