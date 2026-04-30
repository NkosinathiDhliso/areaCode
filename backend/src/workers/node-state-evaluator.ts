// DynamoDB-backed node state evaluator (replaces Redis + Prisma)
import { ScanCommand } from '@aws-sdk/lib-dynamodb'
import { documentClient, TableNames } from '../shared/db/dynamodb.js'
import { kvGet, kvSet } from '../shared/kv/dynamodb-kv.js'
import { emitStateSurge, emitToast } from '../shared/socket/events.js'

/**
 * Node state evaluator sidecar , runs every 30s per city (staggered).
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

async function getPreviousState(nodeId: string): Promise<NodeState> {
  const state = await kvGet(`node:prev_state:${nodeId}`)
  return (state as NodeState) ?? 'dormant'
}

async function setPreviousState(nodeId: string, state: NodeState): Promise<void> {
  await kvSet(`node:prev_state:${nodeId}`, state, 86400)
}

export async function evaluateCityNodes(cityId: string, citySlug: string) {
  // Get all nodes for this city via pulse KV keys (scan nodes table)
  const nodesResult = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.nodes,
      FilterExpression: 'cityId = :cityId AND isActive = :active',
      ExpressionAttributeValues: { ':cityId': cityId, ':active': true },
    })
  )

  let surgeCount = 0

  for (const n of nodesResult.Items || []) {
    const nodeId = (n['nodeId'] ?? n['id']) as string
    const scoreStr = await kvGet(`pulse:${cityId}:${nodeId}`)
    const score = scoreStr ? parseFloat(scoreStr) : 0
    const currentState = getNodeState(score)
    const prevState = await getPreviousState(nodeId)

    if (currentState !== prevState) {
      await setPreviousState(nodeId, currentState)

      const stateOrder: NodeState[] = ['dormant', 'quiet', 'active', 'buzzing', 'popping']
      const prevIdx = stateOrder.indexOf(prevState)
      const currIdx = stateOrder.indexOf(currentState)

      if (currIdx > prevIdx) {
        emitStateSurge(citySlug, { nodeId, fromState: prevState, toState: currentState })

        if (currentState === 'popping') {
          emitToast(citySlug, { type: 'surge', message: 'A spot just hit peak energy nearby', nodeId })
        }

        surgeCount++
      }
    }
  }

  return surgeCount
}

async function getCities() {
  const result = await documentClient.send(
    new ScanCommand({
      TableName: TableNames.appData,
      FilterExpression: 'begins_with(pk, :prefix) AND sk = pk',
      ExpressionAttributeValues: { ':prefix': 'CITY#' },
    })
  )
  return (result.Items || []).map((c) => ({ id: (c['cityId'] ?? c['pk']) as string, slug: c['slug'] as string }))
}

/**
 * Main loop for Lambda/sidecar , evaluates all cities with staggered offsets.
 */
export async function startEvaluatorLoop() {
  const cities = await getCities()

  async function tick() {
    for (let i = 0; i < cities.length; i++) {
      const city = cities[i]!
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

  setInterval(tick, 30_000)
  await tick()
}
