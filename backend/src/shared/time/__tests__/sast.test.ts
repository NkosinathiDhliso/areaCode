/**
 * SAST day arithmetic: the boundary every owner-facing "today" is measured from.
 *
 * The cases that matter are the two instants either side of 00:00 SAST. Between
 * 22:00 and 00:00 UTC a South African venue is at its busiest, so a UTC-day
 * boundary would split one night across two "days" and hand the owner a number
 * that describes neither.
 *
 * **Validates: Requirements 15.1, 15.2, 15.8**
 */

import { describe, it, expect } from 'vitest'

import { SAST_OFFSET_MS, instantMs, sastDateString, startOfSastDayIso, secondsUntilNextSastMidnight } from '../sast.js'

/** 00:00:00.000 SAST on a date, as epoch ms (= 22:00 UTC the previous day). */
function sastMidnightMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) - SAST_OFFSET_MS
}

const DAY_SECONDS = 86_400

describe('instantMs', () => {
  it('accepts a Date, an epoch number and an ISO string', () => {
    const ms = Date.parse('2026-09-23T18:30:00.000Z')
    expect(instantMs(ms)).toBe(ms)
    expect(instantMs(new Date(ms))).toBe(ms)
    expect(instantMs('2026-09-23T18:30:00.000Z')).toBe(ms)
  })

  it('throws on an unparseable instant rather than guessing', () => {
    expect(() => instantMs('not-a-date')).toThrow(/invalid instant/)
  })
})

describe('the SAST midnight boundary', () => {
  const midnight = sastMidnightMs('2026-09-24')

  it('reads the closing evening as the previous day one millisecond before midnight', () => {
    const justBefore = midnight - 1

    expect(sastDateString(justBefore)).toBe('2026-09-23')
    expect(startOfSastDayIso(justBefore)).toBe(new Date(sastMidnightMs('2026-09-23')).toISOString())
    // 21:59:59.999 UTC is still the 23rd in SAST, even though UTC calls it the 23rd
    // only by two hours' luck. The day start is 22:00 UTC on the 22nd.
    expect(startOfSastDayIso(justBefore)).toBe('2026-09-22T22:00:00.000Z')
  })

  it('rolls to the next day exactly at midnight', () => {
    expect(sastDateString(midnight)).toBe('2026-09-24')
    expect(startOfSastDayIso(midnight)).toBe('2026-09-23T22:00:00.000Z')
  })

  it('keeps 01:00 SAST (23:00 UTC) inside the new SAST day, not the UTC one', () => {
    const onePastMidnight = midnight + 60 * 60 * 1000

    expect(new Date(onePastMidnight).toISOString()).toBe('2026-09-23T23:00:00.000Z')
    expect(sastDateString(onePastMidnight)).toBe('2026-09-24')
  })

  it('defaults to now when no instant is supplied', () => {
    expect(sastDateString()).toBe(sastDateString(Date.now()))
    expect(startOfSastDayIso()).toBe(startOfSastDayIso(Date.now()))
  })
})

describe('secondsUntilNextSastMidnight', () => {
  const midnight = sastMidnightMs('2026-09-24')

  it('is a full day exactly at midnight, never zero', () => {
    expect(secondsUntilNextSastMidnight(midnight)).toBe(DAY_SECONDS)
  })

  it('is one second one second before midnight', () => {
    expect(secondsUntilNextSastMidnight(midnight - 1000)).toBe(1)
  })

  it('rounds a sub-second remainder up so a key never expires early', () => {
    expect(secondsUntilNextSastMidnight(midnight - 1)).toBe(1)
  })

  it('counts from the SAST day start, so a 20:00 SAST write expires in four hours', () => {
    const eightPmSast = midnight - 4 * 60 * 60 * 1000

    expect(secondsUntilNextSastMidnight(eightPmSast)).toBe(4 * 60 * 60)
  })
})
