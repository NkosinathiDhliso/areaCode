import { z } from 'zod'

import { MUSIC_GENRES } from '../constants/genre-weights'
import type { LineupEntry, MusicGenre, MusicSchedule, ScheduleSlot } from '../types'

import { NIGHT_ROLLOVER_HOUR_SAST } from './sast'

// HH:mm matching `^([01][0-9]|2[0-3]):[0-5][0-9]$` per R3.5.
const HH_MM_REGEX = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

// YYYY-MM-DD shape for a Dated_Slot's `date` (proof-of-demand R8.1). Shape
// only: calendar validity (no 2026-02-30) is checked in `validateMusicSchedule`
// so it surfaces with the `invalid_slot_date` code.
const YYYY_MM_DD_REGEX = /^\d{4}-\d{2}-\d{2}$/

const DAYS_OF_WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const

/** Max days ahead a Dated_Slot may be published (proof-of-demand R8.1). Past
 *  dates are accepted so a stale Tonight can never block a later write. */
export const DATED_SLOT_MAX_DAYS_AHEAD = 14

/** Max length of a Dated_Slot headline (proof-of-demand R8.1). */
export const HEADLINE_MAX_LENGTH = 60

const MINUTES_PER_DAY = 24 * 60

/**
 * The largest `endTimeMin` a Dated_Slot may derive: the night rollover on the
 * following morning (04:00 → 1680). A slot can never outlive the night it names.
 *
 * Derived from `NIGHT_ROLLOVER_HOUR_SAST` so the bound and the night rule are
 * one number, not two that can drift.
 */
export const DATED_SLOT_MAX_END_MIN = MINUTES_PER_DAY + NIGHT_ROLLOVER_HOUR_SAST * 60

// ─────────────────────────────────────────────────────────────────────────────
// Tagged validation error
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stable string codes for every validation failure raised by
 * `validateMusicSchedule`. The codes are stable so consumers (the
 * Schedule_Editor, the schedule-crud Lambda) can switch on them to render
 * field-specific UI without parsing free-form messages.
 */
export type ScheduleValidationCode =
  // Schema shape failures (Zod-level)
  | 'schema_shape'
  // Field validity (R3.4, R3.5, R3.11)
  | 'invalid_day_of_week'
  | 'invalid_time_format'
  | 'invalid_mode'
  | 'invalid_timezone'
  // Per-slot consistency (R3.5, R3.6, R3.7, R5.10)
  | 'invalid_slot_interval'
  | 'invalid_blanket_genres'
  | 'blanket_must_not_have_lineup'
  | 'invalid_lineup'
  | 'invalid_lineup_entry'
  | 'lineup_first_entry_misaligned'
  | 'lineup_entry_outside_slot'
  | 'lineup_duplicate_start_times'
  | 'lineup_must_not_have_top_genres'
  // Cross-slot consistency (R3.9)
  | 'overlapping_slots'
  // Dated_Slot rules (proof-of-demand R8.1, R8.2)
  | 'invalid_slot_date'
  | 'dated_slot_day_mismatch'
  | 'dated_slot_out_of_range'
  | 'dated_slot_end_past_rollover'
  | 'overlapping_dated_slots'

/**
 * Tagged error class for every validation failure. Carries:
 *  - `code`: the stable code (see `ScheduleValidationCode`)
 *  - `field`: the dotted-path field that failed (e.g. `'slots[0].endTime'`)
 *  - `slotId`: the offending slot's id when the failure is per-slot or cross-slot.
 *
 * The `name` is set to `'ScheduleValidationError'` so consumers can use
 * `instanceof` or duck-type on `error.name`.
 */
export class ScheduleValidationError extends Error {
  readonly name = 'ScheduleValidationError'
  readonly code: ScheduleValidationCode
  readonly field: string
  readonly slotId?: string

  constructor(args: { code: ScheduleValidationCode; field: string; message: string; slotId?: string }) {
    super(args.message)
    this.code = args.code
    this.field = args.field
    if (args.slotId !== undefined) this.slotId = args.slotId
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert an `HH:mm` string to minutes-since-midnight.
 * Caller must ensure the string already matched `HH_MM_REGEX`.
 */
function hhmmToMinutes(hhmm: string): number {
  const [hh, mm] = hhmm.split(':')
  return Number(hh) * 60 + Number(mm)
}

/**
 * The derived `endTimeMin`, which is where a night's day crossing lives.
 *
 * `endTime` stays a human `HH:mm` on the wire, so `02:00` reads as "ends at
 * 2am" to an owner and to anyone reading the row. The crossing is carried by the
 * derived minute value alone: for a Dated_Slot whose declared end is at or
 * before its start, the end is the same clock time on the following morning, so
 * `endTimeMin` runs past 1439 (21:00 → 02:00 is `[1260, 1560)`).
 *
 * Only a dated slot may cross. A weekly slot recurs on a weekday and has no date
 * to anchor a crossing to, so it genuinely must be two weekday slots (see the
 * `invalid_slot_interval` branch in `validateMusicSchedule`).
 *
 * Lineup entries are not crossed: an entry after midnight inside a dated slot
 * has a `startTimeMin` below the slot's start and is rejected as
 * `lineup_entry_outside_slot`. Tonight is a blanket-genre slot, and DJ lineups
 * live on the weekly grid, so nothing published today needs that.
 */
function deriveEndTimeMin(startTimeMin: number, endTime: string, date: string | undefined): number {
  const declared = hhmmToMinutes(endTime)
  if (date === undefined || declared > startTimeMin) return declared
  return declared + MINUTES_PER_DAY
}

/**
 * Parse a `YYYY-MM-DD` calendar date into its UTC midnight epoch ms, or
 * `null` when the string is not a real date (`2026-02-30`, `2026-13-01`).
 * The caller must ensure the string already matched `YYYY_MM_DD_REGEX`.
 *
 * Exported because the Dated_Slot rules (day-of-week agreement, the 14-day
 * horizon) and the resolver's shadowing check all need the same one parse.
 */
export function parseCalendarDate(date: string): number | null {
  if (!YYYY_MM_DD_REGEX.test(date)) return null
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const day = Number(date.slice(8, 10))
  const ms = Date.UTC(year, month - 1, day)
  if (Number.isNaN(ms)) return null
  // Reject dates the Date constructor rolled over (e.g. Feb 30 → Mar 2).
  const roundTrip = new Date(ms)
  if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) {
    return null
  }
  return ms
}

/** `ScheduleDayOfWeek` for a `YYYY-MM-DD` calendar date, MON-indexed to match
 *  `DAYS_OF_WEEK`. Returns `null` for a date that is not real. */
export function dayOfWeekForCalendarDate(date: string): (typeof DAYS_OF_WEEK)[number] | null {
  const ms = parseCalendarDate(date)
  if (ms === null) return null
  // getUTCDay: Sunday = 0 .. Saturday = 6; DAYS_OF_WEEK is MON-first.
  const mondayIndex = (new Date(ms).getUTCDay() + 6) % 7
  return DAYS_OF_WEEK[mondayIndex]!
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Returns true iff the given string is an IANA timezone identifier known to
 * the runtime. R3.11 + R5.11 require validation via `Intl.DateTimeFormat`,
 * which throws a `RangeError` for unknown ids.
 */
function isValidIanaTimezone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch (e) {
    if (e instanceof RangeError) return false
    // Unexpected error class - treat conservatively as invalid.
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

const HhMmSchema = z.string().regex(HH_MM_REGEX, { message: 'Time must match HH:mm (00:00 to 23:59)' })

const DayOfWeekSchema = z.enum(DAYS_OF_WEEK)

const ScheduleSlotModeSchema = z.enum(['blanket', 'lineup'])

const MusicGenreSchema: z.ZodType<MusicGenre> = z.enum(MUSIC_GENRES as [MusicGenre, ...MusicGenre[]])

/**
 * LineupEntry schema. `startTimeMin` is derived deterministically from
 * `startTime` on parse via `.transform`, so any redundant `startTimeMin`
 * supplied by the caller is overwritten and cannot drift (R3.7, design
 * "Property 6: Music_Schedule round-trip").
 *
 * `startTimeMin` is intentionally NOT validated on input - it is derived,
 * not declared. Callers may pass it (zod's default strip behaviour silently
 * discards unknown keys) but its value is never read.
 */
export const LineupEntrySchema = z
  .object({
    startTime: HhMmSchema,
    djName: z.string().min(1).max(60).optional(),
    genres: z
      .array(MusicGenreSchema)
      .min(1, { message: 'genres must have between 1 and 5 entries' })
      .max(5, { message: 'genres must have between 1 and 5 entries' })
      .refine((g) => new Set(g).size === g.length, { message: 'genres must be distinct' }),
  })
  .transform<LineupEntry>((raw) => {
    const entry: LineupEntry = {
      startTime: raw.startTime,
      startTimeMin: hhmmToMinutes(raw.startTime),
      genres: raw.genres,
    }
    if (raw.djName !== undefined) entry.djName = raw.djName
    return entry
  })

/**
 * ScheduleSlot schema. `startTimeMin` and `endTimeMin` are derived
 * deterministically from `startTime`/`endTime` via `.transform`. Mode-specific
 * shape is enforced in `validateMusicSchedule` so the editor + Lambda
 * surface field-level errors with stable codes.
 *
 * `startTimeMin` and `endTimeMin` are intentionally NOT validated on input -
 * they are derived, not declared, so any drifted caller-supplied values are
 * silently overwritten on parse. Being derived is what lets `endTimeMin` carry a
 * Dated_Slot's crossing past midnight while the wire shape stays unchanged: see
 * {@link deriveEndTimeMin}.
 */
export const ScheduleSlotSchema = z
  .object({
    slotId: z.string().min(1).max(128),
    dayOfWeek: DayOfWeekSchema,
    startTime: HhMmSchema,
    endTime: HhMmSchema,
    mode: ScheduleSlotModeSchema,
    genres: z.array(MusicGenreSchema).optional(),
    lineup: z.array(LineupEntrySchema).optional(),
    // Dated_Slot fields (R8.1). All three optional: a slot without `date` is
    // the unchanged weekly slot.
    date: z.string().regex(YYYY_MM_DD_REGEX, { message: 'date must match YYYY-MM-DD' }).optional(),
    headline: z.string().min(1).max(HEADLINE_MAX_LENGTH).optional(),
    featuredRewardId: z.string().min(1).max(128).optional(),
  })
  .transform<ScheduleSlot>((raw) => {
    const startTimeMin = hhmmToMinutes(raw.startTime)
    const slot: ScheduleSlot = {
      slotId: raw.slotId,
      dayOfWeek: raw.dayOfWeek,
      startTime: raw.startTime,
      endTime: raw.endTime,
      startTimeMin,
      endTimeMin: deriveEndTimeMin(startTimeMin, raw.endTime, raw.date),
      mode: raw.mode,
    }
    if (raw.genres !== undefined) slot.genres = raw.genres
    if (raw.lineup !== undefined) slot.lineup = raw.lineup as LineupEntry[]
    if (raw.date !== undefined) slot.date = raw.date
    if (raw.headline !== undefined) slot.headline = raw.headline
    if (raw.featuredRewardId !== undefined) slot.featuredRewardId = raw.featuredRewardId
    return slot
  })

/**
 * MusicSchedule schema. Shape only - per-slot, cross-slot, and timezone
 * validation runs in `validateMusicSchedule` so errors surface with the stable
 * tagged codes the editor and Lambda need. Schema-shape errors raised here
 * are translated to `ScheduleValidationError` with `code: 'schema_shape'`.
 */
export const MusicScheduleSchema = z
  .object({
    businessId: z.string().min(1).max(64),
    scheduleId: z.string().min(1).max(64),
    timezone: z.string().min(1),
    slots: z.array(ScheduleSlotSchema),
    updatedAt: z.string().min(1),
    schemaVersion: z.literal(1),
  })
  .transform<MusicSchedule>((raw) => ({
    businessId: raw.businessId,
    scheduleId: raw.scheduleId,
    timezone: raw.timezone,
    slots: raw.slots,
    updatedAt: raw.updatedAt,
    schemaVersion: 1,
  }))

// ─────────────────────────────────────────────────────────────────────────────
// validateMusicSchedule
// ─────────────────────────────────────────────────────────────────────────────

export type ValidationResult = { ok: true; value: MusicSchedule } | { ok: false; error: ScheduleValidationError }

/**
 * Optional context for rules that need a reference point the schedule itself
 * does not carry.
 *
 * `todayLocalDate` is the current calendar date (`YYYY-MM-DD`) in the
 * schedule's own timezone. It is supplied by the write path (the schedule
 * handler) to enforce the Dated_Slot 14-day horizon (R8.1) and deliberately
 * omitted everywhere a stored schedule is re-validated (repository upsert,
 * resolver read) so a slot that was legal when written can never become
 * unreadable or unwritable later.
 */
export interface ScheduleValidationOptions {
  todayLocalDate?: string
}

/**
 * Validate a Music_Schedule end-to-end and return either the canonicalised
 * value (with derived `startTimeMin`/`endTimeMin` overwritten) or a tagged
 * `ScheduleValidationError`.
 *
 * The validation order matches the design ("Backend: R3-R4 Schedule routes"):
 *   1. Schema shape (Zod) - R3.x
 *   2. Per-slot field validity (regex, enum, IANA timezone) - R3.4, R3.5, R3.11
 *   3. Per-slot internal consistency - R3.5, R3.6, R3.7, R5.10
 *   4. Cross-slot consistency (overlap detection) - R3.9
 *   5. Cross_Midnight_Pair pairing - R3.12 (accepts the two same-day slots
 *      the editor produced; same-day overlap is already enforced in step 4)
 *
 * Caller-supplied `startTimeMin` / `endTimeMin` (and `LineupEntry.startTimeMin`)
 * are silently overwritten with values derived from the `HH:mm` strings so
 * the redundant fields cannot drift on round-trip (design Property 6).
 */
/**
 * Dated_Slot field rules (R8.1). Returns the offending error, or `null` when
 * the slot is weekly (no `date`) or a valid Dated_Slot.
 *
 * `date` must be a real calendar date, `dayOfWeek` must agree with it so the
 * two fields can never contradict each other, and a newly published date may
 * not be more than `DATED_SLOT_MAX_DAYS_AHEAD` ahead of `todayLocalDate`. Past
 * dates are accepted: they simply never resolve, and rejecting them would let a
 * stale Tonight block every later write.
 */
function checkDatedSlot(
  slot: ScheduleSlot,
  fieldBase: string,
  todayLocalDate: string | undefined,
): ScheduleValidationError | null {
  if (slot.date === undefined) return null

  const dateMs = parseCalendarDate(slot.date)
  if (dateMs === null) {
    return new ScheduleValidationError({
      code: 'invalid_slot_date',
      field: `${fieldBase}.date`,
      slotId: slot.slotId,
      message: `Dated slot date must be a real calendar date in YYYY-MM-DD form (got ${slot.date})`,
    })
  }
  if (dayOfWeekForCalendarDate(slot.date) !== slot.dayOfWeek) {
    return new ScheduleValidationError({
      code: 'dated_slot_day_mismatch',
      field: `${fieldBase}.dayOfWeek`,
      slotId: slot.slotId,
      message: `Dated slot dayOfWeek (${slot.dayOfWeek}) does not match its date ${slot.date}`,
    })
  }
  const todayMs = todayLocalDate !== undefined ? parseCalendarDate(todayLocalDate) : null
  if (todayMs !== null && dateMs - todayMs > DATED_SLOT_MAX_DAYS_AHEAD * DAY_MS) {
    return new ScheduleValidationError({
      code: 'dated_slot_out_of_range',
      field: `${fieldBase}.date`,
      slotId: slot.slotId,
      message: `Dated slot date ${slot.date} is more than ${DATED_SLOT_MAX_DAYS_AHEAD} days ahead`,
    })
  }
  // A night may run past midnight but never past the rollover: at that hour the
  // night it names is over and the next one has begun, so a slot reaching beyond
  // it would outlive its own night and collide with the following one.
  if (slot.endTimeMin > DATED_SLOT_MAX_END_MIN) {
    const rollover = `${String(NIGHT_ROLLOVER_HOUR_SAST).padStart(2, '0')}:00`
    return new ScheduleValidationError({
      code: 'dated_slot_end_past_rollover',
      field: `${fieldBase}.endTime`,
      slotId: slot.slotId,
      message: `Dated slot ${slot.date} ${slot.startTime}-${slot.endTime} runs past ${rollover} the next morning; a night must end by ${rollover}`,
    })
  }
  return null
}

/**
 * Minutes to add to a slot dated `bDate` to express its times on the night
 * `aDate` names, or `null` when the two nights are more than a day apart and so
 * can never touch (a dated slot ends by `DATED_SLOT_MAX_END_MIN`, inside the
 * morning after its own night).
 */
function adjacentNightShiftMinutes(aDate: string, bDate: string): number | null {
  const aMs = parseCalendarDate(aDate)
  const bMs = parseCalendarDate(bDate)
  if (aMs === null || bMs === null) return null
  const days = (bMs - aMs) / DAY_MS
  if (days < -1 || days > 1) return null
  return days * MINUTES_PER_DAY
}

/**
 * R3.7 per-entry lineup invariants. Every entry's `startTimeMin` must lie in
 * `[slot.startTimeMin, slot.endTimeMin)`, entries must be strictly unique by
 * startTime within the slot, and an entry's genres must be distinct. Returns the
 * first violation, or null when the lineup is sound.
 */
function checkLineupEntries(
  slot: ScheduleSlot,
  lineup: readonly LineupEntry[],
  fieldBase: string,
): ScheduleValidationError | null {
  const seenStartTimes = new Set<number>()

  for (let j = 0; j < lineup.length; j++) {
    const entry = lineup[j]!
    if (entry.startTimeMin < slot.startTimeMin || entry.startTimeMin >= slot.endTimeMin) {
      return new ScheduleValidationError({
        code: 'lineup_entry_outside_slot',
        field: `${fieldBase}.lineup[${j}].startTime`,
        slotId: slot.slotId,
        message: `LineupEntry startTime (${entry.startTime}) must be inside [${slot.startTime}, ${slot.endTime})`,
      })
    }
    if (seenStartTimes.has(entry.startTimeMin)) {
      return new ScheduleValidationError({
        code: 'lineup_duplicate_start_times',
        field: `${fieldBase}.lineup[${j}].startTime`,
        slotId: slot.slotId,
        message: `Duplicate LineupEntry startTime within slot: ${entry.startTime}`,
      })
    }
    seenStartTimes.add(entry.startTimeMin)

    if (new Set(entry.genres).size !== entry.genres.length) {
      return new ScheduleValidationError({
        code: 'invalid_lineup_entry',
        field: `${fieldBase}.lineup[${j}].genres`,
        slotId: slot.slotId,
        message: 'LineupEntry genres must be distinct',
      })
    }
  }

  return null
}

export function validateMusicSchedule(input: unknown, options?: ScheduleValidationOptions): ValidationResult {
  // ── 1. Schema shape ────────────────────────────────────────────────────────
  const parsed = MusicScheduleSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.length ? issue.path.join('.') : '(root)'
    return {
      ok: false,
      error: new ScheduleValidationError({
        code: 'schema_shape',
        field: path,
        message: issue?.message ?? 'Music schedule failed schema validation',
      }),
    }
  }
  const schedule = parsed.data

  // ── 2. Field validity that Zod cannot easily express ──────────────────────
  if (!isValidIanaTimezone(schedule.timezone)) {
    return {
      ok: false,
      error: new ScheduleValidationError({
        code: 'invalid_timezone',
        field: 'timezone',
        message: `Unknown IANA timezone identifier: ${schedule.timezone}`,
      }),
    }
  }

  // ── 3. Per-slot internal consistency ──────────────────────────────────────
  for (let i = 0; i < schedule.slots.length; i++) {
    const slot = schedule.slots[i]!
    const fieldBase = `slots[${i}]`

    // R3.5 / R5.10: startTimeMin < endTimeMin. For a WEEKLY slot this still
    // rejects a cross-midnight interval outright: a weekly slot recurs on a
    // weekday and carries no date, so there is nothing to anchor a crossing to,
    // and "FRI 21:00 to 02:00" cannot say which Saturday morning it means. Those
    // stay a Cross_Midnight_Pair (R3.12): two weekday slots, one ending 23:59 and
    // one starting 00:00, which is what `MusicSchedulePanel` builds.
    //
    // A DATED slot names its night, so `deriveEndTimeMin` has already pushed its
    // crossing end past 1439 and this branch cannot fire for one. Two
    // representations, because they describe two different things: a recurring
    // weekday pattern and one named night. Not two ways to say the same thing.
    if (slot.startTimeMin >= slot.endTimeMin) {
      return {
        ok: false,
        error: new ScheduleValidationError({
          code: 'invalid_slot_interval',
          field: `${fieldBase}.endTime`,
          slotId: slot.slotId,
          message: `Slot interval must satisfy startTime < endTime (got ${slot.startTime} → ${slot.endTime})`,
        }),
      }
    }

    const datedError = checkDatedSlot(slot, fieldBase, options?.todayLocalDate)
    if (datedError) return { ok: false, error: datedError }

    if (slot.mode === 'blanket') {
      // R3.6: 1-5 distinct genres, no `lineup` field.
      if (!slot.genres || slot.genres.length < 1 || slot.genres.length > 5) {
        return {
          ok: false,
          error: new ScheduleValidationError({
            code: 'invalid_blanket_genres',
            field: `${fieldBase}.genres`,
            slotId: slot.slotId,
            message: 'Blanket-mode slot must declare 1-5 distinct genres',
          }),
        }
      }
      if (new Set(slot.genres).size !== slot.genres.length) {
        return {
          ok: false,
          error: new ScheduleValidationError({
            code: 'invalid_blanket_genres',
            field: `${fieldBase}.genres`,
            slotId: slot.slotId,
            message: 'Blanket-mode slot genres must be distinct',
          }),
        }
      }
      if (slot.lineup !== undefined) {
        return {
          ok: false,
          error: new ScheduleValidationError({
            code: 'blanket_must_not_have_lineup',
            field: `${fieldBase}.lineup`,
            slotId: slot.slotId,
            message: 'Blanket-mode slot must not declare a lineup array',
          }),
        }
      }
    } else {
      // R3.7: lineup mode invariants.
      if (slot.genres !== undefined) {
        return {
          ok: false,
          error: new ScheduleValidationError({
            code: 'lineup_must_not_have_top_genres',
            field: `${fieldBase}.genres`,
            slotId: slot.slotId,
            message: 'Lineup-mode slot must not declare a top-level genres array',
          }),
        }
      }
      const lineup = slot.lineup
      if (!lineup || lineup.length < 1 || lineup.length > 20) {
        return {
          ok: false,
          error: new ScheduleValidationError({
            code: 'invalid_lineup',
            field: `${fieldBase}.lineup`,
            slotId: slot.slotId,
            message: 'Lineup-mode slot must declare 1-20 LineupEntry records',
          }),
        }
      }

      // First entry's startTime must equal slot.startTime so the slot is
      // covered from its first second (R3.7 + R5.7 unreachable-fallback).
      if (lineup[0]!.startTimeMin !== slot.startTimeMin) {
        return {
          ok: false,
          error: new ScheduleValidationError({
            code: 'lineup_first_entry_misaligned',
            field: `${fieldBase}.lineup[0].startTime`,
            slotId: slot.slotId,
            message: `First LineupEntry's startTime (${lineup[0]!.startTime}) must equal the slot's startTime (${slot.startTime})`,
          }),
        }
      }

      const lineupError = checkLineupEntries(slot, lineup, fieldBase)
      if (lineupError) return { ok: false, error: lineupError }
    }
  }

  // ── 4. Cross-slot consistency: no overlapping slots in the same scope ─────
  // R3.9 / R5.6, extended by R8.1/R8.2. Compared with half-open intervals so a
  // slot ending at 23:59 does not collide with a slot starting at 23:59.
  //
  // Three scopes, because a Dated_Slot shadows rather than collides:
  //   - two weekly slots on the same `dayOfWeek`: overlap is an error (R3.9,
  //     unchanged).
  //   - two Dated_Slots, compared in ABSOLUTE time rather than by date. A slot
  //     running past midnight reaches into the next calendar date, so it can
  //     collide with the next date's slot even though the two `date` values
  //     differ; both are projected onto one night's minute axis before the
  //     comparison. Overlap is an error, so exactly one dated slot can ever be
  //     active at an instant (R8.1).
  //   - one weekly and one dated: never an error. The dated slot is published
  //     precisely to take over that part of the night (R8.1 shadowing), and
  //     the resolver prefers it.
  //   - two Dated_Slots more than a night apart: unrelated, and unreachable for
  //     each other because a dated slot ends by the rollover the next morning.
  for (let i = 0; i < schedule.slots.length; i++) {
    const a = schedule.slots[i]!
    for (let j = i + 1; j < schedule.slots.length; j++) {
      const b = schedule.slots[j]!
      const bothWeekly = a.date === undefined && b.date === undefined
      const bothDated = a.date !== undefined && b.date !== undefined
      if (!bothWeekly && !bothDated) continue
      if (bothWeekly && a.dayOfWeek !== b.dayOfWeek) continue

      // `b`'s minutes expressed on `a`'s night axis.
      const shift = bothDated ? adjacentNightShiftMinutes(a.date!, b.date!) : 0
      if (shift === null) continue
      const bStart = b.startTimeMin + shift
      const bEnd = b.endTimeMin + shift

      if (a.startTimeMin < bEnd && bStart < a.endTimeMin) {
        return {
          ok: false,
          error: new ScheduleValidationError({
            code: bothDated ? 'overlapping_dated_slots' : 'overlapping_slots',
            field: `slots[${j}]`,
            slotId: b.slotId,
            message: bothDated
              ? `Dated slot ${b.slotId} (${b.date} ${b.startTime}-${b.endTime}) overlaps dated slot ${a.slotId} (${a.date} ${a.startTime}-${a.endTime})`
              : `Slot ${b.slotId} (${b.dayOfWeek} ${b.startTime}-${b.endTime}) overlaps slot ${a.slotId} (${a.startTime}-${a.endTime})`,
          }),
        }
      }
    }
  }

  // ── 5. Cross_Midnight_Pair pairing ────────────────────────────────────────
  // R3.12: a Cross_Midnight_Pair is two same-day slots, one ending at 23:59
  // on day N and one starting at 00:00 on day N+1, both with the same `mode`
  // and matching genres/lineup tail-head. The data model only ever stores
  // these as two same-day slots; the pairing relationship is derivable from
  // the data. We accept any valid pair without further constraints because
  // the per-slot and overlap checks above already guarantee both halves are
  // individually valid and non-overlapping. No extra pairing rule rejects a
  // schedule here - Cross_Midnight_Pair is a read-side concept (R3.12).

  return { ok: true, value: schedule }
}
