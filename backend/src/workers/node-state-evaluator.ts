import { redis } from '../shared/redis/client.js'
import { nodesPulse } from '../shared/redis/keys.js'
import { prisma } from '../shared/db/prisma.js'
import { emitStateSurge, emitToast } from '../shared/socket/events.js'

/**
 * Node state evaluator sidecar — runs every 30s per city (staggered).
 * Detects state tier changes and emits surge events.
 */

type NodeState = 'dormant' | 'quiet' | 'active' | 'buzzing' | 'popping'

const STATE_THRESHOLDS: Array<{ min: number; state: NodeState }> = [
  { min: 61, state: 'popping' },
  { min: 31, state: 'buzzing' },
  { min: 11, state: 'active' },
  { min: 1, state: 'quiet' },
  { min: 0, state: 'dormant' },
]

function getNodeState(score: number): NodeState {
  for (const t of STATE_THRESHOLDS) {
    if (score >= t.min) return t.state
  }
  return 'dormant'
}

// Track previous states in memory (per container)
const previousStates = new Map<string, NodeState>()

export async function evaluateCityNodes(cityId: string, citySlug: string) {
  const key = nodesPulse(cityId)
  const members = await redis.zrangebyscore(key, 0, '+inf', 'WITHSCORES')

  let surgeCount = 0

  for (let i = 0; i < members.length; i += 2) {
    const nodeId = members[i]!
    const score = parseFloat(members[i + 1]!)
    const currentState = getNodeState(score)
    const prevState = previousStates.get(nodeId) ?? 'dormant'

    if (currentState !== prevState) {
      previousStates.set(nodeId, currentState)

      // Only emit surge for upward transitions
      const stateOrder: NodeState[] = ['dormant', 'quiet', 'active', 'buzzing', 'popping']
      const prevIdx = stateOrder.indexOf(prevState)
      const currIdx = stateOrder.indexOf(currentState)

      if (currIdx > prevIdx) {
        emitStateSurge(citySlug, {
          nodeId,
          fromState: prevState,
          toState: currentState,
        })

        // Emit surge toast when entering popping
        if (currentState === 'popping') {
          emitToast(citySlug, {
            type: 'surge',
            message: 'A spot just hit peak energy nearby',
            nodeId,
          })
        }

        surgeCount++
      }
    }
  }

  return surgeCount
}

/**
 * Main loop for ECS sidecar — evaluates all cities with staggered offsets.
 */
export async function startEvaluatorLoop() {
  const cities = await prisma.city.findMany({ select: { id: true, slug: true } })

  async function tick() {
    for (let i = 0; i < cities.length; i++) {
      const city = cities[i]!
      // Stagger by offset to avoid thundering herd
      setTimeout(async () => {
        try {
          await evaluateCityNodes(city.id, city.slug)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[node-state-evaluator] ${city.slug}: ${msg}`)
        }
      }, i * (30_000 / cities.length))
    }
  }

  // Run every 30 seconds
  setInterval(tick, 30_000)
  await tick() // Initial run
}
