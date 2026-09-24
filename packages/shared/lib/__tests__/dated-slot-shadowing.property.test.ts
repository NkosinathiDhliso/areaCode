/**
 * Feature: Proof of demand, Property 6: Dated_Slot shadowing.
 *
 * At any instant the resolver returns exactly one Active_Slot, and a
 * Dated_Slot published for that night wins wherever it covers the instant.
 * Outside the hours its dated slots cover, the weekly programme still applies,
 * and on any other date the weekly programme is untouched.
 *
 * A Dated_Slot names a night, not a calendar date, so it may run past midnight:
 * a Friday slot from 21:00 to 02:00 is still the Active_Slot at 01:00 on
 * Saturday. The second describe block below covers that case, including the
 * handover back to the weekly programme once the night ends.
 *
 * The companion half of Property 6 (`nextTransitionAt` is the soonest
 * boundary across both kinds of slot) lives with that arithmetic in
 * `backend/src/features/music/__tests__/schedule-transitions.property.test.ts`.
 *
 * SAST is a fixed UTC+2 with no DST, so a schedule-local instant converts to
 * UTC by subtracting two hours. Every venue runs on Africa/Johannesburg today,
 * which is why the generators pin that zone rather than sweeping timezones.
 *
 * Validates: Requirements 8.1, 8.2, 8.3
 */
import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import type { MusicSchedule, ScheduleDayOfWeek, ScheduleSlot } from '../../types'
import { resolveActiveSlot } from '../scheduleResolver'

const TIMEZONE = 'Africa/Johannesburg'
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000
const MINUTES_PER_DAY = 24 * 60
const DAY_MS = 24 * 60 * 60 * 1000
/** Latest a night may end: the 04:00 rollover on the following morning. */
const MAX_DATED_END_MIN = MINUTES_PER_DAY + 4 * 60
const DAYS: readonly ScheduleDayOfWeek[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

/** 2026-03-02 is a Monday, so `baseMs + n * DAY_MS` has a weekday of
 *  `DAYS[n % 7]` with no further arithmetic. */
const BASE_MONDAY_MS = Date.UTC(2026, 2, 2)

function calendarDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function dayOfWeekFor(ms: number): ScheduleDayOfWeek {
  return DAYS[(new Date(ms).getUTCDay() + 6) % 7]!
}

/** The UTC instant of a schedule-local `(date, minutesSinceMidnight)` pair. */
function localToUtcIso(dateMs: number, minutes: number): string {
  return new Date(dateMs + minutes * 60_000 - SAST_OFFSET_MS).toISOString()
}

/**
 * Turn a strictly-increasing boundary list into non-overlapping intervals by
 * pairing consecutive values: `[b0,b1) [b2,b3) ...`. Pairing consecutive
 * boundaries rather than every value against every other guarantees the
 * validator's no-overlap rule is satisfied by construction, and leaves real
 * gaps between intervals so the weekly-fallback branch is exercised.
 */
function toIntervals(boundaries: number[]): Array<[number, number]> {
  const sorted = [...boundaries].sort((a, b) => a - b)
  const intervals: Array<[number, number]> = []
  for (let i = 0; i + 1 < sorted.length; i += 2) {
    intervals.push([sorted[i]!, sorted[i + 1]!])
  }
  return intervals
}

function hhmm(minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

function blanketSlot(args: {
  slotId: string
  dayOfWeek: ScheduleDayOfWeek
  interval: [number, number]
  date?: string
}): ScheduleSlot {
  const slot = {
    slotId: args.slotId,
    dayOfWeek: args.dayOfWeek,
    startTime: hhmm(args.interval[0]),
    // `endTime` stays human `HH:mm`; a crossing end is carried by `endTimeMin`.
    endTime: hhmm(args.interval[1] % MINUTES_PER_DAY),
    startTimeMin: args.interval[0],
    endTimeMin: args.interval[1],
    mode: 'blanket' as const,
    genres: ['amapiano' as const],
  } as ScheduleSlot
  if (args.date !== undefined) {
    slot.date = args.date
    slot.headline = 'Amapiano all night'
  }
  return slot
}

/** Boundary minutes inside `[0, 1439]`: an even count so every value pairs
 *  into an interval, and unique so intervals never collapse to zero width. */
const boundariesArb = fc
  .uniqueArray(fc.integer({ min: 0, max: 1439 }), { minLength: 2, maxLength: 8 })
  .map((values) => (values.length % 2 === 0 ? values : values.slice(0, values.length - 1)))

interface Scenario {
  schedule: MusicSchedule
  datedDateMs: number
  datedIntervals: Array<[number, number]>
  weeklyIntervals: Array<[number, number]>
  minutes: number
}

/**
 * A schedule with a weekly programme on one weekday plus dated slots on one
 * date that falls on that same weekday, so the two always compete. `dayOffset`
 * stays inside the 14-day publication horizon.
 */
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    dayOffset: fc.integer({ min: 0, max: 13 }),
    weekly: boundariesArb,
    dated: boundariesArb,
    minutes: fc.integer({ min: 0, max: 1439 }),
  })
  .map(({ dayOffset, weekly, dated, minutes }) => {
    const datedDateMs = BASE_MONDAY_MS + dayOffset * DAY_MS
    const dayOfWeek = dayOfWeekFor(datedDateMs)
    const date = calendarDate(datedDateMs)

    const weeklyIntervals = toIntervals(weekly)
    const datedIntervals = toIntervals(dated)

    const slots: ScheduleSlot[] = [
      ...weeklyIntervals.map((interval, i) => blanketSlot({ slotId: `weekly-${i}`, dayOfWeek, interval })),
      ...datedIntervals.map((interval, i) => blanketSlot({ slotId: `dated-${i}`, dayOfWeek, interval, date })),
    ]

    return {
      schedule: {
        businessId: 'biz-1',
        scheduleId: 'default',
        timezone: TIMEZONE,
        slots,
        updatedAt: '2026-03-01T00:00:00.000Z',
        schemaVersion: 1 as const,
      },
      datedDateMs,
      datedIntervals,
      weeklyIntervals,
      minutes,
    }
  })

function covering(intervals: Array<[number, number]>, minutes: number): number {
  return intervals.findIndex(([start, end]) => start <= minutes && minutes < end)
}

describe('Feature: Proof of demand, Property 6: Dated_Slot shadowing', () => {
  it('on the dated date, a covering Dated_Slot is the one Active_Slot', () => {
    fc.assert(
      fc.property(scenarioArb, ({ schedule, datedDateMs, datedIntervals, weeklyIntervals, minutes }) => {
        const resolved = resolveActiveSlot(schedule, localToUtcIso(datedDateMs, minutes))
        const datedIndex = covering(datedIntervals, minutes)
        const weeklyIndex = covering(weeklyIntervals, minutes)

        if (datedIndex >= 0) {
          expect(resolved?.slot.slotId).toBe(`dated-${datedIndex}`)
          expect(resolved?.slot.date).toBe(calendarDate(datedDateMs))
        } else if (weeklyIndex >= 0) {
          // No dated slot covers this instant, so the weekly programme still
          // runs: shadowing is per instant, not a blackout of the whole day.
          expect(resolved?.slot.slotId).toBe(`weekly-${weeklyIndex}`)
          expect(resolved?.slot.date).toBeUndefined()
        } else {
          expect(resolved).toBeNull()
        }
      }),
      { numRuns: 200 },
    )
  })

  it('exactly one slot is active at any instant, dated date or not', () => {
    fc.assert(
      fc.property(scenarioArb, fc.integer({ min: -14, max: 14 }), (scenario, weekShift) => {
        // `weekShift` weeks away lands on the same weekday, so the weekly
        // programme still applies but the dated slots do not.
        const instantMs = scenario.datedDateMs + weekShift * 7 * DAY_MS
        const resolved = resolveActiveSlot(scenario.schedule, localToUtcIso(instantMs, scenario.minutes))

        // `resolveActiveSlot` throws when two slots match, so reaching here at
        // all proves at most one did. Confirm the count from the schedule side.
        const local = calendarDate(instantMs)
        const active = scenario.schedule.slots.filter((slot) => {
          const sameScope = slot.date === undefined ? true : slot.date === local
          return sameScope && slot.startTimeMin <= scenario.minutes && scenario.minutes < slot.endTimeMin
        })
        if (resolved === null) {
          expect(active).toHaveLength(0)
        } else {
          expect(active.map((s) => s.slotId)).toContain(resolved.slot.slotId)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('on any other date the weekly programme resolves as if no dated slot existed', () => {
    fc.assert(
      fc.property(scenarioArb, fc.integer({ min: 1, max: 14 }), (scenario, weeksLater) => {
        const instantMs = scenario.datedDateMs + weeksLater * 7 * DAY_MS
        const withDated = resolveActiveSlot(scenario.schedule, localToUtcIso(instantMs, scenario.minutes))

        const weeklyOnly: MusicSchedule = {
          ...scenario.schedule,
          slots: scenario.schedule.slots.filter((slot) => slot.date === undefined),
        }
        const withoutDated = resolveActiveSlot(weeklyOnly, localToUtcIso(instantMs, scenario.minutes))

        expect(withDated?.slot.slotId ?? null).toBe(withoutDated?.slot.slotId ?? null)
      }),
      { numRuns: 200 },
    )
  })
})

// ─── Past-midnight nights ────────────────────────────────────────────────────

interface CrossScenario {
  schedule: MusicSchedule
  /** Midnight of the date the night names. */
  datedDateMs: number
  /** Minutes from that midnight. `end` runs past 1439 when the night crosses. */
  datedStart: number
  datedEnd: number
  /** Weekly interval on the night's own weekday, and on the morning after's. */
  weeklyToday: [number, number]
  weeklyTomorrow: [number, number]
  /** Minutes from the night's midnight to the resolving instant, up to +32h. */
  offsetMinutes: number
}

/**
 * One dated night that runs from the evening into the small hours, plus a weekly
 * programme on both weekdays it touches. The weekly slots are what the resolver
 * must hand back to once the night ends, so the handover is exercised rather
 * than assumed.
 */
const crossScenarioArb: fc.Arbitrary<CrossScenario> = fc
  .record({
    dayOffset: fc.integer({ min: 0, max: 12 }),
    start: fc.integer({ min: 17 * 60, max: 1439 }),
    // `endRaw` is the human `HH:mm` end on the following morning, so the derived
    // end is `endRaw + 1440`, bounded by the rollover.
    endRaw: fc.integer({ min: 1, max: MAX_DATED_END_MIN - MINUTES_PER_DAY }),
    weeklyToday: fc.tuple(fc.integer({ min: 0, max: 700 }), fc.integer({ min: 701, max: 1439 })),
    weeklyTomorrow: fc.tuple(fc.integer({ min: 0, max: 700 }), fc.integer({ min: 701, max: 1439 })),
    offsetMinutes: fc.integer({ min: 0, max: 32 * 60 }),
  })
  .map((raw) => {
    const datedDateMs = BASE_MONDAY_MS + raw.dayOffset * DAY_MS
    const today = dayOfWeekFor(datedDateMs)
    const tomorrow = dayOfWeekFor(datedDateMs + DAY_MS)
    const datedEnd = MINUTES_PER_DAY + raw.endRaw

    return {
      schedule: {
        businessId: 'biz-1',
        scheduleId: 'default',
        timezone: TIMEZONE,
        slots: [
          blanketSlot({ slotId: 'weekly-today', dayOfWeek: today, interval: raw.weeklyToday }),
          blanketSlot({ slotId: 'weekly-tomorrow', dayOfWeek: tomorrow, interval: raw.weeklyTomorrow }),
          blanketSlot({
            slotId: 'dated',
            dayOfWeek: today,
            interval: [raw.start, datedEnd],
            date: calendarDate(datedDateMs),
          }),
        ],
        updatedAt: '2026-03-01T00:00:00.000Z',
        schemaVersion: 1 as const,
      },
      datedDateMs,
      datedStart: raw.start,
      datedEnd,
      weeklyToday: raw.weeklyToday as [number, number],
      weeklyTomorrow: raw.weeklyTomorrow as [number, number],
      offsetMinutes: raw.offsetMinutes,
    }
  })

/** The slot that should be active, computed independently of the resolver. */
function expectedActive(s: CrossScenario): string | null {
  if (s.datedStart <= s.offsetMinutes && s.offsetMinutes < s.datedEnd) return 'dated'
  const dayIndex = Math.floor(s.offsetMinutes / MINUTES_PER_DAY)
  const localMinutes = s.offsetMinutes % MINUTES_PER_DAY
  const weekly = [s.weeklyToday, s.weeklyTomorrow][dayIndex]
  if (!weekly) return null
  return weekly[0] <= localMinutes && localMinutes < weekly[1] ? `weekly-${['today', 'tomorrow'][dayIndex]}` : null
}

describe('Feature: Proof of demand, Property 6: a Dated_Slot may run past midnight', () => {
  it('exactly one slot is active at any instant, on either side of midnight', () => {
    fc.assert(
      fc.property(crossScenarioArb, (scenario) => {
        const iso = localToUtcIso(scenario.datedDateMs, scenario.offsetMinutes)
        // `resolveActiveSlot` throws on a double match, so returning at all
        // proves at most one slot matched.
        const resolved = resolveActiveSlot(scenario.schedule, iso)
        expect(resolved?.slot.slotId ?? null).toBe(expectedActive(scenario))
      }),
      { numRuns: 300 },
    )
  })

  it('the night is active in the small hours of the next date, and its date is unchanged', () => {
    fc.assert(
      fc.property(crossScenarioArb, (scenario) => {
        // Sample the last minute of the night rather than the generated offset,
        // which is the minute the calendar-date rule used to lose.
        const lastMinute = scenario.datedEnd - 1
        const resolved = resolveActiveSlot(scenario.schedule, localToUtcIso(scenario.datedDateMs, lastMinute))
        expect(resolved?.slot.slotId).toBe('dated')
        expect(resolved?.slot.date).toBe(calendarDate(scenario.datedDateMs))
      }),
      { numRuns: 200 },
    )
  })

  it('hands back to the weekly programme the minute the night ends', () => {
    fc.assert(
      fc.property(crossScenarioArb, (scenario) => {
        const resolved = resolveActiveSlot(scenario.schedule, localToUtcIso(scenario.datedDateMs, scenario.datedEnd))
        expect(resolved?.slot.slotId ?? null).not.toBe('dated')
        expect(resolved?.slot.slotId ?? null).toBe(expectedActive({ ...scenario, offsetMinutes: scenario.datedEnd }))
      }),
      { numRuns: 200 },
    )
  })

  it('a Friday night running to 02:00 is active at 01:00 on Saturday', () => {
    // 2026-03-06 is a Friday. The instant is 01:00 SAST on Saturday, one hour
    // after the calendar date turned over and an hour the consumer is still out.
    const schedule: MusicSchedule = {
      businessId: 'biz-1',
      scheduleId: 'default',
      timezone: TIMEZONE,
      slots: [blanketSlot({ slotId: 'dated', dayOfWeek: 'FRI', interval: [21 * 60, 26 * 60], date: '2026-03-06' })],
      updatedAt: '2026-03-01T00:00:00.000Z',
      schemaVersion: 1,
    }

    expect(resolveActiveSlot(schedule, '2026-03-06T23:00:00.000Z')?.slot.slotId).toBe('dated')
    // 02:00 SAST Saturday: the night is over.
    expect(resolveActiveSlot(schedule, '2026-03-07T00:00:00.000Z')).toBeNull()
    // Saturday evening: a night names one night, and it has passed.
    expect(resolveActiveSlot(schedule, '2026-03-07T19:00:00.000Z')).toBeNull()
  })
})
