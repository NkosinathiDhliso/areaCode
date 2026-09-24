/**
 * Unit tests for the Music_Schedule validator. Verifies specific failure paths
 * and the deterministic derivation of `startTimeMin` / `endTimeMin` from
 * `HH:mm`. Property-based round-trip and bad-interval coverage lives in
 * `schedule-validator.test.ts` (task 2.4).
 *
 * Validates: Requirements 3.5, 3.6, 3.7, 3.9, 3.11, 5.10
 */
import { describe, it, expect } from 'vitest'

import type { MusicSchedule } from '../../types'
import { DATED_SLOT_MAX_END_MIN, validateMusicSchedule } from '../schedule-validator'

const baseSchedule = {
  businessId: 'biz-1',
  scheduleId: 'sched-1',
  timezone: 'Africa/Johannesburg',
  updatedAt: '2025-01-01T00:00:00.000Z',
  schemaVersion: 1 as const,
  slots: [
    {
      slotId: 'slot-1',
      dayOfWeek: 'FRI',
      startTime: '20:00',
      endTime: '23:59',
      mode: 'lineup',
      lineup: [
        { startTime: '20:00', genres: ['amapiano'] },
        { startTime: '22:00', djName: 'Ms. K', genres: ['gqom', 'amapiano'] },
      ],
    },
  ],
}

describe('validateMusicSchedule', () => {
  it('accepts a valid schedule and derives minutes-since-midnight from HH:mm', () => {
    const result = validateMusicSchedule(baseSchedule)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const slot = result.value.slots[0]!
    expect(slot.startTimeMin).toBe(20 * 60)
    expect(slot.endTimeMin).toBe(23 * 60 + 59)
    expect(slot.lineup?.[0]?.startTimeMin).toBe(20 * 60)
    expect(slot.lineup?.[1]?.startTimeMin).toBe(22 * 60)
  })

  it('overwrites caller-supplied startTimeMin/endTimeMin so the redundant fields cannot drift', () => {
    // Caller supplies wildly wrong derived values; validator must overwrite
    // them with values derived from HH:mm.
    const drifted = {
      ...baseSchedule,
      slots: [
        {
          ...baseSchedule.slots[0],
          startTimeMin: 0,
          endTimeMin: 0,
          lineup: [
            { startTime: '20:00', startTimeMin: 9999, genres: ['amapiano'] },
            { startTime: '22:00', startTimeMin: 9999, djName: 'Ms. K', genres: ['gqom', 'amapiano'] },
          ],
        },
      ],
    }
    const result = validateMusicSchedule(drifted)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const value: MusicSchedule = result.value
    expect(value.slots[0]!.startTimeMin).toBe(20 * 60)
    expect(value.slots[0]!.endTimeMin).toBe(23 * 60 + 59)
    expect(value.slots[0]!.lineup?.[0]?.startTimeMin).toBe(20 * 60)
    expect(value.slots[0]!.lineup?.[1]?.startTimeMin).toBe(22 * 60)
  })

  it('rejects an unknown IANA timezone with code "invalid_timezone"', () => {
    const bad = { ...baseSchedule, timezone: 'Mars/Olympus_Mons' }
    const result = validateMusicSchedule(bad)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid_timezone')
    expect(result.error.field).toBe('timezone')
  })

  it('rejects a slot whose endTime <= startTime (cross-midnight forbidden, R5.10)', () => {
    const bad = {
      ...baseSchedule,
      slots: [
        {
          slotId: 's',
          dayOfWeek: 'FRI',
          startTime: '23:00',
          endTime: '02:00',
          mode: 'blanket',
          genres: ['amapiano'],
        },
      ],
    }
    const result = validateMusicSchedule(bad)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid_slot_interval')
    expect(result.error.slotId).toBe('s')
  })

  it('rejects overlapping slots on the same dayOfWeek (R3.9)', () => {
    const bad = {
      ...baseSchedule,
      slots: [
        {
          slotId: 'a',
          dayOfWeek: 'FRI',
          startTime: '20:00',
          endTime: '22:00',
          mode: 'blanket',
          genres: ['amapiano'],
        },
        {
          slotId: 'b',
          dayOfWeek: 'FRI',
          startTime: '21:00',
          endTime: '23:00',
          mode: 'blanket',
          genres: ['gqom'],
        },
      ],
    }
    const result = validateMusicSchedule(bad)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('overlapping_slots')
    expect(result.error.slotId).toBe('b')
  })

  it('allows abutting slots on the same dayOfWeek (half-open intervals, R3.9)', () => {
    // a ends at 22:00, b starts at 22:00 - half-open intervals so no overlap.
    const ok = {
      ...baseSchedule,
      slots: [
        { slotId: 'a', dayOfWeek: 'FRI', startTime: '20:00', endTime: '22:00', mode: 'blanket', genres: ['amapiano'] },
        { slotId: 'b', dayOfWeek: 'FRI', startTime: '22:00', endTime: '23:59', mode: 'blanket', genres: ['gqom'] },
      ],
    }
    const result = validateMusicSchedule(ok)
    expect(result.ok).toBe(true)
  })

  it('rejects a lineup whose first entry is not aligned with the slot start (R3.7)', () => {
    const bad = {
      ...baseSchedule,
      slots: [
        {
          slotId: 'l',
          dayOfWeek: 'FRI',
          startTime: '20:00',
          endTime: '23:00',
          mode: 'lineup',
          lineup: [{ startTime: '20:30', genres: ['amapiano'] }],
        },
      ],
    }
    const result = validateMusicSchedule(bad)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('lineup_first_entry_misaligned')
  })

  it('rejects a lineup with duplicate startTime values (R3.7)', () => {
    const bad = {
      ...baseSchedule,
      slots: [
        {
          slotId: 'l',
          dayOfWeek: 'FRI',
          startTime: '20:00',
          endTime: '23:00',
          mode: 'lineup',
          lineup: [
            { startTime: '20:00', genres: ['amapiano'] },
            { startTime: '20:00', genres: ['gqom'] },
          ],
        },
      ],
    }
    const result = validateMusicSchedule(bad)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('lineup_duplicate_start_times')
  })

  it('rejects a lineup entry outside the slot interval (R3.7)', () => {
    const bad = {
      ...baseSchedule,
      slots: [
        {
          slotId: 'l',
          dayOfWeek: 'FRI',
          startTime: '20:00',
          endTime: '23:00',
          mode: 'lineup',
          lineup: [
            { startTime: '20:00', genres: ['amapiano'] },
            { startTime: '23:00', genres: ['gqom'] }, // == endTime, half-open excludes
          ],
        },
      ],
    }
    const result = validateMusicSchedule(bad)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('lineup_entry_outside_slot')
  })

  it('rejects a blanket slot that also declares a lineup field (R3.6)', () => {
    const bad = {
      ...baseSchedule,
      slots: [
        {
          slotId: 'l',
          dayOfWeek: 'FRI',
          startTime: '20:00',
          endTime: '23:00',
          mode: 'blanket',
          genres: ['amapiano'],
          lineup: [{ startTime: '20:00', genres: ['amapiano'] }],
        },
      ],
    }
    const result = validateMusicSchedule(bad)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('blanket_must_not_have_lineup')
  })

  it('rejects a lineup slot that also declares top-level genres (R3.7)', () => {
    const bad = {
      ...baseSchedule,
      slots: [
        {
          slotId: 'l',
          dayOfWeek: 'FRI',
          startTime: '20:00',
          endTime: '23:00',
          mode: 'lineup',
          genres: ['amapiano'],
          lineup: [{ startTime: '20:00', genres: ['amapiano'] }],
        },
      ],
    }
    const result = validateMusicSchedule(bad)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('lineup_must_not_have_top_genres')
  })

  it('rejects a malformed HH:mm string at the schema_shape stage (R3.5)', () => {
    const bad = {
      ...baseSchedule,
      slots: [
        {
          slotId: 's',
          dayOfWeek: 'FRI',
          startTime: '8:00', // missing leading zero
          endTime: '23:00',
          mode: 'blanket',
          genres: ['amapiano'],
        },
      ],
    }
    const result = validateMusicSchedule(bad)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('schema_shape')
    expect(result.error.field).toContain('startTime')
  })

  it('rejects a non-MusicGenre value at the schema_shape stage (R3.6)', () => {
    const bad = {
      ...baseSchedule,
      slots: [
        {
          slotId: 's',
          dayOfWeek: 'FRI',
          startTime: '20:00',
          endTime: '23:00',
          mode: 'blanket',
          genres: ['not-a-real-genre'],
        },
      ],
    }
    const result = validateMusicSchedule(bad)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('schema_shape')
  })
})

/**
 * Dated_Slot rules (proof-of-demand R8.1, R8.2). Weekly slots are unchanged by
 * these rules, which is asserted first: every existing schedule must keep
 * validating exactly as before.
 *
 * Validates: Requirements 8.1, 8.2
 */
describe('validateMusicSchedule: Dated_Slot rules', () => {
  // 2026-03-06 is a Friday.
  const datedFriday = {
    slotId: 'tonight',
    dayOfWeek: 'FRI',
    startTime: '21:00',
    endTime: '23:59',
    mode: 'blanket',
    genres: ['amapiano'],
    date: '2026-03-06',
    headline: 'Amapiano with DJ Khanya',
    featuredRewardId: 'reward-1',
  }

  it('accepts a Dated_Slot and carries date, headline and featuredRewardId through', () => {
    const result = validateMusicSchedule({ ...baseSchedule, slots: [datedFriday] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const slot = result.value.slots[0]!
    expect(slot.date).toBe('2026-03-06')
    expect(slot.headline).toBe('Amapiano with DJ Khanya')
    expect(slot.featuredRewardId).toBe('reward-1')
    expect(slot.startTimeMin).toBe(21 * 60)
  })

  it('leaves weekly slots untouched: no date means no new field on the parsed value', () => {
    const result = validateMusicSchedule(baseSchedule)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const slot = result.value.slots[0]!
    expect(slot.date).toBeUndefined()
    expect(slot.headline).toBeUndefined()
    expect(slot.featuredRewardId).toBeUndefined()
  })

  it('lets a Dated_Slot overlap the weekly slot it shadows', () => {
    // The weekly FRI slot runs 20:00-23:59; the dated slot sits inside it.
    const result = validateMusicSchedule({
      ...baseSchedule,
      slots: [...baseSchedule.slots, datedFriday],
    })
    expect(result.ok).toBe(true)
  })

  it('rejects two Dated_Slots overlapping on the same date', () => {
    const result = validateMusicSchedule({
      ...baseSchedule,
      slots: [datedFriday, { ...datedFriday, slotId: 'tonight-2', startTime: '22:00', endTime: '23:30' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('overlapping_dated_slots')
    expect(result.error.slotId).toBe('tonight-2')
  })

  it('accepts overlapping Dated_Slots on different dates', () => {
    const result = validateMusicSchedule({
      ...baseSchedule,
      // 2026-03-13 is the following Friday.
      slots: [datedFriday, { ...datedFriday, slotId: 'next-week', date: '2026-03-13' }],
    })
    expect(result.ok).toBe(true)
  })

  it('rejects a date that is not a real calendar date', () => {
    const result = validateMusicSchedule({
      ...baseSchedule,
      slots: [{ ...datedFriday, date: '2026-02-30' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid_slot_date')
  })

  it('rejects a malformed date at the schema_shape stage', () => {
    const result = validateMusicSchedule({
      ...baseSchedule,
      slots: [{ ...datedFriday, date: '6 March' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('schema_shape')
  })

  it('rejects a dayOfWeek that disagrees with the date', () => {
    const result = validateMusicSchedule({
      ...baseSchedule,
      slots: [{ ...datedFriday, dayOfWeek: 'SAT' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('dated_slot_day_mismatch')
  })

  it('rejects a headline over 60 characters', () => {
    const result = validateMusicSchedule({
      ...baseSchedule,
      slots: [{ ...datedFriday, headline: 'x'.repeat(61) }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('schema_shape')
    expect(result.error.field).toContain('headline')
  })

  it('rejects a date more than 14 days ahead of the caller-supplied today', () => {
    const result = validateMusicSchedule(
      { ...baseSchedule, slots: [{ ...datedFriday, date: '2026-03-27', dayOfWeek: 'FRI' }] },
      { todayLocalDate: '2026-03-06' },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('dated_slot_out_of_range')
  })

  it('accepts a date exactly 14 days ahead', () => {
    const result = validateMusicSchedule(
      { ...baseSchedule, slots: [{ ...datedFriday, date: '2026-03-20', dayOfWeek: 'FRI' }] },
      { todayLocalDate: '2026-03-06' },
    )
    expect(result.ok).toBe(true)
  })

  it('accepts a past date so a stale Tonight never blocks a later write', () => {
    const result = validateMusicSchedule({ ...baseSchedule, slots: [datedFriday] }, { todayLocalDate: '2026-04-01' })
    expect(result.ok).toBe(true)
  })

  // ── A night may run past midnight (decision 12) ─────────────────────────
  //
  // `endTime` stays a human `HH:mm`; the derived `endTimeMin` carries the day
  // crossing, so `02:00` reads as 2am and resolves as minute 1560 of the night.

  it('derives a past-midnight end past 1439 and leaves endTime human', () => {
    const result = validateMusicSchedule({
      ...baseSchedule,
      slots: [{ ...datedFriday, startTime: '21:00', endTime: '02:00' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const slot = result.value.slots[0]!
    expect(slot.endTime).toBe('02:00')
    expect(slot.startTimeMin).toBe(21 * 60)
    expect(slot.endTimeMin).toBe(26 * 60)
  })

  it('accepts a night ending exactly at the rollover', () => {
    const result = validateMusicSchedule({
      ...baseSchedule,
      slots: [{ ...datedFriday, startTime: '21:00', endTime: '04:00' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.slots[0]!.endTimeMin).toBe(DATED_SLOT_MAX_END_MIN)
  })

  it('rejects a night that runs past the rollover: a night cannot outlive itself', () => {
    const result = validateMusicSchedule({
      ...baseSchedule,
      slots: [{ ...datedFriday, startTime: '21:00', endTime: '04:01' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('dated_slot_end_past_rollover')
    expect(result.error.field).toBe('slots[0].endTime')
    expect(result.error.slotId).toBe('tonight')
  })

  it('rejects a dated slot whose end equals its start, which would run a full day', () => {
    const result = validateMusicSchedule({
      ...baseSchedule,
      slots: [{ ...datedFriday, startTime: '21:00', endTime: '21:00' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('dated_slot_end_past_rollover')
  })

  it('still rejects a cross-midnight WEEKLY slot: a weekday has no night to anchor to', () => {
    const { date: _date, headline: _headline, featuredRewardId: _rewardId, ...weekly } = datedFriday
    const result = validateMusicSchedule({
      ...baseSchedule,
      slots: [{ ...weekly, startTime: '21:00', endTime: '02:00' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid_slot_interval')
  })

  it('rejects a night that reaches into the next date and collides with its slot', () => {
    // Friday 21:00-02:00 overlaps Saturday 01:00-03:00 in absolute time, even
    // though the two `date` values differ.
    const result = validateMusicSchedule({
      ...baseSchedule,
      slots: [
        { ...datedFriday, startTime: '21:00', endTime: '02:00' },
        {
          ...datedFriday,
          slotId: 'saturday',
          dayOfWeek: 'SAT',
          date: '2026-03-07',
          startTime: '01:00',
          endTime: '03:00',
        },
      ],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('overlapping_dated_slots')
    expect(result.error.slotId).toBe('saturday')
  })

  it('accepts adjacent nights that meet exactly at a boundary', () => {
    const result = validateMusicSchedule({
      ...baseSchedule,
      slots: [
        { ...datedFriday, startTime: '21:00', endTime: '02:00' },
        {
          ...datedFriday,
          slotId: 'saturday',
          dayOfWeek: 'SAT',
          date: '2026-03-07',
          startTime: '02:00',
          endTime: '03:00',
        },
      ],
    })
    expect(result.ok).toBe(true)
  })

  it('skips the horizon check when no reference date is supplied', () => {
    const result = validateMusicSchedule({
      ...baseSchedule,
      // 2027-03-05 is a Friday, far past the horizon.
      slots: [{ ...datedFriday, date: '2027-03-05' }],
    })
    expect(result.ok).toBe(true)
  })
})
