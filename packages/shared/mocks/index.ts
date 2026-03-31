/**
 * Dev mock layer entry point.
 * Call initDevMocks() before rendering to intercept API, socket, and geolocation.
 */
import { patchApiClient } from './mockApi'
import { MockSocket, startConsumerEmitter } from './mockSocket'
import { patchGeolocation } from './mockGeo'
import { MOCK_PULSE_SCORES } from './data/pulseScores'
import { MOCK_NODES } from './data/nodes'
import type { NodeState } from '../types'

export const IS_DEV_MOCK = typeof import.meta !== 'undefined'
  && (import.meta as unknown as Record<string, Record<string, string>>).env?.VITE_DEV_MOCK === 'true'

let mockSocket: MockSocket | null = null

function getNodeState(score: number): NodeState {
  if (score === 0) return 'dormant'
  if (score <= 10) return 'quiet'
  if (score <= 30) return 'active'
  if (score <= 60) return 'buzzing'
  return 'popping'
}

export async function initDevMocks(): Promise<void> {
  console.log('[DevMock] Initialising mock layer')

  // 1. Patch API client
  patchApiClient()

  // 2. Create mock socket and replace getSocket
  mockSocket = new MockSocket()

  // Inject mock socket via the dedicated setter (ES module exports are read-only)
  const { setSocketOverride } = await import('../lib/socket')
  setSocketOverride(mockSocket as unknown as Parameters<typeof setSocketOverride>[0])

  // 3. Patch geolocation
  patchGeolocation()

  // 4. Seed pulse scores directly into the map store so markers render with correct states
  const { useMapStore } = await import('../stores/mapStore')
  for (const node of MOCK_NODES) {
    const score = MOCK_PULSE_SCORES[node.id] ?? 0
    useMapStore.getState().updateNodePulse(node.id, score)
  }

  // 5. Also emit pulse events after a delay so useNodePulse picks them up once mounted
  setTimeout(() => {
    if (!mockSocket) return
    for (const node of MOCK_NODES) {
      const score = MOCK_PULSE_SCORES[node.id] ?? 0
      mockSocket.emit('node:pulse_update', {
        nodeId: node.id,
        pulseScore: score,
        checkInCount: Math.floor(score / 3),
        state: getNodeState(score),
      })
    }
  }, 1500)

  // 6. Start consumer emitter
  startConsumerEmitter(mockSocket)

  console.log('[DevMock] Mock layer active — all API calls intercepted')
}

export function getDevMockSocket(): MockSocket | null {
  return mockSocket
}

export { startBusinessEmitter } from './mockSocket'
export type { MockSocket } from './mockSocket'
