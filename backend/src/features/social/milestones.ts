import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'

/**
 * Shareable milestones (R11.5).
 *
 * Milestones are stored in the existing `app-data` table as
 * `pk: MILESTONE#{userId}`, `sk: {type}#{qualifier}`. Writes are idempotent via
 * a conditional put on `attribute_not_exists(sk)` so the same milestone is never
 * duplicated in the feed (Property 13, R11.5.5).
 *
 * `streakMilestoneFor` is a pure helper, exported for property testing.
 */

export type MilestoneType = 'first_checkin' | 'tier_up' | 'streak' | 'rank'

export interface MilestoneRecord {
  type: MilestoneType
  qualifier: string
  title: string
  body: string
  createdAt: string
}

/** Streak day counts that earn a milestone (R11.5.1). */
export const STREAK_MILESTONES: readonly number[] = [3, 7, 14, 30]

/** Pure: the streak milestone this exact streak count hits, or null. */
export function streakMilestoneFor(streak: number): number | null {
  return STREAK_MILESTONES.includes(streak) ? streak : null
}

/**
 * Idempotent milestone writer. Returns true when a new record was written,
 * false when it already existed (swallowed `ConditionalCheckFailedException`).
 */
export async function recordMilestone(userId: string, rec: MilestoneRecord): Promise<boolean> {
  const sk = `${rec.type}#${rec.qualifier}`
  try {
    await documentClient.send(
      new PutCommand({
        TableName: TableNames.appData,
        Item: {
          pk: `MILESTONE#${userId}`,
          sk,
          type: rec.type,
          qualifier: rec.qualifier,
          title: rec.title,
          body: rec.body,
          createdAt: rec.createdAt,
        },
        ConditionExpression: 'attribute_not_exists(sk)',
      }),
    )
    return true
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'ConditionalCheckFailedException') return false
    throw e
  }
}

export interface MilestoneFeedItem {
  id: string
  feedType: 'milestone'
  checkedInAt: string
  milestoneType: MilestoneType
  title: string
  body: string
}

/**
 * Read a user's recent milestones as feed items, most recent first. Sorted by
 * `createdAt` in memory (the table sort key is `type#qualifier`, not time).
 */
export async function getRecentMilestones(userId: string, limit = 10): Promise<MilestoneFeedItem[]> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': `MILESTONE#${userId}` },
    }),
  )
  const items = (result.Items ?? []).map((i) => ({
    id: `milestone-${i['type']}-${i['qualifier']}`,
    feedType: 'milestone' as const,
    checkedInAt: (i['createdAt'] as string) ?? new Date(0).toISOString(),
    milestoneType: i['type'] as MilestoneType,
    title: (i['title'] as string) ?? '',
    body: (i['body'] as string) ?? '',
  }))
  items.sort((a, b) => Date.parse(b.checkedInAt) - Date.parse(a.checkedInAt))
  return items.slice(0, limit)
}
