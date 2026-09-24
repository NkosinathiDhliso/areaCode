/**
 * SAST display formatting and datetime-local parsing (proof-of-demand R15.15).
 *
 * Owner and admin surfaces render one clock, the venue's. These tests pin the
 * boundary that matters: an instant between 22:00 UTC and midnight UTC is
 * already the next day in SAST, so the UTC date and the SAST date disagree. A
 * formatter that leans on the device timezone gets that wrong for the two hours
 * a venue is busiest, which is exactly when an owner checks the portal.
 *
 * **Validates: Requirements 15.15**
 */
import { describe, it, expect } from 'vitest'

import {
  formatSastDate,
  formatSastDateTime,
  formatSastDayMonth,
  formatSastLongDate,
  formatSastTime,
  sastDateTimeLocalToIso,
  toSastDateTimeLocal,
} from '../sast'

// 00:30 SAST on 10 August, which is 22:30 UTC on 9 August: the boundary case.
const AFTER_SAST_MIDNIGHT = '2026-08-09T22:30:00.000Z'
// 23:59 SAST on 9 August, one minute before the same boundary.
const BEFORE_SAST_MIDNIGHT = '2026-08-09T21:59:00.000Z'

describe('SAST display formatters', () => {
  it('reads an instant just after midnight SAST as the next calendar day', () => {
    // The UTC date is still the 9th; the venue's day is the 10th.
    expect(AFTER_SAST_MIDNIGHT.slice(0, 10)).toBe('2026-08-09')
    expect(formatSastDate(AFTER_SAST_MIDNIGHT)).toBe('10 Aug 2026')
    expect(formatSastTime(AFTER_SAST_MIDNIGHT)).toBe('00:30')
    expect(formatSastDateTime(AFTER_SAST_MIDNIGHT)).toBe('10 Aug 2026 00:30')
  })

  it('reads an instant just before midnight SAST as the same calendar day', () => {
    expect(formatSastDate(BEFORE_SAST_MIDNIGHT)).toBe('09 Aug 2026')
    expect(formatSastTime(BEFORE_SAST_MIDNIGHT)).toBe('23:59')
  })

  it('formats the long and compact shapes in SAST', () => {
    expect(formatSastLongDate(AFTER_SAST_MIDNIGHT)).toBe('10 August 2026')
    expect(formatSastDayMonth(AFTER_SAST_MIDNIGHT)).toBe('10 Aug')
  })

  it('treats a bare calendar date as that SAST date, with no day shift', () => {
    expect(formatSastDate('2026-08-09')).toBe('09 Aug 2026')
    expect(formatSastLongDate('2026-01-01')).toBe('1 January 2026')
  })

  it('accepts Date and epoch-ms instants as well as ISO strings', () => {
    const ms = Date.parse(AFTER_SAST_MIDNIGHT)
    expect(formatSastDate(ms)).toBe('10 Aug 2026')
    expect(formatSastDate(new Date(ms))).toBe('10 Aug 2026')
  })

  it('throws on an unparseable instant rather than rendering a guess', () => {
    expect(() => formatSastDate('not-a-date')).toThrow()
  })
})

describe('datetime-local parsing as SAST', () => {
  it('reads a wall-clock value as SAST, two hours ahead of UTC', () => {
    expect(sastDateTimeLocalToIso('2026-08-09T18:30')).toBe('2026-08-09T16:30:00.000Z')
  })

  it('maps a value just after midnight to the previous UTC day', () => {
    expect(sastDateTimeLocalToIso('2026-08-10T00:30')).toBe('2026-08-09T22:30:00.000Z')
  })

  it('round-trips an instant through the input value and back', () => {
    const value = toSastDateTimeLocal(AFTER_SAST_MIDNIGHT)
    expect(value).toBe('2026-08-10T00:30')
    expect(sastDateTimeLocalToIso(value)).toBe(AFTER_SAST_MIDNIGHT)
  })

  it('returns null for a malformed or impossible value instead of guessing', () => {
    expect(sastDateTimeLocalToIso('')).toBeNull()
    expect(sastDateTimeLocalToIso('2026-08-09')).toBeNull()
    expect(sastDateTimeLocalToIso('09/08/2026 18:30')).toBeNull()
    expect(sastDateTimeLocalToIso('2026-02-30T18:30')).toBeNull()
  })

  it('tolerates surrounding whitespace on an otherwise valid value', () => {
    expect(sastDateTimeLocalToIso('  2026-08-09T18:30 ')).toBe('2026-08-09T16:30:00.000Z')
  })
})
