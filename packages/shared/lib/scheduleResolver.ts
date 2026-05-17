import type { LineupEntry, MusicSchedule, ScheduleDayOfWeek, ScheduleSlot } from '../types'
import { ScheduleValidationError, validateMusicSchedule } from './schedule-validator'

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of `resolveActiveSlot`. The `lineupEntry` field is present iff the
 * matched slot is in `lineup` mode (R5.7); for `blanket` mode it is omitted.
 */
export interface ResolvedSlot {
  slot: ScheduleSlot
  lineupEntry?: LineupEntry
}

/**
 * Internal error raised when the resolver lands in a state R3.7 was supposed
 * to make unreachable: a lineup-mode slot is active but no LineupEntry's
 * `startTimeMin` is `<=` the current local minutes (R5.8).
 *
 * R3.7 requires the first LineupEntry to start at the slot's `startTimeMin`,
 * so this condition can only fire on a programmer error (e.g. a validator
 * regression or a hand-written schedule that bypassed validation). The class
 * carries the offending `slotId` and the resolving `timestamp` so the caller
 * (the `live-archetype-evaluator` Lambda) can log and fall through per R7.4.
 */
export class ScheduleResolverInternalError extends Error {
  public readonly code = 'unreachable_lineup_branch' as const
  public readonly slotId: string
  public readonly timestamp: string

  constructor(args: { slotId: string; timestamp: string; message?: string }) {
    super(
      args.message ??
        `Schedule_Resolver internal error: lineup slot ${args.slotId} active at ${args.timestamp} but no covering LineupEntry was found`,
    )
    this.name = 'ScheduleResolverInternalError'
    this.slotId = args.slotId
    this.timestamp = args.timestamp
    Object.setPrototypeOf(this, ScheduleResolverInternalError.prototype)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map the Intl `weekday: 'short'` output (English: `Mon`..`Sun`) to the
 * three-letter uppercase code used by `ScheduleDayOfWeek`.
 *
 * `Intl.DateTimeFormat('en-US', { weekday: 'short' })` is locale-pinned so
 * the mapping is stable across runtimes. We pin to `en-US` regardless of the
 * caller's process locale for exactly this reason.
 */
const WEEKDAY_MAP: Readonly<Record<string, ScheduleDayOfWeek>> = Object.freeze({
  Mon: 'MON',
  Tue: 'TUE',
  Wed: 'WED',
  Thu: 'THU',
  Fri: 'FRI',
  Sat: 'SAT',
  Sun: 'SUN',
})

interface LocalParts {
  dayOfWeek: ScheduleDayOfWeek
  minutesSinceMidnight: number
}

/**
 * Convert a `Date` to `(dayOfWeek, minutesSinceMidnight)` in the given IANA
 * timezone via `Intl.DateTimeFormat.formatToParts`. The schedule's timezone
 * has already been validated by `validateMusicSchedule`, so the formatter
 * cannot throw here for unknown ids.
 *
 * Some runtimes emit `hour === '24'` for midnight when `hour12 === false`;
 * we normalise that to `0` so the minutes-since-midnight value is always in
 * `[0, 1439]`.
 */
function toLocalParts(date: Date, timezone: string): LocalParts {
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

  const dayOfWeek = weekdayRaw ? WEEKDAY_MAP[weekdayRaw] : undefined
  if (!dayOfWeek || hourRaw === undefined || minuteRaw === undefined) {
    // Should be unreachable given the formatter options; throw an internal
    // error so an upstream regression in Intl is caught loudly.
    throw new ScheduleResolverInternalError({
      slotId: '(formatter)',
      timestamp: date.toISOString(),
      message: `Schedule_Resolver internal error: Intl.DateTimeFormat returned unexpected parts (weekday=${String(
        weekdayRaw,
      )}, hour=${String(hourRaw)}, minute=${String(minuteRaw)})`,
    })
  }

  let hour = Number.parseInt(hourRaw, 10)
  const minute = Number.parseInt(minuteRaw, 10)
  if (hour === 24) hour = 0

  return { dayOfWeek, minutesSinceMidnight: hour * 60 + minute }
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveActiveSlot
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the unique Active_Slot (and, in lineup mode, the covering
 * LineupEntry) for a given Music_Schedule and timestamp.
 *
 * Behaviour summary (R5):
 *  - Returns `null` when no slot covers the timestamp (R5.5).
 *  - Returns `{ slot }` for blanket mode and `{ slot, lineupEntry }` for
 *    lineup mode (R5.4, R5.7).
 *  - Throws `ScheduleValidationError` for malformed timestamps (R5.2) or
 *    schedules that fail `validateMusicSchedule` (R5.3, R5.10, R5.11).
 *  - Throws `ScheduleResolverInternalError` if a lineup-mode slot is active
 *    but no LineupEntry covers the timestamp (R5.8). R3.7 makes this
 *    unreachable for validator-approved schedules; the caller is expected
 *    to catch and fall through per R7.4.
 *
 * The function is **observably pure** (R5.9): same inputs → same output, no
 * `Date.now()`, no globals, no I/O. The caller passes the timestamp in.
 */
export function resolveActiveSlot(schedule: MusicSchedule, timestampIso: string): ResolvedSlot | null {
  // ── R5.2: timestamp validation ────────────────────────────────────────────
  if (typeof timestampIso !== 'string' || timestampIso.length === 0) {
    throw new ScheduleValidationError({
      code: 'schema_shape',
      field: 'timestampIso',
      message: 'Schedule_Resolver: timestampIso must be a non-empty RFC 3339 string',
    })
  }
  const date = new Date(timestampIso)
  if (Number.isNaN(date.getTime())) {
    throw new ScheduleValidationError({
      code: 'schema_shape',
      field: 'timestampIso',
      message: `Schedule_Resolver: timestampIso is not a valid RFC 3339 timestamp (${timestampIso})`,
    })
  }

  // ── R5.3 / R5.10 / R5.11: schedule validation ─────────────────────────────
  // Re-validate even when callers have already validated upstream so that a
  // hand-built schedule passed straight into the resolver cannot bypass
  // R3 invariants the rest of this function relies on (especially R3.7's
  // first-LineupEntry-aligned-with-slot-start rule, which guarantees R5.7
  // always finds a match when a lineup slot is active).
  const validation = validateMusicSchedule(schedule)
  if (!validation.ok) {
    throw validation.error
  }
  const validated = validation.value

  // ── Convert to schedule-local (dayOfWeek, minutesSinceMidnight) ──────────
  const local = toLocalParts(date, validated.timezone)

  // ── R5.4: filter slots by dayOfWeek + half-open interval containment ────
  // The validator (R3.9) already guarantees no two slots on the same
  // dayOfWeek overlap, so at most one slot can match. We iterate the whole
  // list (rather than break on first match) so an unexpected double-match
  // surfaces as an internal error instead of silently returning the first.
  const matches: ScheduleSlot[] = []
  for (const slot of validated.slots) {
    if (slot.dayOfWeek !== local.dayOfWeek) continue
    if (slot.startTimeMin <= local.minutesSinceMidnight && local.minutesSinceMidnight < slot.endTimeMin) {
      matches.push(slot)
    }
  }

  if (matches.length === 0) {
    // R5.5
    return null
  }
  if (matches.length > 1) {
    // R5.6 / R3.9: the validator should have rejected overlapping slots.
    // Reaching here means a programmer bypassed the validator or a future
    // regression let an overlap through; surface it loudly.
    throw new ScheduleResolverInternalError({
      slotId: matches.map((s) => s.slotId).join(','),
      timestamp: timestampIso,
      message: `Schedule_Resolver internal error: ${matches.length} slots match (${matches
        .map((s) => s.slotId)
        .join(', ')}) at ${timestampIso}; validator should have rejected overlap`,
    })
  }

  const slot = matches[0]!

  // Blanket mode → return the slot alone (R5.4).
  if (slot.mode === 'blanket') {
    return { slot }
  }

  // ── R5.7: lineup mode → find LineupEntry with greatest startTimeMin ≤ now
  // R3.7 guarantees `slot.lineup` is non-empty, the first entry's
  // `startTimeMin` equals `slot.startTimeMin`, and entries have unique
  // `startTime`s — so exactly one entry always matches when the slot is
  // active. We do not assume sorted order; iterating once is O(n) for n ≤ 20.
  const lineup = slot.lineup
  if (!lineup || lineup.length === 0) {
    // Defensive: validator forbids this for lineup mode.
    throw new ScheduleResolverInternalError({
      slotId: slot.slotId,
      timestamp: timestampIso,
      message: `Schedule_Resolver internal error: lineup-mode slot ${slot.slotId} has empty lineup at ${timestampIso}`,
    })
  }

  let chosen: LineupEntry | undefined
  for (const entry of lineup) {
    if (entry.startTimeMin <= local.minutesSinceMidnight) {
      if (!chosen || entry.startTimeMin > chosen.startTimeMin) {
        chosen = entry
      }
    }
  }

  if (!chosen) {
    // Unreachable per R3.7 (first LineupEntry's startTimeMin === slot.startTimeMin
    // and the slot was matched because slot.startTimeMin <= minutesSinceMidnight).
    // Surface as an internal error per R5.8.
    throw new ScheduleResolverInternalError({
      slotId: slot.slotId,
      timestamp: timestampIso,
    })
  }

  return { slot, lineupEntry: chosen }
}
