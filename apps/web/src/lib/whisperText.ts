import type { Node } from '@area-code/shared/types'

import { getNodeState } from './mapHelpers'

/**
 * Pulse score threshold above which we consider a venue to have rising
 * momentum (filling up / buzzing). Aligned with the "buzzing" state
 * threshold in mapHelpers.
 */
const MOMENTUM_THRESHOLD = 31

/**
 * Computes the one-line magnet whisper for a brushed beam.
 *
 * Ranked per discovery-DNA hierarchy:
 *   1. Belonging: friends at venue (honest, real mutual-friend data)
 *   2. Momentum: pulse is high/rising (buzzing or popping state)
 *   3. Aliveness: fallback using pulse state label
 *
 * Honest-presence compliant: never claims "your crowd" without real
 * friend presence data. Under-claims, never over-claims.
 */
export function computeWhisperText(
  nodeId: string,
  node: Node | undefined,
  mapState: {
    pulseScores: Record<string, number>
    checkInCounts: Record<string, number>
    friendsAtVenue: Record<string, string[]>
  },
): string | null {
  if (!node) return null

  const name = node.name
  const friends = mapState.friendsAtVenue[nodeId]
  const pulseScore = mapState.pulseScores[nodeId] ?? 0
  const checkInCount = mapState.checkInCounts[nodeId] ?? 0
  const state = getNodeState(pulseScore)

  // 1. Belonging: real friends present (never fabricated)
  if (friends && friends.length > 0) {
    return `Your crowd \u00b7 ${name}`
  }

  // 2. Momentum: venue is buzzing/popping or high check-in count
  if (pulseScore >= MOMENTUM_THRESHOLD || state === 'buzzing' || state === 'popping') {
    if (state === 'popping') return `Popping \u00b7 ${name}`
    return `Buzzing \u00b7 ${name}`
  }

  // 3. Aliveness: active state with real presence
  if (state === 'active' && checkInCount > 0) {
    return `Live \u00b7 ${name}`
  }

  // Quiet or dormant: under-claim, honest signal
  if (state === 'quiet' && checkInCount > 0) {
    return `Quiet \u00b7 ${name}`
  }

  // Dormant: no whisper rather than fabricating activity
  return null
}
