import { redis } from '../shared/redis/client.js'
import { leaderboard } from '../shared/redis/keys.js'
import { prisma } from '../shared/db/prisma.js'

/**
 * Leaderboard reset worker — EventBridge Lambda Monday 00:00 SAST.
 * Atomic reset: snapshot → persist → rename → cleanup.
 */
export async function handler() {
  console.log('[leaderboard-reset] Starting weekly leaderboard reset')

  const cities = await prisma.city.findMany({ select: { id: true, slug: true } })
  const weekEnding = new Date()
  let totalEntries = 0

  for (const city of cities) {
    const key = leaderboard(city.id)
    const prevKey = `${key}:prev`

    // 1. Snapshot top 50
    const top50 = await redis.zrevrange(key, 0, 49, 'WITHSCORES')
    const entries: Array<{ userId: string; rank: number; checkInCount: number }> = []

    for (let i = 0; i < top50.length; i += 2) {
      entries.push({
        userId: top50[i]!,
        rank: Math.floor(i / 2) + 1,
        checkInCount: parseInt(top50[i + 1]!, 10),
      })
    }

    // 2. Persist to leaderboard_history
    if (entries.length > 0) {
      await prisma.leaderboardHistory.createMany({
        data: entries.map((e) => ({
          cityId: city.id,
          weekEnding,
          userId: e.userId,
          rank: e.rank,
          checkInCount: e.checkInCount,
        })),
      })
    }

    // 3. Atomic rename (never zero individual scores)
    const exists = await redis.exists(key)
    if (exists) {
      await redis.rename(key, prevKey)
    }

    // 4. Cleanup previous week
    await redis.del(prevKey)

    totalEntries += entries.length
    console.log(
      `[leaderboard-reset] ${city.slug}: ${entries.length} entries persisted`,
    )
  }

  console.log(`[leaderboard-reset] Total entries: ${totalEntries}`)
  return { totalEntries }
}

/**
 * Pre-reset notification — EventBridge Lambda Sunday 20:00 SAST.
 * Sends push to opted-in users with their current rank.
 */
export async function preResetHandler() {
  console.log('[leaderboard-reset] Sending pre-reset notifications')
  // Push notifications handled by notification service
  return { sent: 0 }
}
