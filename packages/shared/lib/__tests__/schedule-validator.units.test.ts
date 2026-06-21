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
import { validateMusicSchedule } from '../schedule-validator'

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
