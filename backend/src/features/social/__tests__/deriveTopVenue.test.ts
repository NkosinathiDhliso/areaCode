import { describe, it, expect } from 'vitest'
import { deriveTopVenue } from '../leaderboard-utils.js'

describe('deriveTopVenue', () => {
  it('returns null for empty check-in array', () => {
    expect(deriveTopVenue([])).toBeNull()
  })

  it('returns the single venue when only one check-in exists', () => {
    const result = deriveTopVenue([{ nodeId: 'venue-1', checkedInAt: '2024-01-15T10:00:00Z' }])
    expect(result).toEqual({ topVenueId: 'venue-1' })
  })

  it('returns the venue with the most check-ins', () => {
    const checkIns = [
      { nodeId: 'venue-1', checkedInAt: '2024-01-15T10:00:00Z' },
      { nodeId: 'venue-2', checkedInAt: '2024-01-15T11:00:00Z' },
      { nodeId: 'venue-1', checkedInAt: '2024-01-15T12:00:00Z' },
      { nodeId: 'venue-2', checkedInAt: '2024-01-15T13:00:00Z' },
      { nodeId: 'venue-1', checkedInAt: '2024-01-15T14:00:00Z' },
    ]
    const result = deriveTopVenue(checkIns)
    expect(result?.topVenueId).toBe('venue-1')
  })

  it('breaks ties by most recently visited venue', () => {
    const checkIns = [
      { nodeId: 'venue-1', checkedInAt: '2024-01-15T10:00:00Z' },
      { nodeId: 'venue-2', checkedInAt: '2024-01-15T11:00:00Z' },
      { nodeId: 'venue-1', checkedInAt: '2024-01-15T12:00:00Z' },
      { nodeId: 'venue-2', checkedInAt: '2024-01-16T18:00:00Z' }, // More recent
    ]
    // Both have 2 check-ins, venue-2 was visited more recently
    const result = deriveTopVenue(checkIns)
    expect(result?.topVenueId).toBe('venue-2')
  })

  it('higher count always wins over more recent visit', () => {
    const checkIns = [
      { nodeId: 'venue-1', checkedInAt: '2024-01-15T08:00:00Z' },
      { nodeId: 'venue-1', checkedInAt: '2024-01-15T09:00:00Z' },
      { nodeId: 'venue-1', checkedInAt: '2024-01-15T10:00:00Z' },
      { nodeId: 'venue-2', checkedInAt: '2024-01-17T23:00:00Z' }, // Way more recent but only 1 check-in
    ]
    const result = deriveTopVenue(checkIns)
    expect(result?.topVenueId).toBe('venue-1')
  })

  it('includes topVenueName when venueNames map is provided', () => {
    const checkIns = [
      { nodeId: 'venue-1', checkedInAt: '2024-01-15T10:00:00Z' },
      { nodeId: 'venue-1', checkedInAt: '2024-01-15T12:00:00Z' },
    ]
    const venueNames = { 'venue-1': "Kitchener's Bar", 'venue-2': 'Arts on Main' }
    const result = deriveTopVenue(checkIns, venueNames)
    expect(result).toEqual({ topVenueId: 'venue-1', topVenueName: "Kitchener's Bar" })
  })

  it('does not include topVenueName when venue not in names map', () => {
    const checkIns = [{ nodeId: 'venue-99', checkedInAt: '2024-01-15T10:00:00Z' }]
    const venueNames = { 'venue-1': "Kitchener's Bar" }
    const result = deriveTopVenue(checkIns, venueNames)
    expect(result).toEqual({ topVenueId: 'venue-99' })
  })

  it('handles multiple venues with a clear winner', () => {
    const checkIns = [
      { nodeId: 'venue-1', checkedInAt: '2024-01-15T10:00:00Z' },
      { nodeId: 'venue-2', checkedInAt: '2024-01-15T11:00:00Z' },
      { nodeId: 'venue-3', checkedInAt: '2024-01-15T12:00:00Z' },
      { nodeId: 'venue-2', checkedInAt: '2024-01-15T13:00:00Z' },
      { nodeId: 'venue-3', checkedInAt: '2024-01-15T14:00:00Z' },
      { nodeId: 'venue-3', checkedInAt: '2024-01-15T15:00:00Z' },
    ]
    const result = deriveTopVenue(checkIns)
    expect(result?.topVenueId).toBe('venue-3')
  })

  it('handles three-way tie broken by most recent visit', () => {
    const checkIns = [
      { nodeId: 'venue-1', checkedInAt: '2024-01-15T10:00:00Z' },
      { nodeId: 'venue-2', checkedInAt: '2024-01-15T11:00:00Z' },
      { nodeId: 'venue-3', checkedInAt: '2024-01-15T12:00:00Z' },
    ]
    // All have 1 check-in, venue-3 was visited most recently
    const result = deriveTopVenue(checkIns)
    expect(result?.topVenueId).toBe('venue-3')
  })
})
