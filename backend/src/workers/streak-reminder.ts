// Streak-at-risk reminder worker — the "don't let your streak break" nudge.
//
// Feature: churn-defences (streak-at-risk reminder)
//
// An EventBridge Lambda that runs once in the SAST evening. It scans consumers
// who hold an active streak, and for the ones who opted in to the "Streak at
// risk" toggle (`streakAtRisk`, off by default) and have NOT yet checked in
// today, it sends a single reminder before the day ends.
//
// Honest by construction:
//   - The risk decision is the pure `isStreakAtRisk` (streak.ts): only a user
//     whose last check-in was YESTERDAY (SAST) and not today is at risk. A user
//     who already checked in today is safe (no nag); a user whose streak already
//     broke is skipped (we never warn about a streak they no longer have).
//   - Delivery goes through the shared `sendNotification` (socket-primary,
//     push-fallback, writes the notification center), gated by the user's
//     `streakAtRisk` preference.
//   - A per-user/day dedup key guarantees at most one reminder per user per SAST
//     day even if the schedule fires more than once.
//
// Serverless-only: no always-on resource, just this EventBridge-driven handler.
import { ScanCommand } from '@aws-sdk/lib-dynamodb'

import { getCheckInsByUser } from '../features/check-in/dynamodb-repository.js'
import { toSASTDate, sastDateForOffset, isStreakAtRisk } from '../features/check-in/streak.js'
import { getPreferences, sendNotification } from '../features/notifications/service.js'
import { documentClient, TableNames } from '../shared/db/dynamodb.js'
import { kvGet, kvSet } from '../shared/kv/dynamodb-kv.js'

/** At-most-once-per-day dedup TTL (26h covers a late run + the next day's run). */
const DEDUP_TTL_SECONDS = 26 * 60 * 60

function dedupKey(userId: string, todaySast: string): string {
  return `notif:streak_reminder:${userId}:${todaySast}`
}

/**
 * Scan every consumer holding a streak and remind the at-risk, opted-in ones.
 * Paginates the users table (same Scan pattern as the other workers). Per-user
 * failures are logged and skipped so one bad row never aborts the sweep.
 */
export async function handler() {
  console.log('[streak-reminder] Starting streak-at-risk reminder worker')

  const nowMs = Date.now()
  const todaySast = sastDateForOffset(nowMs, 0)
  const yesterdaySast = sastDateForOffset(nowMs, -1)

  let scanned = 0
  let reminded = 0
  let lastKey: Record<string, unknown> | undefined

  do {
    const result = await documentClient.send(
      new ScanCommand({
        TableName: TableNames.users,
        // Only users with a live streak are candidates. Lock rows (email/sub)
        // carry no streakCount and are excluded by this filter.
        FilterExpression: 'streakCount >= :one',
        ExpressionAttributeValues: { ':one': 1 },
        ProjectionExpression: 'userId, streakCount',
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    )

    for (const item of result.Items || []) {
      const userId = item['userId'] as string
      const streakCount = (item['streakCount'] as number) ?? 0
      scanned++

      try {
        // Respect the opt-in toggle up front so we never write a notification
        // (or even do the check-in lookup) for users who did not ask for it.
        const prefs = await getPreferences(userId)
        if ((prefs as { streakAtRisk?: boolean }).streakAtRisk !== true) continue

        // At most one reminder per user per SAST day.
        const key = dedupKey(userId, todaySast)
        if (await kvGet(key)) continue

        // Resolve the user's most recent check-in date (SAST).
        const { checkIns } = await getCheckInsByUser(userId, { limit: 1 })
        const lastCheckInSastDate = checkIns[0] ? toSASTDate(checkIns[0].checkedInAt) : null

        if (
          !isStreakAtRisk({
            streakCount,
            lastCheckInSastDate,
            todaySastDate: todaySast,
            yesterdaySastDate: yesterdaySast,
          })
        ) {
          continue
        }

        await sendNotification({
          userId,
          type: 'streak_at_risk',
          title: 'Your streak is about to break',
          body: `Check in anywhere today to keep your ${streakCount}-day streak alive.`,
          data: { streakCount, sastDate: todaySast },
        })

        // Mark done only after a send attempt so a mid-run crash can retry.
        await kvSet(key, '1', DEDUP_TTL_SECONDS)
        reminded++
      } catch (err) {
        console.warn(`[streak-reminder] skipped user ${userId}: ${String(err)}`)
      }
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (lastKey)

  console.log(`[streak-reminder] Reminded ${reminded} of ${scanned} streak-holders`)
  return { scanned, reminded }
}
