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
// upsert also recomputes `nextTransitionAt` from the slot list and the
// schedule's IANA timezone (R3.10, R11.4) — slot starts and slot ends are the
// only points where the active-slot resolution can change for a weekly
// recurring schedule, so the GSI sort key is always one of those boundary
// timestamps in UTC.

import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'

import { documentClient, TableNames } from '../../shared/db/dynamodb.js'

import { ScheduleValidationError, validateMusicSchedule } from '@area-code/shared/lib/schedule-validator'
import type { MusicSchedule, ScheduleDayOfWeek, ScheduleSlot } from '@area-code/shared/types'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Constant partition key on the `ByNextTransition` GSI. The GSI is sparse:
 *  schedules without slots omit `gsi1pk`/`nextTransitionAt`, so they do not
 *  appear in the GSI at all. */
const NEXT_TRANSITION_GSI_PK = 'NEXT_TRANSITION'

const NEXT_TRANSITION_GSI_NAME = 'ByNextTransition'

/** Map a `ScheduleDayOfWeek` to its 0..6 weekday number where MON = 0,
 *  matching the natural week ordering used by `nextTransitionAt`. (We pick
 *  Monday-first because the data model already uses MON..SUN ordering.) */
const DAY_TO_INDEX: Readonly<Record<ScheduleDayOfWeek, number>> = Object.freeze({
  MON: 0,
  TUE: 1,
  WED: 2,
  THU: 3,
  FRI: 4,
  SAT: 5,
  SUN: 6,
})

const MINUTES_PER_DAY = 24 * 60
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY

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
// nextTransitionAt computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the soonest upcoming slot-boundary transition (slot start or slot
 * end) for the given schedule, expressed as an ISO-8601 timestamp in UTC.
 *
 * The algorithm walks the slot list and, for each `(slotStart, slotEnd)`
 * pair, finds the next time after `now` (in the schedule's timezone) at
 * which that boundary fires given the weekly recurrence. The minimum across
 * all boundaries is the schedule's `nextTransitionAt`.
 *
 * Returns `undefined` when the schedule has no slots — the caller MUST then
 * also omit the GSI partition key so the row stays out of the sparse GSI
 * (R3.10, design "MusicSchedules table").
 *
 * Pure: no I/O, no globals, no `Date.now()` — the caller passes `nowIso`.
 */
export function computeNextTransitionAt(schedule: MusicSchedule, nowIso: string): string | undefined {
  if (schedule.slots.length === 0) return undefined

  const now = new Date(nowIso)
  if (Number.isNaN(now.getTime())) {
    throw new RangeError(`computeNextTransitionAt: nowIso is not a valid ISO-8601 timestamp (${nowIso})`)
  }

  // Determine the schedule-local week-minute of `now` (0..MINUTES_PER_WEEK-1)
  // and the offset between local time and UTC at that instant. We need the
  // offset to translate week-minute back into a UTC timestamp.
  const local = formatLocalWeekParts(now, schedule.timezone)

  let bestDeltaMin = Number.POSITIVE_INFINITY
  for (const slot of schedule.slots) {
    const slotDay = DAY_TO_INDEX[slot.dayOfWeek]
    const startWeekMin = slotDay * MINUTES_PER_DAY + slot.startTimeMin
    const endWeekMin = slotDay * MINUTES_PER_DAY + slot.endTimeMin

    const deltaToStart = forwardDelta(local.weekMinute, startWeekMin)
    const deltaToEnd = forwardDelta(local.weekMinute, endWeekMin)

    if (deltaToStart < bestDeltaMin) bestDeltaMin = deltaToStart
    if (deltaToEnd < bestDeltaMin) bestDeltaMin = deltaToEnd
  }

  // Build a UTC timestamp `bestDeltaMin` minutes after `now`.
  // `now.getTime()` is UTC ms; we add an integer number of minutes. DST
  // shifts in the schedule's local timezone are absorbed by the next tick
  // (the schedule-transition-tick re-queries `nextTransitionAt` every 60s
  // anyway, so a one-tick error during a DST jump is the worst case).
  const transitionMs = now.getTime() + bestDeltaMin * 60 * 1000
  return new Date(transitionMs).toISOString()
}

/** Return how many minutes from `fromWeekMin` to the next occurrence of
 *  `toWeekMin`, modulo a week. Always returns a value in `[1, MINUTES_PER_WEEK]`
 *  — equality maps to a full week ahead so we never return `0` (a transition
 *  exactly at `now` has already fired and the next one is a week away). */
function forwardDelta(fromWeekMin: number, toWeekMin: number): number {
  const raw = toWeekMin - fromWeekMin
  if (raw <= 0) return raw + MINUTES_PER_WEEK
  return raw
}

interface LocalWeekParts {
  weekMinute: number // 0..MINUTES_PER_WEEK-1, MON 00:00 = 0
}

const WEEKDAY_TO_INDEX: Readonly<Record<string, number>> = Object.freeze({
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
})

/** Convert a UTC `Date` to its `(weekday, hour, minute)` parts in the given
 *  IANA timezone via `Intl.DateTimeFormat`, then collapse into a single
 *  minute-of-week value (MON 00:00 = 0). The schedule's timezone has been
 *  validated upstream, so this never throws for unknown ids. */
function formatLocalWeekParts(date: Date, timezone: string): LocalWeekParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = fmt.formatToParts(date)

  let weekdayRaw: string | undefined
  let hourRaw: string | undefined
  let minuteRaw: string | undefined
  for (const part of parts) {
    if (part.type === 'weekday') weekdayRaw = part.value
    else if (part.type === 'hour') hourRaw = part.value
    else if (part.type === 'minute') minuteRaw = part.value
  }

  if (
    weekdayRaw === undefined ||
    hourRaw === undefined ||
    minuteRaw === undefined ||
    WEEKDAY_TO_INDEX[weekdayRaw] === undefined
  ) {
    throw new Error(
      `computeNextTransitionAt: Intl.DateTimeFormat returned unexpected parts (weekday=${String(
        weekdayRaw,
      )}, hour=${String(hourRaw)}, minute=${String(minuteRaw)})`,
    )
  }

  let hour = Number.parseInt(hourRaw, 10)
  const minute = Number.parseInt(minuteRaw, 10)
  if (hour === 24) hour = 0

  const dayIdx = WEEKDAY_TO_INDEX[weekdayRaw]!
  return { weekMinute: dayIdx * MINUTES_PER_DAY + hour * 60 + minute }
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
  // GSI fields. Both omitted when `slots` is empty so the row stays out of
  // the sparse `ByNextTransition` GSI (R3.10).
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
