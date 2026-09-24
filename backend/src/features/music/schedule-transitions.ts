// `nextTransitionAt` arithmetic for the Music_Schedule.
//
// Lives apart from `schedule-repository.ts` because it is pure and is the one
// place that knows what counts as a transition. The repository stamps the value
// it returns onto the sparse `ByNextTransition` GSI; the schedule-transition
// tick reads that GSI every 60s and re-evaluates the venues whose Active_Slot
// is about to change.
//
// Two kinds of boundary now exist (proof-of-demand R8.1, R8.2):
//   - weekly slots recur, so each start and end fires again every 7 days;
//   - a Dated_Slot fires once, on the night it names, and never again. Its end
//     boundary may land on the following calendar date when the night runs past
//     midnight; its start never does, so the Tonight_Reminder still fires once,
//     at the real start.
// `nextTransitionAt` is the soonest boundary across both kinds.
//
// Weekly boundaries are kept even on a date a Dated_Slot shadows. The extra
// tick is harmless: the tick re-resolves the Active_Slot, which returns the
// dated slot, so nothing changes and nothing is reported. Suppressing those
// boundaries would mean re-deriving the shadowing rule here, giving it a second
// home that could drift from the resolver's.

import { parseCalendarDate } from '@area-code/shared/lib/schedule-validator'
import { resolveScheduleClock } from '@area-code/shared/lib/scheduleResolver'
import type { MusicSchedule, ScheduleDayOfWeek } from '@area-code/shared/types'

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
const MS_PER_MINUTE = 60 * 1000

/**
 * The soonest of a Dated_Slot's two one-shot boundaries that is still ahead of
 * `nowMs`, or `Number.POSITIVE_INFINITY` when both have passed (or the local
 * date does not resolve in this timezone). Infinity is the identity for the
 * caller's running minimum, so a spent dated slot contributes nothing.
 *
 * A night that runs past midnight has `endTimeMin` beyond 1439, and
 * `localDateTimeToUtcMs` resolves it to the correct instant on the FOLLOWING
 * date, so the tick still wakes on the real end boundary rather than an hour of
 * the slot's own morning that never arrives.
 */
function nextDatedBoundaryMs(
  slot: { date?: string | undefined; startTimeMin: number; endTimeMin: number },
  timezone: string,
  nowMs: number,
): number {
  if (slot.date === undefined) return Number.POSITIVE_INFINITY

  let best = Number.POSITIVE_INFINITY
  for (const minutes of [slot.startTimeMin, slot.endTimeMin]) {
    const ms = localDateTimeToUtcMs(slot.date, minutes, timezone)
    if (ms !== null && ms > nowMs && ms < best) best = ms
  }
  return best
}

/**
 * Compute the soonest upcoming slot-boundary transition (slot start or slot
 * end) for the given schedule, expressed as an ISO-8601 timestamp in UTC.
 *
 * Weekly slots: for each `(slotStart, slotEnd)` pair, the next time after
 * `now` (in the schedule's timezone) at which that boundary fires given the
 * weekly recurrence. Dated slots: the one absolute instant each boundary
 * falls on, kept only while it is still ahead of `now`. The minimum across
 * every kept boundary is the schedule's `nextTransitionAt`.
 *
 * Returns `undefined` when the schedule has no slots, and when every slot is
 * a Dated_Slot whose boundaries have all passed — in both cases there is no
 * future transition, so the caller MUST also omit the GSI partition key and
 * keep the row out of the sparse GSI (R3.10).
 *
 * Pure: no I/O, no globals, no `Date.now()` — the caller passes `nowIso`.
 */
export function computeNextTransitionAt(schedule: MusicSchedule, nowIso: string): string | undefined {
  if (schedule.slots.length === 0) return undefined

  const now = new Date(nowIso)
  if (Number.isNaN(now.getTime())) {
    throw new RangeError(`computeNextTransitionAt: nowIso is not a valid ISO-8601 timestamp (${nowIso})`)
  }

  const clock = resolveScheduleClock(nowIso, schedule.timezone)
  if (!clock) {
    throw new Error(`computeNextTransitionAt: unresolvable timezone ${schedule.timezone}`)
  }
  const nowWeekMinute = DAY_TO_INDEX[clock.dayOfWeek] * MINUTES_PER_DAY + clock.minutesSinceMidnight
  const nowMs = now.getTime()

  let bestMs = Number.POSITIVE_INFINITY
  for (const slot of schedule.slots) {
    if (slot.date !== undefined) {
      // One-shot boundaries on a fixed local date.
      bestMs = Math.min(bestMs, nextDatedBoundaryMs(slot, schedule.timezone, nowMs))
      continue
    }

    const slotDay = DAY_TO_INDEX[slot.dayOfWeek] * MINUTES_PER_DAY
    for (const minutes of [slot.startTimeMin, slot.endTimeMin]) {
      const ms = nowMs + forwardDelta(nowWeekMinute, slotDay + minutes) * MS_PER_MINUTE
      if (ms < bestMs) bestMs = ms
    }
  }

  if (!Number.isFinite(bestMs)) return undefined
  return new Date(bestMs).toISOString()
}

/** Return how many minutes from `fromWeekMin` to the next occurrence of
 *  `toWeekMin`, modulo a week. Always returns a value in `[1, MINUTES_PER_WEEK]`
 *  — equality maps to a full week ahead so we never return `0` (a transition
 *  exactly at `now` has already fired and the next one is a week away).
 *
 *  DST shifts in the schedule's local timezone are absorbed by the next tick
 *  (the schedule-transition-tick re-queries `nextTransitionAt` every 60s
 *  anyway, so a one-tick error during a DST jump is the worst case). SAST has
 *  no DST, so this never bites the venues we run today. */
function forwardDelta(fromWeekMin: number, toWeekMin: number): number {
  const raw = toWeekMin - fromWeekMin
  if (raw <= 0) return raw + MINUTES_PER_WEEK
  return raw
}

/**
 * Convert a schedule-local `(YYYY-MM-DD, minutesSinceNightMidnight)` pair to its
 * UTC epoch ms in the given timezone. Returns `null` when the date is not a
 * real calendar date.
 *
 * `minutes` may exceed a day: a Dated_Slot's derived `endTimeMin` carries the
 * crossing past midnight, and adding it to the date's own midnight lands on the
 * next date by construction. The offset is then read at that corrected instant,
 * so a boundary at 02:00 the following morning is the instant it really is.
 *
 * Two passes: read the wall clock as if it were UTC, correct by the zone's
 * offset at that instant, then re-read the offset at the corrected instant in
 * case the first guess landed on the far side of a DST change. SAST is a fixed
 * UTC+2 so the second pass is a no-op there; it is kept so a venue in a
 * DST-observing zone is still handled honestly rather than an hour out.
 */
function localDateTimeToUtcMs(date: string, minutes: number, timezone: string): number | null {
  const dayMs = parseCalendarDate(date)
  if (dayMs === null) return null
  const asIfUtcMs = dayMs + minutes * MS_PER_MINUTE

  const firstOffset = zoneOffsetMs(asIfUtcMs, timezone)
  let utcMs = asIfUtcMs - firstOffset
  const secondOffset = zoneOffsetMs(utcMs, timezone)
  if (secondOffset !== firstOffset) utcMs = asIfUtcMs - secondOffset
  return utcMs
}

/**
 * The timezone's offset from UTC, in ms, at the given UTC instant. Derived by
 * reading the instant's wall clock in that zone and treating those fields as
 * UTC: the difference is the offset.
 */
function zoneOffsetMs(utcMs: number, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts: Record<string, string> = {}
  for (const part of fmt.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  const hour = Number(parts['hour']) === 24 ? 0 : Number(parts['hour'])
  const asIfUtc = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    hour,
    Number(parts['minute']),
    Number(parts['second']),
  )
  if (Number.isNaN(asIfUtc)) {
    throw new Error(`computeNextTransitionAt: unreadable wall clock for timezone ${timezone}`)
  }
  // Drop sub-second precision: the wall-clock read has none, so keeping the
  // instant's own ms would show up as a spurious offset.
  return asIfUtc - (utcMs - (utcMs % 1000))
}

/**
 * The Dated_Slots whose START falls inside the half-open window
 * `[windowStartIso, windowEndIso)` (proof-of-demand R9.7).
 *
 * The Tonight_Reminder rides this tick and nothing else: no timer, no queue, no
 * second Lambda (`serverless-only.md`, decision 4 in
 * `docs/decisions/proof-of-demand.md`). The tick already wakes on every slot
 * boundary, so all that is needed is a pure answer to "is a published night
 * starting right now, and which night is it?".
 *
 * Starts only. A slot END is a boundary the tick still fires on, and a reminder
 * at closing time would be a lie about what is about to happen.
 *
 * Weekly slots are excluded by design: Tonight is a Dated_Slot, and the weekly
 * grid is a standing pattern rather than a night a consumer marked going for.
 *
 * Pure, like `computeNextTransitionAt`: the caller passes the window, so the
 * "once per row" behaviour can be tested without a clock.
 */
export function datedSlotStartsInWindow(
  schedule: MusicSchedule,
  windowStartIso: string,
  windowEndIso: string,
): Array<{ date: string; headline: string | null }> {
  const startMs = new Date(windowStartIso).getTime()
  const endMs = new Date(windowEndIso).getTime()
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new RangeError(`datedSlotStartsInWindow: invalid window (${windowStartIso}, ${windowEndIso})`)
  }

  const starting: Array<{ date: string; headline: string | null }> = []
  for (const slot of schedule.slots) {
    if (slot.date === undefined) continue
    const ms = localDateTimeToUtcMs(slot.date, slot.startTimeMin, schedule.timezone)
    if (ms === null || ms < startMs || ms >= endMs) continue
    starting.push({ date: slot.date, headline: slot.headline ?? null })
  }
  return starting
}
