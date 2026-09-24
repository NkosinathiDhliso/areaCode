/**
 * Going rows in the app-data table (proof-of-demand R9.1, R9.2, R9.9).
 *
 * No new table and no new infrastructure: two rows per mark in the existing
 * app-data table, both carrying a TTL so a past night's intent expires on its
 * own (`serverless-only.md`).
 *
 *  - venue row  `pk GOING#{nodeId}#{date}` / `sk USER#{userId}` — the countable
 *    one. A `Select: COUNT` query on the partition is the whole read.
 *  - mirror row `pk USER#{userId}` / `sk GOING#{date}#{nodeId}` — the erasure
 *    one. The cleanup worker already deletes by `pk USER#{userId}`, so it adds a
 *    `begins_with(sk, 'GOING#')` query and never a scan (task 10.8).
 *
 * The pair is written and deleted as one transaction, so a count can never
 * include a row that erasure cannot find, and erasure can never leave a counted
 * row behind.
 *
 * Idempotent by construction (R9.1): the mark is an `Update` that seeds
 * `markedAt` with `if_not_exists`, so marking twice is one row with the first
 * instant kept, and the delete carries no condition, so unmarking something that
 * is not there is a no-op rather than an error.
 */

import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'

import { goingRowTtlEpochSeconds, goingUserPk, goingUserSk, goingVenuePk, goingVenueSk } from './going.js'

/** One mark: which consumer, which venue, which night. */
export interface GoingKey {
  userId: string
  nodeId: string
  /** The Going night as a SAST calendar date (`YYYY-MM-DD`). */
  date: string
}

/**
 * Write the pair. Returns nothing: the caller re-reads the count so the number
 * it reports is the stored one, never an optimistic local guess.
 *
 * `remindAt` is the Tonight_Reminder opt-in (R9.6): the instant the consumer
 * asked to be told when the night starts. It is the flag the transition tick
 * filters on, not a schedule — the slot start is the tick's to know, and storing
 * a copy of it here would go stale the moment the owner edits the slot (R9.10).
 * Omitted leaves any existing opt-in alone, so a repeat mark never withdraws a
 * reminder the consumer asked for.
 */
export async function putGoing(key: GoingKey, nowIso: string, opts?: { remindAt?: string }): Promise<void> {
  const ttl = goingRowTtlEpochSeconds(key.date)
  const attributeNames = { '#date': 'date', '#ttl': 'ttl' }
  const attributeValues: Record<string, unknown> = {
    ':markedAt': nowIso,
    ':ttl': ttl,
    ':nodeId': key.nodeId,
    ':date': key.date,
    ':userId': key.userId,
  }
  // `markedAt` is seeded once and never moved, so a repeat tap cannot make an
  // early intent look late. The TTL is refreshed because it is a property of the
  // night, not of the tap.
  let update =
    'SET markedAt = if_not_exists(markedAt, :markedAt), #ttl = :ttl, ' +
    'nodeId = :nodeId, #date = :date, userId = :userId'
  if (opts?.remindAt !== undefined) {
    update += ', remindAt = :remindAt'
    attributeValues[':remindAt'] = opts.remindAt
  }

  await documentClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TableNames.appData,
            Key: { pk: goingVenuePk(key.nodeId, key.date), sk: goingVenueSk(key.userId) },
            UpdateExpression: update,
            ExpressionAttributeNames: attributeNames,
            ExpressionAttributeValues: attributeValues,
          },
        },
        {
          Update: {
            TableName: TableNames.appData,
            Key: { pk: goingUserPk(key.userId), sk: goingUserSk(key.nodeId, key.date) },
            UpdateExpression: update,
            ExpressionAttributeNames: attributeNames,
            ExpressionAttributeValues: attributeValues,
          },
        },
      ],
    }),
  )
}

/** Remove the pair. Unconditional, so unmarking what was never marked is not an error. */
export async function deleteGoing(key: GoingKey): Promise<void> {
  await documentClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: TableNames.appData,
            Key: { pk: goingVenuePk(key.nodeId, key.date), sk: goingVenueSk(key.userId) },
          },
        },
        {
          Delete: {
            TableName: TableNames.appData,
            Key: { pk: goingUserPk(key.userId), sk: goingUserSk(key.nodeId, key.date) },
          },
        },
      ],
    }),
  )
}

/**
 * How many consumers have marked going at one venue for one night.
 *
 * `Select: COUNT` so no row bodies cross the wire: the owner surface and the
 * consumer card both want a number, and a count read should not be able to leak
 * who is in the partition. Expired-but-unswept rows are filtered out, so the
 * number is always the honest current one.
 */
export async function countGoing(nodeId: string, date: string, nowEpochSeconds: number): Promise<number> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.appData,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      FilterExpression: 'attribute_not_exists(#ttl) OR #ttl > :now',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':pk': goingVenuePk(nodeId, date), ':skPrefix': 'USER#', ':now': nowEpochSeconds },
      Select: 'COUNT',
    }),
  )
  return result.Count ?? 0
}

/**
 * Whether this consumer has marked going. One `GetItem`, so the control can
 * render its own state without reading anyone else's row.
 */
export async function isGoing(key: GoingKey, nowEpochSeconds: number): Promise<boolean> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.appData,
      Key: { pk: goingVenuePk(key.nodeId, key.date), sk: goingVenueSk(key.userId) },
    }),
  )
  if (!result.Item) return false
  const ttl = result.Item['ttl'] as number | undefined
  return !(ttl !== undefined && ttl <= nowEpochSeconds)
}

// ─── Tonight_Reminder (R9.6, R9.7) ───────────────────────────────────────────

/** A Going row that opted into the Tonight_Reminder and has not been sent one. */
export interface GoingReminderRow {
  userId: string
  nodeId: string
  date: string
}

/**
 * Every Going row for one venue and night that asked for a reminder and has not
 * had one yet.
 *
 * Bounded by the venue partition, so the transition tick reads one query per
 * venue whose Dated_Slot is starting and never a scan. Rows without `remindAt`
 * are filtered in DynamoDB, so a night where nobody opted in costs one empty
 * query.
 */
export async function listGoingAwaitingReminder(
  nodeId: string,
  date: string,
  nowEpochSeconds: number,
): Promise<GoingReminderRow[]> {
  const rows: GoingReminderRow[] = []
  let cursor: Record<string, unknown> | undefined

  do {
    const result = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.appData,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        FilterExpression:
          'attribute_exists(remindAt) AND attribute_not_exists(reminded) AND ' +
          '(attribute_not_exists(#ttl) OR #ttl > :now)',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':pk': goingVenuePk(nodeId, date),
          ':skPrefix': 'USER#',
          ':now': nowEpochSeconds,
        },
        ProjectionExpression: 'userId',
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }),
    )
    for (const item of result.Items ?? []) {
      const userId = item['userId']
      if (typeof userId === 'string' && userId !== '') rows.push({ userId, nodeId, date })
    }
    cursor = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (cursor)

  return rows
}

/**
 * Claim one row's reminder. Returns true when this call is the one that won.
 *
 * Claim before send, not after: a duplicate tick or a re-run must never put a
 * second notification on a consumer's phone, and the conditional update is the
 * only thing that can make "once per row" true under concurrency (R9.7). The
 * trade is that a delivery failure after the claim loses that reminder rather
 * than repeating it, which is the right way round for a push we cannot recall.
 *
 * Only the venue row is claimed. The mirror row exists for erasure lookups, and
 * giving it a second copy of the sent state would be two places to disagree.
 */
export async function claimGoingReminder(key: GoingKey, nowIso: string): Promise<boolean> {
  try {
    await documentClient.send(
      new UpdateCommand({
        TableName: TableNames.appData,
        Key: { pk: goingVenuePk(key.nodeId, key.date), sk: goingVenueSk(key.userId) },
        UpdateExpression: 'SET reminded = :now',
        ConditionExpression: 'attribute_exists(remindAt) AND attribute_not_exists(reminded)',
        ExpressionAttributeValues: { ':now': nowIso },
      }),
    )
    return true
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false
    throw err
  }
}

// ─── Erasure (R9.9) ──────────────────────────────────────────────────────────

/**
 * Every night this consumer marked going, read from their own partition.
 *
 * This is the reason the mirror row exists: `pk USER#{userId}` plus
 * `begins_with(sk, 'GOING#')` finds all of them with no scan, which is what
 * makes erasure affordable (R9.9).
 */
export async function listGoingMirrorRows(userId: string): Promise<GoingKey[]> {
  const keys: GoingKey[] = []
  let cursor: Record<string, unknown> | undefined

  do {
    const result = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.appData,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: { ':pk': goingUserPk(userId), ':skPrefix': 'GOING#' },
        ProjectionExpression: 'nodeId, #date',
        ExpressionAttributeNames: { '#date': 'date' },
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }),
    )
    for (const item of result.Items ?? []) {
      const nodeId = item['nodeId']
      const date = item['date']
      if (typeof nodeId === 'string' && typeof date === 'string') keys.push({ userId, nodeId, date })
    }
    cursor = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (cursor)

  return keys
}

/**
 * Delete every Going pair belonging to one consumer (R9.9).
 *
 * Both rows of each pair go, through the same transaction the write path uses,
 * so the venue count drops by exactly the marks this person made and no counted
 * row is left pointing at a person who no longer exists. Returns the number of
 * pairs removed.
 *
 * Idempotent: the deletes carry no condition, so a retried erasure run is a
 * no-op rather than an error.
 */
export async function deleteGoingRowsForUser(userId: string): Promise<number> {
  const keys = await listGoingMirrorRows(userId)
  for (const key of keys) {
    await deleteGoing(key)
  }
  return keys.length
}

// ─── Digest (R9.8) ───────────────────────────────────────────────────────────

/** One consumer's mark at one venue on one night, as the digest reads it. */
export interface GoingMark {
  userId: string
  nodeId: string
  date: string
}

/**
 * Every mark recorded at one venue on one night.
 *
 * The digest needs the consumer ids, not just the count, because the line it
 * builds joins them to that night's check-ins. Bounded to one partition per
 * (venue, night), so the weekly pass costs seven queries per venue and no scan.
 * Expired-but-unswept rows are filtered, so the week's figure matches what the
 * owner was shown live.
 */
export async function listGoingMarks(nodeId: string, date: string, nowEpochSeconds: number): Promise<GoingMark[]> {
  const marks: GoingMark[] = []
  let cursor: Record<string, unknown> | undefined

  do {
    const result = await documentClient.send(
      new QueryCommand({
        TableName: TableNames.appData,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        FilterExpression: 'attribute_not_exists(#ttl) OR #ttl > :now',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':pk': goingVenuePk(nodeId, date),
          ':skPrefix': 'USER#',
          ':now': nowEpochSeconds,
        },
        ProjectionExpression: 'userId',
        ...(cursor ? { ExclusiveStartKey: cursor } : {}),
      }),
    )
    for (const item of result.Items ?? []) {
      const userId = item['userId']
      if (typeof userId === 'string' && userId !== '') marks.push({ userId, nodeId, date })
    }
    cursor = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (cursor)

  return marks
}
