// DynamoDB-backed Music_Schedule repository.
//
// Implements the table accessor described in the live-vibe-on-map design
// ("Backend: R3 Music Schedule data model"):
//
//   PK = BUSINESS#<businessId>
//   SK = SCHEDULE#<scheduleId>
//   GSI ByNextTransition (sparse)
//     gsi1pk = "NEXT_TRANSITION"  (constant)
//     gsi1sk = nextTransitionAt   (ISO-8601, omitted for empty schedules)
//
// Every write goes through `validateMusicSchedule` from the shared package so
// an unvalidated schedule can never be persisted (R3.5, R3.7, R3.9). Every
// upsert also recomputes `nextTransitionAt` (R3.10, R11.4) through
// `schedule-transitions.ts`, which owns that arithmetic for both weekly and
// dated slots. The GSI sort key is always one of those boundary timestamps in
// UTC.
//
// `validateMusicSchedule` is deliberately called here WITHOUT
// `todayLocalDate`: the Dated_Slot 14-day horizon is a write-time rule owned by
// the handler, and applying it to a stored schedule would make a slot that was
// legal when published block every later write once it aged.

import { ScheduleValidationError, validateMusicSchedule } from '@area-code/shared/lib/schedule-validator'
import type { MusicSchedule, ScheduleSlot } from '@area-code/shared/types'
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'

import { computeNextTransitionAt } from './schedule-transitions.js'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Constant partition key on the `ByNextTransition` GSI. The GSI is sparse:
 *  schedules without slots omit `gsi1pk`/`nextTransitionAt`, so they do not
 *  appear in the GSI at all. */
const NEXT_TRANSITION_GSI_PK = 'NEXT_TRANSITION'

const NEXT_TRANSITION_GSI_NAME = 'ByNextTransition'

/**
 * The one schedule id every route and read uses. The on-disk model supports
 * several schedules per business, but the public API and every reader keep a 1:1
 * business-to-schedule convention, so the id lives here rather than being
 * retyped by each caller (the schedule handler and the Tonight reader).
 */
export const DEFAULT_SCHEDULE_ID = 'default'

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** Result row from `queryNextTransitions`. */
export interface NextTransitionRow {
  businessId: string
  scheduleId: string
  nextTransitionAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Key helpers
// ─────────────────────────────────────────────────────────────────────────────

function pk(businessId: string): string {
  return `BUSINESS#${businessId}`
}

function sk(scheduleId: string): string {
  return `SCHEDULE#${scheduleId}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Item shape on disk
// ─────────────────────────────────────────────────────────────────────────────

interface ScheduleItem {
  pk: string
  sk: string
  businessId: string
  scheduleId: string
  timezone: string
  slots: ScheduleSlot[]
  updatedAt: string
  schemaVersion: 1
  // GSI fields. Both omitted when the schedule has no future transition (no
  // slots, or only dated slots whose boundaries have all passed) so the row
  // stays out of the sparse `ByNextTransition` GSI (R3.10).
  gsi1pk?: string
  nextTransitionAt?: string
}

function toItem(schedule: MusicSchedule, nowIso: string): ScheduleItem {
  const item: ScheduleItem = {
    pk: pk(schedule.businessId),
    sk: sk(schedule.scheduleId),
    businessId: schedule.businessId,
    scheduleId: schedule.scheduleId,
    timezone: schedule.timezone,
    slots: schedule.slots,
    updatedAt: schedule.updatedAt,
    schemaVersion: 1,
  }
  const nextTransitionAt = computeNextTransitionAt(schedule, nowIso)
  if (nextTransitionAt !== undefined) {
    item.gsi1pk = NEXT_TRANSITION_GSI_PK
    item.nextTransitionAt = nextTransitionAt
  }
  return item
}

function fromItem(item: Record<string, unknown>): MusicSchedule {
  return {
    businessId: item['businessId'] as string,
    scheduleId: item['scheduleId'] as string,
    timezone: item['timezone'] as string,
    slots: (item['slots'] as ScheduleSlot[]) ?? [],
    updatedAt: item['updatedAt'] as string,
    schemaVersion: 1,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

/** Read a single Music_Schedule by `(businessId, scheduleId)`. Returns
 *  `null` when the row does not exist. */
export async function getSchedule(businessId: string, scheduleId: string): Promise<MusicSchedule | null> {
  const result = await documentClient.send(
    new GetCommand({
      TableName: TableNames.musicSchedules,
      Key: { pk: pk(businessId), sk: sk(scheduleId) },
    }),
  )
  if (!result.Item) return null
  return fromItem(result.Item)
}

/**
 * Upsert (validate, canonicalise, write) a Music_Schedule. The schedule is
 * always re-validated server-side (R3 invariants) regardless of what the
 * caller passes; an invalid schedule throws `ScheduleValidationError` and
 * never reaches DynamoDB.
 *
 * Refreshes `updatedAt` to the current wall-clock instant (R3.10) and
 * recomputes `nextTransitionAt` from the slot list and the schedule's IANA
 * timezone (R11.4). Returns the canonicalised value that was written.
 */
export async function upsertSchedule(schedule: MusicSchedule): Promise<MusicSchedule> {
  const nowIso = new Date().toISOString()
  const canonical: MusicSchedule = { ...schedule, updatedAt: nowIso }

  const validation = validateMusicSchedule(canonical)
  if (!validation.ok) throw validation.error

  const validated = validation.value
  const item = toItem(validated, nowIso)

  await documentClient.send(
    new PutCommand({
      TableName: TableNames.musicSchedules,
      Item: item,
    }),
  )

  return validated
}

/**
 * Remove a single Schedule_Slot from an existing Music_Schedule. Reads the
 * current schedule, drops the slot whose `slotId` matches, recomputes
 * `nextTransitionAt`, and writes back the canonicalised schedule.
 *
 * Throws `ScheduleValidationError` when the schedule does not exist or the
 * slot is not present, so callers can surface a 404 / 400 without a second
 * round-trip.
 */
export async function deleteScheduleSlot(
  businessId: string,
  scheduleId: string,
  slotId: string,
): Promise<MusicSchedule> {
  const existing = await getSchedule(businessId, scheduleId)
  if (!existing) {
    throw new ScheduleValidationError({
      code: 'schema_shape',
      field: 'scheduleId',
      message: `Music_Schedule not found: ${businessId}/${scheduleId}`,
    })
  }

  const remaining = existing.slots.filter((s) => s.slotId !== slotId)
  if (remaining.length === existing.slots.length) {
    throw new ScheduleValidationError({
      code: 'schema_shape',
      field: 'slotId',
      message: `Schedule_Slot not found: ${slotId}`,
      slotId,
    })
  }

  const updated: MusicSchedule = { ...existing, slots: remaining }
  return upsertSchedule(updated)
}

/**
 * Hard-delete the entire Music_Schedule row (used when the operator removes
 * a venue's schedule wholesale). Not part of the R5 task but exposed because
 * the same key shape is needed by ops cleanups.
 */
export async function deleteSchedule(businessId: string, scheduleId: string): Promise<void> {
  await documentClient.send(
    new DeleteCommand({
      TableName: TableNames.musicSchedules,
      Key: { pk: pk(businessId), sk: sk(scheduleId) },
    }),
  )
}

/**
 * Query the `ByNextTransition` GSI for schedules whose `nextTransitionAt`
 * falls inside `[windowStart, windowEnd]` (both ISO-8601 strings, BETWEEN
 * inclusive). Used by the `schedule-transition-tick` Lambda to fan out
 * Evaluation_Ticks for venues whose Active_Slot is about to change.
 *
 * Returns one row per matching schedule with the minimum information the
 * tick needs — `(businessId, scheduleId, nextTransitionAt)` — so the tick
 * does not have to re-marshal the full schedule blob.
 */
export async function queryNextTransitions(windowStart: string, windowEnd: string): Promise<NextTransitionRow[]> {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: TableNames.musicSchedules,
      IndexName: NEXT_TRANSITION_GSI_NAME,
      KeyConditionExpression: 'gsi1pk = :pk AND nextTransitionAt BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':pk': NEXT_TRANSITION_GSI_PK,
        ':start': windowStart,
        ':end': windowEnd,
      },
    }),
  )

  const rows: NextTransitionRow[] = []
  for (const item of result.Items ?? []) {
    rows.push({
      businessId: item['businessId'] as string,
      scheduleId: item['scheduleId'] as string,
      nextTransitionAt: item['nextTransitionAt'] as string,
    })
  }
  return rows
}
