import fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { isStreakAtRisk, toSASTDate, sastDateForOffset } from './streak.js'

describe('toSASTDate / sastDateForOffset', () => {
  it('rolls an early-morning UTC time into the SAST calendar day', () => {
    // 2026-01-01T23:30Z is 2026-01-02 01:30 SAST.
    expect(toSASTDate('2026-01-01T23:30:00.000Z')).toBe('2026-01-02')
  })

  it('offsets days in SAST', () => {
    const nowMs = Date.parse('2026-03-10T09:00:00.000Z') // 11:00 SAST
    expect(sastDateForOffset(nowMs, 0)).toBe('2026-03-10')
    expect(sastDateForOffset(nowMs, -1)).toBe('2026-03-09')
    expect(sastDateForOffset(nowMs, 1)).toBe('2026-03-11')
  })
})

describe('isStreakAtRisk', () => {
  const today = '2026-03-10'
  const yesterday = '2026-03-09'

  it('is at risk when the last check-in was yesterday and the streak is live', () => {
    expect(
      isStreakAtRisk({
        streakCount: 5,
        lastCheckInSastDate: yesterday,
        todaySastDate: today,
        yesterdaySastDate: yesterday,
      }),
    ).toBe(true)
  })

  it('is safe when already checked in today', () => {
    expect(
      isStreakAtRisk({
        streakCount: 5,
        lastCheckInSastDate: today,
        todaySastDate: today,
        yesterdaySastDate: yesterday,
      }),
    ).toBe(false)
  })

  it('does not nag when the streak already broke (last check-in before yesterday)', () => {
    expect(
      isStreakAtRisk({
        streakCount: 5,
        lastCheckInSastDate: '2026-03-01',
        todaySastDate: today,
        yesterdaySastDate: yesterday,
      }),
    ).toBe(false)
  })

  it('is never at risk with no streak or no history', () => {
    expect(
      isStreakAtRisk({
        streakCount: 0,
        lastCheckInSastDate: yesterday,
        todaySastDate: today,
        yesterdaySastDate: yesterday,
      }),
    ).toBe(false)
    expect(
      isStreakAtRisk({ streakCount: 3, lastCheckInSastDate: null, todaySastDate: today, yesterdaySastDate: yesterday }),
    ).toBe(false)
  })

  // Feature: streak-reminder, Property 1: at-risk requires a live streak, a
  // yesterday check-in, and no check-in today — never otherwise.
  it('Property 1: at risk iff streak>=1 AND last check-in was yesterday', () => {
    const dates = ['2026-03-08', '2026-03-09', '2026-03-10', null] as const
    fc.assert(
      fc.property(fc.integer({ min: -2, max: 30 }), fc.constantFrom(...dates), (streakCount, last) => {
        const result = isStreakAtRisk({
          streakCount,
          lastCheckInSastDate: last,
          todaySastDate: today,
          yesterdaySastDate: yesterday,
        })
        const expected = streakCount >= 1 && last === yesterday
        expect(result).toBe(expected)
      }),
      { numRuns: 200 },
    )
  })
})
