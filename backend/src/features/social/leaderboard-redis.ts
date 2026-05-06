// Redis ZSET-backed leaderboard — replaces the single-partition DynamoDB
// `LEADERBOARD#${cityId}` hot item that caps at 1000 WCU.
//
// Key layout:
//   ac:lb:city:{cityId}:{weekEnding}   — ZSET score=checkInCount member=userId
//   ac:lb:city:{cityId}:current        — alias ZSET for the live week (ZUNIONSTORE / rename on weekly reset)
//
// Operations:
//   bumpCheckIn(cityId, userId)       — ZINCRBY (atomic, O(log N))
//   getTopN(cityId, N)                — ZREVRANGE WITHSCORES
//   getUserRank(cityId, userId)       — ZREVRANK (gives true rank, not just top-50)
//
// Falls back to null / empty if REDIS_URL is not configured — callers should
// treat that as "leaderboard temporarily unavailable" (503) rather than silently
// returning wrong data.
import { getRedis } from '../../shared/db/redis.js'

function currentWeekEnding(now = new Date()): string {
  // Sunday 23:59:59 UTC of the current ISO week.
  const d = new Date(now)
  const day = d.getUTCDay() // 0=Sun..6=Sat
  const daysToSunday = day === 0 ? 0 : 7 - day
  d.setUTCDate(d.getUTCDate() + daysToSunday)
  d.setUTCHours(23, 59, 59, 0)
  return d.toISOString().slice(0, 10)
}

function currentKey(cityId: string): string {
  return `ac:lb:city:${cityId}:${currentWeekEnding()}`
}

export async function bumpCheckIn(cityId: string, userId: string, delta = 1): Promise<number | null> {
  const r = getRedis()
  if (!r) return null
  const key = currentKey(cityId)
  const newScore = await r.zincrby(key, delta, userId)
  // Keep leaderboard 14 days then expire (history is persisted separately).
  await r.expire(key, 14 * 24 * 3600)
  return Number(newScore)
}

export async function getTopN(
  cityId: string,
  n = 50,
): Promise<Array<{ userId: string; checkInCount: number; rank: number }> | null> {
  const r = getRedis()
  if (!r) return null
  const raw = await r.zrevrange(currentKey(cityId), 0, n - 1, 'WITHSCORES')
  const out: Array<{ userId: string; checkInCount: number; rank: number }> = []
  for (let i = 0; i < raw.length; i += 2) {
    out.push({ userId: raw[i]!, checkInCount: Number(raw[i + 1]), rank: i / 2 + 1 })
  }
  return out
}

export async function getUserRank(
  cityId: string,
  userId: string,
): Promise<{ rank: number; checkInCount: number } | null> {
  const r = getRedis()
  if (!r) return null
  const key = currentKey(cityId)
  const [rank, score] = await Promise.all([r.zrevrank(key, userId), r.zscore(key, userId)])
  if (rank === null || score === null) return null
  return { rank: rank + 1, checkInCount: Number(score) }
}

export async function resetLeaderboard(cityId: string, weekEnding: string): Promise<void> {
  const r = getRedis()
  if (!r) return
  // Archive is handled by the weekly worker which reads ZREVRANGE and writes to DDB history,
  // then we DEL the week's key here.
  await r.del(`ac:lb:city:${cityId}:${weekEnding}`)
}
