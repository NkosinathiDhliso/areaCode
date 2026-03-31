/**
 * Mock Socket.io replacement using a simple EventEmitter pattern.
 * Emits simulated real-time events on timers for consumer and business apps.
 */
import type { NodeState, ToastType } from '../types'
import { MOCK_NODES } from './data/nodes'
import { MOCK_USERS } from './data/users'
import { MOCK_PULSE_SCORES } from './data/pulseScores'
import { randomBetween } from './helpers'
import { getUserMusicData } from './data/crowdVibe'

type Listener = (...args: unknown[]) => void

export class MockSocket {
  connected = true
  private listeners = new Map<string, Set<Listener>>()

  on(event: string, fn: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(fn)
    return this
  }

  off(event: string, fn?: Listener): this {
    if (fn) {
      this.listeners.get(event)?.delete(fn)
    } else {
      this.listeners.delete(event)
    }
    return this
  }

  emit(event: string, ...args: unknown[]): this {
    const fns = this.listeners.get(event)
    if (fns) {
      for (const fn of fns) {
        try { fn(...args) } catch (e) { console.error('[MockSocket] Handler error:', e) }
      }
    }
    return this
  }

  disconnect(): void { this.connected = false }
  connect(): this { this.connected = true; return this }
}

/** Factory function for creating a MockSocket instance. */
export function createMockSocket(): MockSocket {
  return new MockSocket()
}

function getNodeState(score: number): NodeState {
  if (score === 0) return 'dormant'
  if (score <= 10) return 'quiet'
  if (score <= 30) return 'active'
  if (score <= 60) return 'buzzing'
  return 'popping'
}

/** Emits consumer-facing events at 8–20s intervals */
export function startConsumerEmitter(socket: MockSocket): () => void {
  let idx = 0
  const scores = { ...MOCK_PULSE_SCORES }

  const tick = () => {
    try {
      const node = MOCK_NODES[idx % MOCK_NODES.length]!
      const user = MOCK_USERS[idx % MOCK_USERS.length]!
      const delta = randomBetween(1, 8)
      scores[node.id] = (scores[node.id] ?? 0) + delta
      const score = scores[node.id]!

      socket.emit('node:pulse_update', {
        nodeId: node.id, pulseScore: score,
        checkInCount: Math.floor(score / 3), state: getNodeState(score),
      })

      // Alternate between toast and state_change
      if (idx % 3 === 0) {
        const toastTypes: ToastType[] = ['checkin', 'reward_new', 'streak']
        const musicData = getUserMusicData(user.id)
        socket.emit('toast:new', {
          type: toastTypes[idx % toastTypes.length],
          message: `${user.displayName} just checked in at ${node.name}`,
          nodeId: node.id, nodeLat: node.lat, nodeLng: node.lng,
          avatarUrl: user.avatarUrl,
          musicGenres: musicData?.genres ?? [],
          dimensionScores: musicData?.dimensionScores ?? null,
          archetypeId: musicData?.archetypeId ?? null,
        })
      } else if (idx % 5 === 0) {
        socket.emit('node:state_change', { nodeId: node.id, state: getNodeState(score) })
      }

      idx++
    } catch (e) {
      console.error('[MockSocket] Consumer emitter error:', e)
    }
  }

  const schedule = () => {
    const delay = randomBetween(8000, 20000)
    return setTimeout(() => { tick(); timerId = schedule() }, delay)
  }
  let timerId = schedule()

  return () => clearTimeout(timerId)
}

/** Emits business-facing events at 15–45s intervals */
export function startBusinessEmitter(socket: MockSocket, _businessId?: string): () => void {
  let idx = 0
  const bizNodes = MOCK_NODES.filter((n) => n.businessId === 'mock-biz-2')

  const tick = () => {
    try {
      const node = bizNodes[idx % bizNodes.length]!
      const user = MOCK_USERS[idx % MOCK_USERS.length]!

      if (idx % 2 === 0) {
        socket.emit('business:checkin', {
          nodeId: node.id, nodeName: node.name,
          checkInCount: randomBetween(10, 50),
          avatarUrl: user.avatarUrl, username: user.username,
          timestamp: new Date().toISOString(),
        })
      } else {
        const reward = `Mock reward at ${node.name}`
        socket.emit('business:reward_claimed', {
          nodeId: node.id, nodeName: node.name,
          rewardId: `mock-reward-${idx}`, rewardTitle: reward,
          timestamp: new Date().toISOString(),
        })
      }
      idx++
    } catch (e) {
      console.error('[MockSocket] Business emitter error:', e)
    }
  }

  const schedule = () => {
    const delay = randomBetween(15000, 45000)
    return setTimeout(() => { tick(); timerId = schedule() }, delay)
  }
  let timerId = schedule()

  return () => clearTimeout(timerId)
}
