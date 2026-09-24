/**
 * Tonight draft composition and validation (proof-of-demand R8.1, R8.3).
 *
 * Validates: Requirements 8.1, 8.3
 *
 * The form asks the owner for a date, not a day of week, and publishes through
 * the one schedule validator. These tests pin that: the weekday is derived, the
 * horizon and the dated-slot overlap rule are reported against the control that
 * caused them, and an over-long headline is reported against the headline.
 */
import { DATED_SLOT_MAX_DAYS_AHEAD, HEADLINE_MAX_LENGTH } from '@area-code/shared/lib/schedule-validator'
import type { MusicSchedule, ScheduleSlot } from '@area-code/shared/types'
import { describe, it, expect } from 'vitest'

import {
  buildTonightSubmission,
  draftForDate,
  draftToDatedSlot,
  maxTonightDate,
  tonightCrossesMidnight,
  type TonightDraft,
} from '../tonightSlot'

const TIMEZONE = 'Africa/Johannesburg'

// 2026-03-06 is a Friday.
const TODAY = '2026-03-06'

function schedule(slots: ScheduleSlot[] = []): MusicSchedule {
  return {
    businessId: 'biz-1',
    scheduleId: 'default',
    timezone: TIMEZONE,
    slots,
    updatedAt: '2026-03-01T00:00:00.000Z',
    schemaVersion: 1,
  }
}

function draft(overrides: Partial<TonightDraft> = {}): TonightDraft {
  return {
    slotId: 'tonight-1',
    date: TODAY,
    startTime: '20:00',
    endTime: '23:59',
    headline: 'Amapiano with DJ Thandi',
    genres: ['amapiano'],
    featuredRewardId: '',
    ...overrides,
  }
}

describe('draftToDatedSlot', () => {
  it('derives dayOfWeek from the date and never asks for it', () => {
    const slot = draftToDatedSlot(draft())
    expect(slot?.dayOfWeek).toBe('FRI')
    expect(slot?.date).toBe(TODAY)
    expect(slot?.mode).toBe('blanket')
  })

  it('returns null for a date that is not a real calendar date', () => {
    expect(draftToDatedSlot(draft({ date: '2026-02-30' }))).toBeNull()
  })

  it('omits an empty headline and an unset featured get rather than sending blanks', () => {
    const slot = draftToDatedSlot(draft({ headline: '   ', featuredRewardId: '' }))
    expect(slot?.headline).toBeUndefined()
    expect(slot?.featuredRewardId).toBeUndefined()
  })
})

describe('tonightCrossesMidnight', () => {
  it('reads an end at or before the start as the following morning', () => {
    expect(tonightCrossesMidnight(draft({ startTime: '21:00', endTime: '02:00' }))).toBe(true)
    expect(tonightCrossesMidnight(draft({ startTime: '21:00', endTime: '21:00' }))).toBe(true)
  })

  it('is false for a night that ends the same evening', () => {
    expect(tonightCrossesMidnight(draft({ startTime: '20:00', endTime: '23:00' }))).toBe(false)
  })
})

describe('draftForDate', () => {
  it('defaults to a night that ends after midnight, inside the rollover', () => {
    const seeded = draftForDate(null, TODAY)
    expect(seeded.startTime).toBe('20:00')
    expect(seeded.endTime).toBe('02:00')
    expect(tonightCrossesMidnight(seeded)).toBe(true)
    // The default must be publishable as-is.
    expect(buildTonightSubmission({ draft: seeded, schedule: schedule(), todayLocalDate: TODAY }).ok).toBe(true)
  })
})

describe('buildTonightSubmission', () => {
  it('returns the schedule to publish for a valid draft', () => {
    const result = buildTonightSubmission({ draft: draft(), schedule: schedule(), todayLocalDate: TODAY })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const published = result.schedule.slots.find((s) => s.slotId === 'tonight-1')
    expect(published?.headline).toBe('Amapiano with DJ Thandi')
    expect(published?.date).toBe(TODAY)
  })

  it('reports a date beyond the publish horizon against the date field', () => {
    const tooFar = maxTonightDate(TODAY)
    expect(tooFar).not.toBeNull()
    const beyond = new Date(Date.parse(`${tooFar!}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const result = buildTonightSubmission({
      draft: draft({ date: beyond }),
      schedule: schedule(),
      todayLocalDate: TODAY,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.field).toBe('date')
    expect(result.error.message).toContain(String(DATED_SLOT_MAX_DAYS_AHEAD))
  })

  it('reports an overlap with another Tonight on the same date against the times', () => {
    const existing: ScheduleSlot = {
      slotId: 'tonight-other',
      dayOfWeek: 'FRI',
      date: TODAY,
      startTime: '21:00',
      endTime: '23:00',
      startTimeMin: 21 * 60,
      endTimeMin: 23 * 60,
      mode: 'blanket',
      genres: ['deep_house'],
    }
    const result = buildTonightSubmission({ draft: draft(), schedule: schedule([existing]), todayLocalDate: TODAY })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.field).toBe('time')
  })

  it('reports a night that runs past the 04:00 rollover against the times', () => {
    // 22:00 to 21:00 reads as a night ending 21:00 the next evening, which would
    // outlive the night it names.
    const result = buildTonightSubmission({
      draft: draft({ startTime: '22:00', endTime: '21:00' }),
      schedule: schedule(),
      todayLocalDate: TODAY,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.field).toBe('time')
    expect(result.error.message).toContain('04:00')
  })

  it('accepts a night that runs past midnight', () => {
    const result = buildTonightSubmission({
      draft: draft({ startTime: '21:00', endTime: '02:00' }),
      schedule: schedule(),
      todayLocalDate: TODAY,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const published = result.schedule.slots.find((s) => s.date !== undefined)!
    // The wire shape is unchanged: `endTime` stays human, the derived minute
    // carries the crossing.
    expect(published.endTime).toBe('02:00')
    expect(published.endTimeMin).toBe(26 * 60)
    expect(published.endTimeMin).toBeGreaterThan(1439)
  })

  it('leaves a same-evening night exactly as it was: one row, no crossing', () => {
    const result = buildTonightSubmission({
      draft: draft({ startTime: '20:00', endTime: '23:00' }),
      schedule: schedule(),
      todayLocalDate: TODAY,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.schedule.slots).toHaveLength(1)
    const published = result.schedule.slots[0]!
    expect(published.endTime).toBe('23:00')
    expect(published.endTimeMin).toBe(23 * 60)
  })

  it('reports an over-long headline against the headline field', () => {
    const result = buildTonightSubmission({
      draft: draft({ headline: 'x'.repeat(HEADLINE_MAX_LENGTH + 1) }),
      schedule: schedule(),
      todayLocalDate: TODAY,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.field).toBe('headline')
    expect(result.error.message).toContain(String(HEADLINE_MAX_LENGTH))
  })

  it('reports an empty genre selection against the genres field', () => {
    const result = buildTonightSubmission({ draft: draft({ genres: [] }), schedule: schedule(), todayLocalDate: TODAY })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.field).toBe('genres')
  })
})
