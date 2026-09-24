/**
 * `datedSlotStartsInWindow`: which published night is starting right now
 * (proof-of-demand R9.7, task 10.6).
 *
 * The Tonight_Reminder has no timer and no Lambda of its own. It rides the
 * schedule transition tick, so the only thing that decides when it fires is this
 * pure function reading the tick's own 60-second window. These cases pin the
 * three rules that keep "once, at slot start" true:
 *
 *  - a Dated_Slot start inside the window is reported, with the owner's headline
 *  - a start lands in exactly ONE window, so a re-run of the same tick cannot
 *    produce a second fan-out
 *  - slot ENDS and weekly slots never fire: closing time is not a night starting,
 *    and the weekly grid is a standing pattern, not a night anyone marked going for
 *
 * _Requirements: 9.7_
 */

import type { MusicSchedule, ScheduleSlot } from '@area-code/shared/types'
import { describe, it, expect } from 'vitest'

import { datedSlotStartsInWindow } from '../schedule-transitions'

const TZ = 'Africa/Johannesburg'

function slot(partial: Partial<ScheduleSlot>): ScheduleSlot {
  return {
    slotId: 'slot-1',
    dayOfWeek: 'FRI',
    startTime: '21:00',
    endTime: '23:00',
    startTimeMin: 21 * 60,
    endTimeMin: 23 * 60,
    mode: 'genres',
    genres: ['amapiano'],
    ...partial,
  } as ScheduleSlot
}

function schedule(slots: ScheduleSlot[]): MusicSchedule {
  return {
    businessId: 'biz-1',
    scheduleId: 'default',
    timezone: TZ,
    slots,
    updatedAt: '2026-03-01T00:00:00.000Z',
  } as MusicSchedule
}

// 21:00 SAST on 2026-03-06 is 19:00 UTC.
const START_UTC = '2026-03-06T19:00:00.000Z'

function windowAround(startIso: string, offsetMs: number): [string, string] {
  const from = new Date(new Date(startIso).getTime() + offsetMs)
  return [from.toISOString(), new Date(from.getTime() + 60_000).toISOString()]
}

describe('datedSlotStartsInWindow reports a night that is starting (R9.7)', () => {
  it('reports the date and the headline for a Dated_Slot start inside the window', () => {
    const [from, to] = windowAround(START_UTC, 0)

    const starting = datedSlotStartsInWindow(
      schedule([slot({ date: '2026-03-06', headline: 'Amapiano all night' })]),
      from,
      to,
    )

    expect(starting).toEqual([{ date: '2026-03-06', headline: 'Amapiano all night' }])
  })

  it('reports a null headline when the owner wrote none, rather than inventing one', () => {
    const [from, to] = windowAround(START_UTC, 0)

    const starting = datedSlotStartsInWindow(schedule([slot({ date: '2026-03-06' })]), from, to)

    expect(starting).toEqual([{ date: '2026-03-06', headline: null }])
  })

  it('fires in exactly one window, so a duplicate tick produces no second fan-out', () => {
    const inside = windowAround(START_UTC, 0)
    const before = windowAround(START_UTC, -60_000)
    const after = windowAround(START_UTC, 60_000)
    const sched = schedule([slot({ date: '2026-03-06', headline: 'Amapiano all night' })])

    expect(datesIn(sched, inside)).toEqual(['2026-03-06'])
    expect(datesIn(sched, before)).toEqual([])
    expect(datesIn(sched, after)).toEqual([])
  })

  it('excludes the window end: the half-open window hands the boundary to the next tick', () => {
    // A window that ENDS exactly on the start instant must not claim it.
    const from = new Date(new Date(START_UTC).getTime() - 60_000).toISOString()
    expect(datedSlotStartsInWindow(schedule([slot({ date: '2026-03-06' })]), from, START_UTC)).toEqual([])
  })
})

describe('datedSlotStartsInWindow ignores everything that is not a night starting', () => {
  it('never fires on a slot END (closing time is not a night starting)', () => {
    // 23:00 SAST is 21:00 UTC.
    const [from, to] = windowAround('2026-03-06T21:00:00.000Z', 0)

    expect(datedSlotStartsInWindow(schedule([slot({ date: '2026-03-06' })]), from, to)).toEqual([])
  })

  it('never fires on a weekly slot, however exactly its boundary lines up', () => {
    const [from, to] = windowAround(START_UTC, 0)

    // Same wall-clock start, no `date`: the standing weekly pattern.
    expect(datedSlotStartsInWindow(schedule([slot({})]), from, to)).toEqual([])
  })

  it('reports nothing for a schedule with no slots, so a deleted night sends nothing (R9.10)', () => {
    const [from, to] = windowAround(START_UTC, 0)

    expect(datedSlotStartsInWindow(schedule([]), from, to)).toEqual([])
  })

  it('rejects a window it cannot read rather than guessing at one', () => {
    expect(() => datedSlotStartsInWindow(schedule([]), 'not-a-date', START_UTC)).toThrow(RangeError)
  })
})

function datesIn(sched: MusicSchedule, [from, to]: [string, string]): string[] {
  return datedSlotStartsInWindow(sched, from, to).map((entry) => entry.date)
}
