import { z } from 'zod'

import { MUSIC_GENRES } from '../constants/genre-weights'
import type { LineupEntry, MusicGenre, MusicSchedule, ScheduleSlot } from '../types'

// HH:mm matching `^([01][0-9]|2[0-3]):[0-5][0-9]$` per R3.5.
const HH_MM_REGEX = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

const DAYS_OF_WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const

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
 * Returns true iff the given string is an IANA timezone identifier known to
 * the runtime. R3.11 + R5.11 require validation via `Intl.DateTimeFormat`,
 * which throws a `RangeError` for unknown ids.
 */
function isValidIanaTimezone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0) return false
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch (e) {
    if (e instanceof RangeError) return false
    // Unexpected error class — treat conservatively as invalid.
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
 * `startTimeMin` is intentionally NOT validated on input — it is derived,
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
 * `startTimeMin` and `endTimeMin` are intentionally NOT validated on input —
 * they are derived, not declared, so any drifted caller-supplied values are
 * silently overwritten on parse.
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
  })
  .transform<ScheduleSlot>((raw) => {
    const slot: ScheduleSlot = {
      slotId: raw.slotId,
      dayOfWeek: raw.dayOfWeek,
      startTime: raw.startTime,
      endTime: raw.endTime,
      startTimeMin: hhmmToMinutes(raw.startTime),
      endTimeMin: hhmmToMinutes(raw.endTime),
      mode: raw.mode,
    }
    if (raw.genres !== undefined) slot.genres = raw.genres
    if (raw.lineup !== undefined) slot.lineup = raw.lineup as LineupEntry[]
    return slot
  })

/**
 * MusicSchedule schema. Shape only — per-slot, cross-slot, and timezone
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
 * Validate a Music_Schedule end-to-end and return either the canonicalised
 * value (with derived `startTimeMin`/`endTimeMin` overwritten) or a tagged
 * `ScheduleValidationError`.
 *
 * The validation order matches the design ("Backend: R3-R4 Schedule routes"):
 *   1. Schema shape (Zod) — R3.x
 *   2. Per-slot field validity (regex, enum, IANA timezone) — R3.4, R3.5, R3.11
 *   3. Per-slot internal consistency — R3.5, R3.6, R3.7, R5.10
 *   4. Cross-slot consistency (overlap detection) — R3.9
 *   5. Cross_Midnight_Pair pairing — R3.12 (accepts the two same-day slots
 *      the editor produced; same-day overlap is already enforced in step 4)
 *
 * Caller-supplied `startTimeMin` / `endTimeMin` (and `LineupEntry.startTimeMin`)
 * are silently overwritten with values derived from the `HH:mm` strings so
 * the redundant fields cannot drift on round-trip (design Property 6).
 */
export function validateMusicSchedule(input: unknown): ValidationResult {
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

    // R3.5 / R5.10: startTimeMin < endTimeMin. Cross-midnight slots are
    // explicitly forbidden — they are modelled as a Cross_Midnight_Pair
    // (R3.12) of two same-day slots ending at 23:59 and starting at 00:00.
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

      // Each entry's startTimeMin must lie in [slot.startTimeMin, slot.endTimeMin)
      // and entries must be strictly unique by startTime within the slot (R3.7).
      const seenStartTimes = new Set<number>()
      for (let j = 0; j < lineup.length; j++) {
        const entry = lineup[j]!
        if (entry.startTimeMin < slot.startTimeMin || entry.startTimeMin >= slot.endTimeMin) {
          return {
            ok: false,
            error: new ScheduleValidationError({
              code: 'lineup_entry_outside_slot',
              field: `${fieldBase}.lineup[${j}].startTime`,
              slotId: slot.slotId,
              message: `LineupEntry startTime (${entry.startTime}) must be inside [${slot.startTime}, ${slot.endTime})`,
            }),
          }
        }
        if (seenStartTimes.has(entry.startTimeMin)) {
          return {
            ok: false,
            error: new ScheduleValidationError({
              code: 'lineup_duplicate_start_times',
              field: `${fieldBase}.lineup[${j}].startTime`,
              slotId: slot.slotId,
              message: `Duplicate LineupEntry startTime within slot: ${entry.startTime}`,
            }),
          }
        }
        seenStartTimes.add(entry.startTimeMin)

        if (new Set(entry.genres).size !== entry.genres.length) {
          return {
            ok: false,
            error: new ScheduleValidationError({
              code: 'invalid_lineup_entry',
              field: `${fieldBase}.lineup[${j}].genres`,
              slotId: slot.slotId,
              message: 'LineupEntry genres must be distinct',
            }),
          }
        }
      }
    }
  }

  // ── 4. Cross-slot consistency: no overlapping slots on same dayOfWeek ─────
  // R3.9 / R5.6. Compared with half-open intervals so a slot ending at 23:59
  // does not collide with a slot starting at 23:59 in the same day. (Same-day
  // overlap is the only failure mode here; Cross_Midnight_Pairs already split
  // across two `dayOfWeek` values so they cannot overlap by construction.)
  for (let i = 0; i < schedule.slots.length; i++) {
    const a = schedule.slots[i]!
    for (let j = i + 1; j < schedule.slots.length; j++) {
      const b = schedule.slots[j]!
      if (a.dayOfWeek !== b.dayOfWeek) continue
      if (a.startTimeMin < b.endTimeMin && b.startTimeMin < a.endTimeMin) {
        return {
          ok: false,
          error: new ScheduleValidationError({
            code: 'overlapping_slots',
            field: `slots[${j}]`,
            slotId: b.slotId,
            message: `Slot ${b.slotId} (${b.dayOfWeek} ${b.startTime}-${b.endTime}) overlaps slot ${a.slotId} (${a.startTime}-${a.endTime})`,
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
  // schedule here — Cross_Midnight_Pair is a read-side concept (R3.12).

  return { ok: true, value: schedule }
}
