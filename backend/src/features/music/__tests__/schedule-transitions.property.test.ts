/**
 * Feature: Proof of demand, Property 6: Dated_Slot shadowing (nextTransitionAt
 * half).
 *
 * `nextTransitionAt` is the soonest boundary across both kinds of slot: the
 * next weekly occurrence of every weekly slot's start and end, and the single
 * absolute instant of every Dated_Slot's start and end that is still ahead of
 * now. This matters beyond bookkeeping: the schedule transition tick only wakes
 * for venues whose `nextTransitionAt` falls in the next 60 seconds, so a dated
 * boundary missing from this value is a Tonight that silently never starts (and
 * later, a Tonight_Reminder that never sends).
 *
 * A night may run past midnight, which puts its end boundary on the FOLLOWING
 * date. The generator covers that case, and two explicit tests pin it: the end
 * resolves to the next day's instant, and the Tonight_Reminder still fires once,
 * at the real start.
 *
 * The resolver half of Property 6 lives in
 * `packages/shared/lib/__tests__/dated-slot-shadowing.property.test.ts`.
 *
 * SAST is a fixed UTC+2 with no DST, so the expected instants are computed here
 * with plain arithmetic rather than a second copy of the zone lookup.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4
 */
import type { MusicSchedule, ScheduleDayOfWeek, ScheduleSlot } from '@area-code/shared/types'
import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { computeNextTransitionAt, datedSlotStartsInWindow } from '../schedule-transitions.js'

const TIMEZONE = 'Africa/Johannesburg'
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
const DAYS: readonly ScheduleDayOfWeek[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

/** 2026-03-02 is a Monday. */
const BASE_MONDAY_MS = Date.UTC(2026, 2, 2)

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function slotOf(args: {
  slotId: string
  dayOfWeek: ScheduleDayOfWeek
  start: number
  end: number
  date?: string
}): ScheduleSlot {
  const slot: ScheduleSlot = {
    slotId: args.slotId,
    dayOfWeek: args.dayOfWeek,
    startTime: hhmm(args.start),
    // A dated night that runs past midnight keeps a human `HH:mm` end; the
    // crossing lives in the derived `endTimeMin` below.
    endTime: hhmm(args.end % (24 * 60)),
    startTimeMin: args.start,
    endTimeMin: args.end,
    mode: 'blanket',
    genres: ['amapiano'],
  }
  if (args.date !== undefined) slot.date = args.date
  return slot
}

/** A strictly-increasing pair inside `[0, 1439]`, so `start < end` holds. */
const intervalArb = fc
  .uniqueArray(fc.integer({ min: 0, max: 1439 }), { minLength: 2, maxLength: 2 })
  .map(([a, b]) => (a! < b! ? ([a!, b!] as const) : ([b!, a!] as const)))

interface Case {
  schedule: MusicSchedule
  nowMs: number
  /** Every boundary as `(dayIndex, minutes, absoluteMs | null)`. */
  weekly: Array<{ dayIndex: number; minutes: number }>
  dated: number[]
}

const caseArb: fc.Arbitrary<Case> = fc
  .record({
    weeklyDayOffset: fc.integer({ min: 0, max: 6 }),
    weeklyInterval: intervalArb,
    datedDayOffset: fc.integer({ min: 0, max: 13 }),
    datedInterval: intervalArb,
    includeDated: fc.boolean(),
    // A dated night may run past midnight, which puts its END boundary on the
    // following date. `crossMidnight` replaces the generated interval with one
    // that opens in the evening and closes by the 04:00 rollover.
    crossMidnight: fc.boolean(),
    crossStart: fc.integer({ min: 17 * 60, max: 1439 }),
    crossEndRaw: fc.integer({ min: 1, max: 4 * 60 }),
    nowDayOffset: fc.integer({ min: 0, max: 13 }),
    nowMinutes: fc.integer({ min: 0, max: 1439 }),
  })
  .map((raw) => {
    const weeklyDay = DAYS[raw.weeklyDayOffset]!
    const datedDateMs = BASE_MONDAY_MS + raw.datedDayOffset * DAY_MS
    const datedDate = new Date(datedDateMs).toISOString().slice(0, 10)
    const datedDay = DAYS[(new Date(datedDateMs).getUTCDay() + 6) % 7]!
    const datedInterval: readonly [number, number] = raw.crossMidnight
      ? [raw.crossStart, 24 * 60 + raw.crossEndRaw]
      : raw.datedInterval

    const slots: ScheduleSlot[] = [
      slotOf({
        slotId: 'weekly',
        dayOfWeek: weeklyDay,
        start: raw.weeklyInterval[0],
        end: raw.weeklyInterval[1],
      }),
    ]
    if (raw.includeDated) {
      slots.push(
        slotOf({
          slotId: 'dated',
          dayOfWeek: datedDay,
          start: datedInterval[0],
          end: datedInterval[1],
          date: datedDate,
        }),
      )
    }

    // `now` on a whole local minute keeps the weekly arithmetic (which is
    // minute-granular by design) directly comparable.
    const nowMs = BASE_MONDAY_MS + raw.nowDayOffset * DAY_MS + raw.nowMinutes * 60_000 - SAST_OFFSET_MS

    return {
      schedule: {
        businessId: 'biz-1',
        scheduleId: 'default',
        timezone: TIMEZONE,
        slots,
        updatedAt: '2026-03-01T00:00:00.000Z',
        schemaVersion: 1 as const,
      },
      nowMs,
      weekly: [
        { dayIndex: raw.weeklyDayOffset, minutes: raw.weeklyInterval[0] },
        { dayIndex: raw.weeklyDayOffset, minutes: raw.weeklyInterval[1] },
      ],
      // Absolute instants, computed from the night's own midnight, so a crossing
      // end lands on the following date by the same arithmetic the reader uses.
      dated: raw.includeDated
        ? [
            datedDateMs + datedInterval[0] * 60_000 - SAST_OFFSET_MS,
            datedDateMs + datedInterval[1] * 60_000 - SAST_OFFSET_MS,
          ]
        : [],
    }
  })

/**
 * The expected value, computed independently: weekly boundaries recur (a
 * boundary landing exactly on `now` has already fired, so it counts as a week
 * away), dated boundaries fire once and only count while still ahead.
 */
function expectedNextTransition(c: Case): string | undefined {
  // `now` in the SAST wall-clock domain, as minutes since Monday 00:00.
  const nowSast = c.nowMs + SAST_OFFSET_MS
  const nowWeekMinute =
    (((new Date(nowSast).getUTCDay() + 6) % 7) * 24 * 60 +
      new Date(nowSast).getUTCHours() * 60 +
      new Date(nowSast).getUTCMinutes()) %
    (7 * 24 * 60)

  let best = Number.POSITIVE_INFINITY
  for (const boundary of c.weekly) {
    const target = boundary.dayIndex * 24 * 60 + boundary.minutes
    const raw = target - nowWeekMinute
    const deltaMin = raw <= 0 ? raw + 7 * 24 * 60 : raw
    const ms = c.nowMs + deltaMin * 60_000
    if (ms < best) best = ms
  }
  for (const ms of c.dated) {
    if (ms > c.nowMs && ms < best) best = ms
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : undefined
}

describe('Feature: Proof of demand, Property 6: nextTransitionAt spans weekly and dated slots', () => {
  it('returns the soonest boundary across both kinds of slot', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const actual = computeNextTransitionAt(c.schedule, new Date(c.nowMs).toISOString())
        expect(actual).toBe(expectedNextTransition(c))
      }),
      { numRuns: 200 },
    )
  })

  it('a dated boundary ahead of a weekly one wins, and a passed dated boundary never does', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const actual = computeNextTransitionAt(c.schedule, new Date(c.nowMs).toISOString())
        expect(actual).toBeDefined()
        const actualMs = Date.parse(actual!)
        // Always strictly ahead of now: a boundary at or behind `now` has fired.
        expect(actualMs).toBeGreaterThan(c.nowMs)
        // Never later than any future dated boundary.
        for (const ms of c.dated) {
          if (ms > c.nowMs) expect(actualMs).toBeLessThanOrEqual(ms)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('a schedule of only past dated slots has no future transition, so it leaves the sparse GSI', () => {
    const datedDate = new Date(BASE_MONDAY_MS).toISOString().slice(0, 10)
    const schedule: MusicSchedule = {
      businessId: 'biz-1',
      scheduleId: 'default',
      timezone: TIMEZONE,
      slots: [slotOf({ slotId: 'dated', dayOfWeek: 'MON', start: 20 * 60, end: 23 * 60, date: datedDate })],
      updatedAt: '2026-03-01T00:00:00.000Z',
      schemaVersion: 1,
    }
    // A week after the dated night: the one-shot boundaries are behind us.
    const now = new Date(BASE_MONDAY_MS + WEEK_MS).toISOString()
    expect(computeNextTransitionAt(schedule, now)).toBeUndefined()
  })

  it("a night running past midnight ends on the NEXT date's clock", () => {
    // Friday 2026-03-06, 21:00 to 02:00 SAST. The end boundary is 02:00 on
    // Saturday: if it resolved to 02:00 on Friday it would be behind `now` and
    // the tick would never wake to close the night.
    const schedule: MusicSchedule = {
      businessId: 'biz-1',
      scheduleId: 'default',
      timezone: TIMEZONE,
      slots: [slotOf({ slotId: 'dated', dayOfWeek: 'FRI', start: 21 * 60, end: 26 * 60, date: '2026-03-06' })],
      updatedAt: '2026-03-01T00:00:00.000Z',
      schemaVersion: 1,
    }

    // 21:30 SAST Friday: the start has fired, so the next boundary is the end.
    expect(computeNextTransitionAt(schedule, '2026-03-06T19:30:00.000Z')).toBe('2026-03-07T00:00:00.000Z')
    // 01:00 SAST Saturday: still ahead, still the same instant.
    expect(computeNextTransitionAt(schedule, '2026-03-06T23:00:00.000Z')).toBe('2026-03-07T00:00:00.000Z')
    // Past the end: both one-shot boundaries are spent, so the row leaves the GSI.
    expect(computeNextTransitionAt(schedule, '2026-03-07T00:00:00.000Z')).toBeUndefined()
  })

  it('the reminder fires once, at the real start, not at the crossing end', () => {
    const schedule: MusicSchedule = {
      businessId: 'biz-1',
      scheduleId: 'default',
      timezone: TIMEZONE,
      slots: [slotOf({ slotId: 'dated', dayOfWeek: 'FRI', start: 21 * 60, end: 26 * 60, date: '2026-03-06' })],
      updatedAt: '2026-03-01T00:00:00.000Z',
      schemaVersion: 1,
    }

    // The tick window containing 21:00 SAST Friday: one start, named by its night.
    expect(datedSlotStartsInWindow(schedule, '2026-03-06T18:59:30.000Z', '2026-03-06T19:00:30.000Z')).toEqual([
      { date: '2026-03-06', headline: null },
    ])
    // The window containing the 02:00 SAST end: a boundary, but not a start.
    expect(datedSlotStartsInWindow(schedule, '2026-03-06T23:59:30.000Z', '2026-03-07T00:00:30.000Z')).toEqual([])
    // Any later window: the start has fired and never fires again.
    expect(datedSlotStartsInWindow(schedule, '2026-03-07T18:59:30.000Z', '2026-03-07T19:00:30.000Z')).toEqual([])
  })

  it('a weekly-only schedule is unaffected by the dated-slot support', () => {
    const schedule: MusicSchedule = {
      businessId: 'biz-1',
      scheduleId: 'default',
      timezone: TIMEZONE,
      slots: [slotOf({ slotId: 'weekly', dayOfWeek: 'FRI', start: 20 * 60, end: 23 * 60 + 59 })],
      updatedAt: '2026-03-01T00:00:00.000Z',
      schemaVersion: 1,
    }
    // Thursday 2026-03-05 18:00 SAST → the next boundary is Friday 20:00 SAST.
    const now = new Date(Date.UTC(2026, 2, 5, 18 - 2, 0)).toISOString()
    expect(computeNextTransitionAt(schedule, now)).toBe(new Date(Date.UTC(2026, 2, 6, 18, 0)).toISOString())
  })
})
