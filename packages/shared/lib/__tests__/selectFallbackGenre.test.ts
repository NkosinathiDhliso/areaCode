import { describe, it, expect } from 'vitest'

import { selectFallbackGenre } from '../selectFallbackGenre'
import type { MusicGenre } from '../../types'

describe('selectFallbackGenre', () => {
  it('returns null for empty genreCounts', () => {
    expect(selectFallbackGenre({})).toBeNull()
  })

  it('returns null when all counts are zero', () => {
    expect(selectFallbackGenre({ amapiano: 0, deep_house: 0 })).toBeNull()
  })

  it('returns the genre with the highest count', () => {
    const genreCounts: Partial<Record<MusicGenre, number>> = {
      amapiano: 5,
      deep_house: 10,
      jazz: 3,
    }
    expect(selectFallbackGenre(genreCounts)).toBe('deep_house')
  })

  it('uses alphabetical tiebreak when multiple genres have the same highest count', () => {
    const genreCounts: Partial<Record<MusicGenre, number>> = {
      kwaito: 7,
      amapiano: 7,
      jazz: 7,
    }
    // Alphabetical: amapiano < jazz < kwaito
    expect(selectFallbackGenre(genreCounts)).toBe('amapiano')
  })

  it('returns the single genre when only one exists', () => {
    expect(selectFallbackGenre({ gospel: 3 })).toBe('gospel')
  })

  it('ignores genres with zero counts when selecting top', () => {
    const genreCounts: Partial<Record<MusicGenre, number>> = {
      amapiano: 0,
      deep_house: 2,
      rock: 0,
    }
    expect(selectFallbackGenre(genreCounts)).toBe('deep_house')
  })

  it('handles all 12 genres correctly', () => {
    const genreCounts: Partial<Record<MusicGenre, number>> = {
      amapiano: 1,
      deep_house: 2,
      afrobeats: 3,
      hip_hop: 4,
      rnb: 5,
      kwaito: 6,
      gqom: 7,
      jazz: 8,
      rock: 9,
      pop: 10,
      gospel: 11,
      maskandi: 12,
    }
    expect(selectFallbackGenre(genreCounts)).toBe('maskandi')
  })
})
