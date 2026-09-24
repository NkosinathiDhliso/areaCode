// Pure plumbing behind the Tonight form (proof-of-demand R8.1, R8.3).
//
// The form owns no rules of its own. Every rule a Dated_Slot must satisfy is
// already enforced by `validateMusicSchedule`, so this module composes the
// schedule the owner is about to publish, runs that one validator against it,
// and translates the tagged failure into copy for the field that caused it.
// The owner gets the same answer the API would give, before the request.

import type { ApiError } from '@area-code/shared/lib/api'
import { describeApiError } from '@area-code/shared/lib/apiError'
import {
  DATED_SLOT_MAX_DAYS_AHEAD,
  HEADLINE_MAX_LENGTH,
  dayOfWeekForCalendarDate,
  parseCalendarDate,
  validateMusicSchedule,
  type ScheduleValidationCode,
} from '@area-code/shared/lib/schedule-validator'
import { resolveScheduleClock } from '@area-code/shared/lib/scheduleResolver'
import type { MusicGenre, MusicSchedule, ScheduleSlot } from '@area-code/shared/types'

/** Timezone a schedule is created with. Every venue is South African today. */
export const DEFAULT_SCHEDULE_TIMEZONE = 'Africa/Johannesburg'

const DAY_MS = 24 * 60 * 60 * 1000
const HH_MM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/

/** The owner's draft for one night. `featuredRewardId` empty means no get. */
export interface TonightDraft {
  slotId: string
  date: string
  startTime: string
  endTime: string
  headline: string
  genres: MusicGenre[]
  featuredRewardId: string
}

/** Which control an inline error belongs to. */
export type TonightField = 'date' | 'time' | 'headline' | 'genres' | 'get' | '_global'

export interface TonightError {
  field: TonightField
  message: string
}

export type TonightSubmission = { ok: true; schedule: MusicSchedule } | { ok: false; error: TonightError }

/** Today's calendar date in the schedule's own timezone, or null when the
 *  timezone cannot be resolved (the caller surfaces that as a load failure). */
export function scheduleTodayDate(timezone: string, nowIso: string): string | null {
  return resolveScheduleClock(nowIso, timezone)?.date ?? null
}

/** Last date a Tonight may be published for, per the validator's horizon. */
export function maxTonightDate(todayLocalDate: string): string | null {
  const todayMs = parseCalendarDate(todayLocalDate)
  if (todayMs === null) return null
  return new Date(todayMs + DATED_SLOT_MAX_DAYS_AHEAD * DAY_MS).toISOString().slice(0, 10)
}

function hhmmToMinutes(hhmm: string): number {
  if (!HH_MM.test(hhmm)) return 0
  const [hh, mm] = hhmm.split(':')
  return Number(hh) * 60 + Number(mm)
}

/**
 * Whether this draft describes a night that runs into the following morning.
 *
 * The same test the validator's `deriveEndTimeMin` applies: a dated end at or
 * before the start is the next morning. The form only reads it to say so in
 * words, so the owner sees a 02:00 end as the night they meant rather than a
 * typo. A dated slot stays one row; nothing is split.
 */
export function tonightCrossesMidnight(draft: TonightDraft): boolean {
  if (!HH_MM.test(draft.startTime) || !HH_MM.test(draft.endTime)) return false
  return hhmmToMinutes(draft.endTime) <= hhmmToMinutes(draft.startTime)
}

export function newTonightSlotId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `tonight-${crypto.randomUUID()}`
  }
  return `tonight-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** The Dated_Slot already published for a date, if any. The form edits it in
 *  place rather than stacking a second slot on the same night. */
export function datedSlotFor(schedule: MusicSchedule | null, date: string): ScheduleSlot | null {
  return schedule?.slots.find((slot) => slot.date === date) ?? null
}

/** A draft seeded for one date, from that date's published Tonight when there
 *  is one. */
export function draftForDate(schedule: MusicSchedule | null, date: string): TonightDraft {
  const existing = datedSlotFor(schedule, date)
  if (!existing) {
    return {
      slotId: newTonightSlotId(),
      date,
      startTime: '20:00',
      // 02:00, not the old 23:59. That minute-before-midnight end only ever
      // existed because a Dated_Slot could not cross the day boundary; now it
      // can (decision 12), so the default names the hour a night actually ends
      // and sits inside the 04:00 rollover.
      endTime: '02:00',
      headline: '',
      genres: ['amapiano'],
      featuredRewardId: '',
    }
  }
  return {
    slotId: existing.slotId,
    date,
    startTime: existing.startTime,
    endTime: existing.endTime,
    headline: existing.headline ?? '',
    genres: existing.mode === 'blanket' ? [...(existing.genres ?? [])] : [],
    featuredRewardId: existing.featuredRewardId ?? '',
  }
}

/**
 * The Dated_Slot the draft describes. `dayOfWeek` is derived from `date` (the
 * owner is never asked for it, and the two can never contradict); null means
 * the date is not a real calendar date.
 *
 * Tonight is always a blanket-genre slot. DJ lineups stay in the weekly
 * `MusicSchedulePanel`, which is the surface built for them.
 */
export function draftToDatedSlot(draft: TonightDraft): ScheduleSlot | null {
  const dayOfWeek = dayOfWeekForCalendarDate(draft.date)
  if (dayOfWeek === null) return null
  const slot: ScheduleSlot = {
    slotId: draft.slotId,
    dayOfWeek,
    startTime: draft.startTime,
    endTime: draft.endTime,
    startTimeMin: hhmmToMinutes(draft.startTime),
    endTimeMin: hhmmToMinutes(draft.endTime),
    mode: 'blanket',
    genres: draft.genres,
    date: draft.date,
  }
  const headline = draft.headline.trim()
  if (headline.length > 0) slot.headline = headline
  if (draft.featuredRewardId.length > 0) slot.featuredRewardId = draft.featuredRewardId
  return slot
}

/** The schedule with this night's slot replacing whatever shared its id. */
function withTonight(schedule: MusicSchedule, slot: ScheduleSlot): MusicSchedule {
  return { ...schedule, slots: [...schedule.slots.filter((s) => s.slotId !== slot.slotId), slot] }
}

const FIELD_BY_CODE: Partial<Record<ScheduleValidationCode, TonightField>> = {
  invalid_slot_date: 'date',
  dated_slot_day_mismatch: 'date',
  dated_slot_out_of_range: 'date',
  invalid_slot_interval: 'time',
  invalid_time_format: 'time',
  dated_slot_end_past_rollover: 'time',
  overlapping_dated_slots: 'time',
  overlapping_slots: 'time',
  invalid_blanket_genres: 'genres',
}

const COPY_BY_CODE: Partial<Record<ScheduleValidationCode, string>> = {
  invalid_slot_date: 'Pick a real date.',
  dated_slot_day_mismatch: 'Pick a real date.',
  dated_slot_out_of_range: `You can publish up to ${DATED_SLOT_MAX_DAYS_AHEAD} days ahead.`,
  invalid_slot_interval: 'End time must be later than start time.',
  invalid_time_format: 'Use 24-hour times, for example 21:00.',
  // A night may run past midnight, but it ends when the night does: 04:00.
  dated_slot_end_past_rollover: 'A night can run past midnight but must end by 04:00. Change the end time.',
  overlapping_dated_slots: 'Another Tonight already covers those hours. Change the times.',
  overlapping_slots: 'These hours clash with another slot on this date. Change the times.',
  invalid_blanket_genres: 'Pick between 1 and 5 genres.',
}

/**
 * Compose and check the schedule this draft would publish.
 *
 * `todayLocalDate` is what makes the 14-day horizon checkable client-side: the
 * validator takes it rather than reading a clock, exactly as the write path
 * does.
 */
export function buildTonightSubmission(args: {
  draft: TonightDraft
  schedule: MusicSchedule
  todayLocalDate: string
}): TonightSubmission {
  const { draft, schedule, todayLocalDate } = args

  const slot = draftToDatedSlot(draft)
  if (slot === null) {
    return { ok: false, error: { field: 'date', message: COPY_BY_CODE.invalid_slot_date! } }
  }

  const proposed = withTonight(schedule, slot)
  const result = validateMusicSchedule(proposed, { todayLocalDate })
  if (result.ok) return { ok: true, schedule: result.value }

  const { code, field } = result.error
  // A headline over the limit surfaces as a schema-shape failure on the
  // headline path; everything else maps by code.
  if (code === 'schema_shape' && field.endsWith('.headline')) {
    return {
      ok: false,
      error: { field: 'headline', message: `Keep the headline to ${HEADLINE_MAX_LENGTH} characters or fewer.` },
    }
  }
  return {
    ok: false,
    error: {
      field: FIELD_BY_CODE[code] ?? '_global',
      message: COPY_BY_CODE[code] ?? 'Check the date, times and genres for this night.',
    },
  }
}

/**
 * Owner-readable copy for a rejected publish, keyed off `statusCode`.
 *
 * A 400 carries the reason the API named (a get that was switched off, a slot
 * rule) and is worth showing as-is. Nothing else is: a 5xx body is never shown
 * to an owner.
 */
export function describeTonightPublishError(err: ApiError, t: (key: string, fallback: string) => string): string {
  // The 400 reason is shown as the API worded it, but only when it reads as copy
  // a person can act on: `describeApiError` drops technical text (R15.13).
  if (err.statusCode === 400) {
    return describeApiError(err, t('biz.tonight.error.validation', 'Check the date, times and genres for this night.'))
  }
  if (err.statusCode === 403) {
    return t('biz.tonight.error.forbidden', "You don't have access to this venue's schedule.")
  }
  if (err.statusCode === 429) {
    return t('biz.tonight.error.rateLimited', 'Too many changes just now. Wait a moment and publish again.')
  }
  if (err.statusCode === 0) {
    return t('biz.tonight.error.network', "Couldn't reach Area Code. Check your connection and publish again.")
  }
  return t('biz.tonight.error.server', "Couldn't publish tonight. Please try again.")
}
