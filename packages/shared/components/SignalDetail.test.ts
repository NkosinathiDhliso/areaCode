/**
 * Unit tests for SignalDetail utility functions.
 *
 * Tests the getTopGenres helper which selects top genres from genreCounts
 * with alphabetical tiebreak for deterministic ordering.
 */
import { describe, it, expect } from 'vitest'

import { getTopGenres } from './SignalDetail'

describe('getTopGenres', () => {
  it('returns top 3 genres sorted by count descending', () => {
    const genreCounts = {
      amapiano: 10,
      deep_house: 8,
      afrobeats: 5,
      hip_hop: 3,
      jazz: 1,
    }

    const result = getTopGenres(genreCounts, 3)

    expect(result).toEqual([
      { genre: 'amapiano', genreCount: 10 },
      { genre: 'deep_house', genreCount: 8 },
      { genre: 'afrobeats', genreCount: 5 },
    ])
  })

  it('uses alphabetical tiebreak when counts are equal', () => {
    const genreCounts = {
      kwaito: 5,
      amapiano: 5,
      gqom: 5,
    }

    const result = getTopGenres(genreCounts, 3)

    expect(result).toEqual([
      { genre: 'amapiano', genreCount: 5 },
      { genre: 'gqom', genreCount: 5 },
      { genre: 'kwaito', genreCount: 5 },
    ])
  })

  it('returns empty array when genreCounts is empty', () => {
    const result = getTopGenres({}, 3)
    expect(result).toEqual([])
  })

  it('filters out zero and null values', () => {
    const genreCounts = {
      amapiano: 5,
      deep_house: 0,
      jazz: 3,
    }

    const result = getTopGenres(genreCounts, 3)

    expect(result).toEqual([
      { genre: 'amapiano', genreCount: 5 },
      { genre: 'jazz', genreCount: 3 },
    ])
  })

  it('returns fewer than requested count when not enough genres', () => {
    const genreCounts = {
      amapiano: 10,
      deep_house: 5,
    }

    const result = getTopGenres(genreCounts, 3)

    expect(result).toEqual([
      { genre: 'amapiano', genreCount: 10 },
      { genre: 'deep_house', genreCount: 5 },
    ])
  })

  it('handles single genre', () => {
    const genreCounts = { gospel: 7 }

    const result = getTopGenres(genreCounts, 3)

    expect(result).toEqual([{ genre: 'gospel', genreCount: 7 }])
  })
})
