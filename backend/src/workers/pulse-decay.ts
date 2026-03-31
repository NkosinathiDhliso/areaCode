import { redis } from '../shared/redis/client.js'
import { nodesPulse } from '../shared/redis/keys.js'
import { prisma } from '../shared/db/prisma.js'
import { emitStateChange } from '../shared/socket/events.js'

/**
 * Pulse decay worker — EventBridge Lambda every 5 minutes.
 * Applies time-weighted decay to all node pulse scores.
 * Off-peak (00:00–17:59 SAST): score × 0.90
 * Peak (18:00–23:59 SAST): score × 0.95
 * Floor: 0
 */

const STATE_THRESHOLDS = [
  { min: 61, state: 'popping' },
  { min: 31, state: 'buzzing' },
  { min: 11, state: 'active' },
  { min: 1, state: 'quiet' },
  { min: 0, state: 'dormant' },
] as const

function getNodeState(score: number): string {
  for (const t of STATE_THRESHOLDS) {
    if (score >= t.min) return t.state
  }
  return 'dormant'
}

function isPeakHour(): boolean {
  const now = new Date()
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000) // UTC+2
  const hour = sast.getUTCHours()
  return hour >= 18 && hour <= 23
}

export async function handler() {
  console.log('[pulse-decay] Starting pulse decay worker')
  const decayFactor = isPeakHour() ? 0.95 : 0.90

  const cities = await prisma.city.findMany({ select: { id: true, slug: true } })
  let totalProcessed = 0

  for (const city of cities) {
    const key = nodesPulse(city.id)
    const members = await redis.zrangebyscore(key, 1, '+inf', 'WITHSCORES')

    for (let i = 0; i < members.length; i += 2) {
      const nodeId = members[i]!
      const currentScore = parseFloat(members[i + 1]!)
      const oldState = getNodeState(currentScore)

      const newScore = Math.floor(currentScore * decayFactor)
      const newState = getNodeState(newScore)

      if (newScore <= 0) {
        await redis.zrem(key, nodeId)
      } else {
        await redis.zadd(key, newScore, nodeId)
      }

      if (oldState !== newState) {
        emitStateChange(city.slug, {
          nodeId,
          state: newState as 'dormant' | 'quiet' | 'active' | 'buzzing' | 'popping',
        })
      }

      totalProcessed++
    }
  }

  console.log(`[pulse-decay] Processed ${totalProcessed} nodes`)
  return { processed: totalProcessed }
}
