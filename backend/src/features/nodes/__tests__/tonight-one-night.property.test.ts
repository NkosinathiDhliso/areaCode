/**
 * Feature: Proof of demand, Property 2c: Tonight and Going agree on the night.
 *
 * This is the regression the past-midnight change exists to close. The codebase
 * held two definitions of a night: Going keyed its rows at the 04:00 SAST
 * rollover, while Tonight resolved on the calendar date. At 00:01 on Saturday a
 * consumer still held their Friday Going mark, but Friday's headline had
 * vanished from the venue card, the detail block and the share snapshot, one hour
 * after the Tonight_Reminder said the night was starting.
 *
 * The property: for a Dated_Slot whose hours lie inside the night it names, the
 * instants at which Tonight reports it running are exactly the instants whose
 * Going night is that slot's date. One definition, so a mark and the headline it
 * was made for can never disagree.
 *
 * Every venue runs on Africa/Johannesburg (SAST, fixed UTC+2, no DST).
 *
 * Validates: Requirements 8.1, 8.5, 9.1
 */

import { DATED_SLOT_MAX_END_MIN } from '@area-code/shared/lib/schedule-validator'
import type { MusicSchedule, ScheduleDayOfWeek, ScheduleSlot } from '@area-code/shared/types'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { NIGHT_ROLLOVER_HOUR_SAST } from '../../../shared/time/sast.js'
import { goingNightFor } from '../going.js'
import { resolveTonightSlot } from '../tonight-summary.js'

const TIMEZONE = 'Africa/Johannesburg'
const MINUTES_PER_DAY = 24 * 60
const DAY_MS = MINUTES_PER_DAY * 60 * 1000
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000
const DAYS: readonly ScheduleDayOfWeek[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

function hhmm(minutes: number): string {
  const wall = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${String(Math.floor(wall / 60)).padStart(2, '0')}:${String(wall % 60).padStart(2, '0')}`
}

/** The UTC instant of a SAST wall clock `minutes` after midnight on `date`. */
function instantAt(date: string, minutes: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - SAST_OFFSET_MS + minutes * 60_000).toISOString()
}

function nightSchedule(date: string, startMin: number, endMin: number): MusicSchedule {
  const dayIndex = (new Date(Date.parse(`${date}T00:00:00.000Z`)).getUTCDay() + 6) % 7
  const slot: ScheduleSlot = {
    slotId: 'tonight',
    dayOfWeek: DAYS[dayIndex]!,
    startTime: hhmm(startMin),
    // `endTime` is the human `HH:mm`; the derived `endTimeMin` carries the
    // crossing, exactly as the validator writes it.
    endTime: hhmm(endMin),
    startTimeMin: startMin,
    endTimeMin: endMin,
    mode: 'blanket',
    genres: ['amapiano'],
    date,
    headline: 'Amapiano till late',
  }
  return {
    businessId: 'biz-1',
    scheduleId: 'default',
    timezone: TIMEZONE,
    slots: [slot],
    updatedAt: '2026-03-01T00:00:00.000Z',
    schemaVersion: 1,
  }
}

/** Any night across a couple of years, including month ends and the leap day. */
const nightArb = fc
  .integer({ min: 0, max: 2 * 365 })
  .map((offset) => new Date(Date.parse('2026-01-01T00:00:00.000Z') + offset * DAY_MS).toISOString().slice(0, 10))

/**
 * A night whose hours sit inside the night it names: it opens no earlier than
 * the rollover on its own date and closes no later than the rollover the
 * following morning. That is the whole space the validator admits.
 */
const windowArb = fc
  .tuple(
    fc.integer({ min: NIGHT_ROLLOVER_HOUR_SAST * 60, max: MINUTES_PER_DAY - 1 }),
    fc.integer({ min: NIGHT_ROLLOVER_HOUR_SAST * 60 + 1, max: DATED_SLOT_MAX_END_MIN }),
  )
  .filter(([start, end]) => start < end)

describe('Feature: Proof of demand, Property 2c: Tonight and Going name the same night', () => {
  it('reports the night running exactly while the Going night is its own date', () => {
    fc.assert(
      fc.property(
        nightArb,
        windowArb,
        fc.integer({ min: 0, max: 2 * MINUTES_PER_DAY - 1 }),
        (night, window, minute) => {
          const [startMin, endMin] = window
          const schedule = nightSchedule(night, startMin, endMin)
          const nowIso = instantAt(night, minute)

          const resolved = resolveTonightSlot(schedule, nowIso)
          const running = resolved !== null && resolved.startsAt === null
          const inWindow = startMin <= minute && minute < endMin

          expect(running).toBe(inWindow)
          if (running) {
            // The one assertion this file exists for: the night Tonight is showing
            // is the night Going keyed the consumer's mark to.
            expect(goingNightFor(nowIso)).toBe(resolved!.slot.date)
          }
        },
      ),
      { numRuns: 300 },
    )
  })

  it('never reports a night running at an instant belonging to another night', () => {
    fc.assert(
      fc.property(
        nightArb,
        windowArb,
        fc.integer({ min: 0, max: 3 * MINUTES_PER_DAY - 1 }),
        (night, window, minute) => {
          const schedule = nightSchedule(night, window[0], window[1])
          const nowIso = instantAt(night, minute)
          const resolved = resolveTonightSlot(schedule, nowIso)

          if (resolved !== null && resolved.startsAt === null) {
            expect(goingNightFor(nowIso)).toBe(night)
          }
        },
      ),
      { numRuns: 300 },
    )
  })

  it('still shows Friday at 00:01 on Saturday, the minute the old rule lost', () => {
    // 2026-03-06 is a Friday. Before this change the headline vanished here while
    // the consumer still held a Friday Going mark and had been pushed a reminder
    // an hour earlier.
    const schedule = nightSchedule('2026-03-06', 21 * 60, 26 * 60)
    const justAfterMidnight = instantAt('2026-03-06', 24 * 60 + 1)

    expect(goingNightFor(justAfterMidnight)).toBe('2026-03-06')
    expect(resolveTonightSlot(schedule, justAfterMidnight)?.slot.date).toBe('2026-03-06')
    expect(resolveTonightSlot(schedule, justAfterMidnight)?.startsAt).toBeNull()
  })
})
