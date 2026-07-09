// @vitest-environment jsdom
import type { Node } from '@area-code/shared/types'
import { describe, it, expect } from 'vitest'

import { computeWhisperText } from './whisperText'

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    id: 'node-1',
    name: 'Test Venue',
    slug: 'test-venue',
    category: 'nightlife',
    lat: -26.2,
    lng: 28.0,
    cityId: 'johannesburg',
    businessId: null,
    submittedBy: null,
    claimStatus: 'unclaimed',
    claimCipcStatus: null,
    nodeColour: 'default',
    nodeIcon: null,
    qrCheckinEnabled: false,
    isVerified: false,
    isActive: true,
    createdAt: '2024-01-01',
    ...overrides,
  }
}

function makeMapState(
  overrides: Partial<{
    pulseScores: Record<string, number>
    checkInCounts: Record<string, number>
    friendsAtVenue: Record<string, string[]>
    momentum: Record<string, 'filling_up' | 'winding_down' | 'steady'>
  }> = {},
) {
  return {
    pulseScores: {},
    checkInCounts: {},
    friendsAtVenue: {},
    ...overrides,
  }
}

describe('computeWhisperText', () => {
  it('returns null for undefined node', () => {
    const result = computeWhisperText('node-1', undefined, makeMapState())
    expect(result).toBeNull()
  })

  it('returns belonging whisper when friends are present', () => {
    const node = makeNode({ name: 'Vibe Lounge' })
    const state = makeMapState({
      friendsAtVenue: { 'node-1': ['friend-a', 'friend-b'] },
      pulseScores: { 'node-1': 50 },
    })
    const result = computeWhisperText('node-1', node, state)
    expect(result).toBe('Your crowd \u00b7 Vibe Lounge')
  })

  it('returns momentum whisper for buzzing venues without friends', () => {
    const node = makeNode({ name: 'Club Nova' })
    const state = makeMapState({
      pulseScores: { 'node-1': 35 },
      checkInCounts: { 'node-1': 8 },
    })
    const result = computeWhisperText('node-1', node, state)
    expect(result).toBe('Buzzing \u00b7 Club Nova')
  })

  it('returns popping whisper for popping venues', () => {
    const node = makeNode({ name: 'Mega Bar' })
    const state = makeMapState({
      pulseScores: { 'node-1': 70 },
      checkInCounts: { 'node-1': 20 },
    })
    const result = computeWhisperText('node-1', node, state)
    expect(result).toBe('Popping \u00b7 Mega Bar')
  })

  it('returns aliveness whisper for active venues with check-ins', () => {
    const node = makeNode({ name: 'Chill Spot' })
    const state = makeMapState({
      pulseScores: { 'node-1': 15 },
      checkInCounts: { 'node-1': 3 },
    })
    const result = computeWhisperText('node-1', node, state)
    expect(result).toBe('Live \u00b7 Chill Spot')
  })

  it('returns quiet whisper for quiet venues with some presence', () => {
    const node = makeNode({ name: 'Quiet Cafe' })
    const state = makeMapState({
      pulseScores: { 'node-1': 5 },
      checkInCounts: { 'node-1': 1 },
    })
    const result = computeWhisperText('node-1', node, state)
    expect(result).toBe('Quiet \u00b7 Quiet Cafe')
  })

  it('returns null for dormant venues (honest, no fabrication)', () => {
    const node = makeNode({ name: 'Empty Place' })
    const state = makeMapState({
      pulseScores: { 'node-1': 0 },
      checkInCounts: { 'node-1': 0 },
    })
    const result = computeWhisperText('node-1', node, state)
    expect(result).toBeNull()
  })

  it('returns filling-up whisper from real presence momentum, above pulse labels', () => {
    const node = makeNode({ name: 'Rising Spot' })
    const state = makeMapState({
      pulseScores: { 'node-1': 70 },
      checkInCounts: { 'node-1': 12 },
      momentum: { 'node-1': 'filling_up' },
    })
    const result = computeWhisperText('node-1', node, state)
    expect(result).toBe('Filling up · Rising Spot')
  })

  it('never whispers winding-down (honest but not a pull)', () => {
    const node = makeNode({ name: 'Fading Spot' })
    const state = makeMapState({
      pulseScores: { 'node-1': 35 },
      checkInCounts: { 'node-1': 6 },
      momentum: { 'node-1': 'winding_down' },
    })
    const result = computeWhisperText('node-1', node, state)
    expect(result).toBe('Buzzing · Fading Spot')
  })

  it('prioritises belonging over momentum', () => {
    const node = makeNode({ name: 'Hot Spot' })
    const state = makeMapState({
      pulseScores: { 'node-1': 80 },
      checkInCounts: { 'node-1': 30 },
      friendsAtVenue: { 'node-1': ['friend-1'] },
    })
    const result = computeWhisperText('node-1', node, state)
    expect(result).toBe('Your crowd \u00b7 Hot Spot')
  })

  it('returns null for quiet venues with zero check-ins', () => {
    const node = makeNode({ name: 'Closed Spot' })
    const state = makeMapState({
      pulseScores: { 'node-1': 3 },
      checkInCounts: { 'node-1': 0 },
    })
    const result = computeWhisperText('node-1', node, state)
    expect(result).toBeNull()
  })
})
