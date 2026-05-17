/**
 * Property tests for the Music_Schedule validator.
 *
 *  - Property 6: Music_Schedule serialize/parse round-trip — `parse(serialize(schedule))`
 *    is deeply equal to the canonical value returned by the first parse.
 *  - Property 9: Schedule validator rejects bad intervals and preserves prior
 *    state — the validator rejects (a) `startTimeMin >= endTimeMin`,
 *    (b) overlapping slots on the same `dayOfWeek`, (c) lineup-mode slots whose
 *    first entry's `startTime` ≠ slot start, and (d) duplicate LineupEntry
 *    `startTime` values within a slot, and never mutates the input on rejection.
 *
 * Validates: Requirements 3.5, 3.7, 3.9, 10.5, 10.8
 *
 * Per-failure-path unit coverage lives in `schedule-validator.units.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

import { MUSIC_GENRES } from '../../constants/genre-weights'
import type { LineupEntry, MusicGenre, MusicSchedule, ScheduleDayOfWeek, ScheduleSlot } from '../../types'
import { validateMusicSchedule } from '../schedule-validator'

// ─── Constants ──────────────────────────────────────────────────────────────

const DAYS_OF_WEEK: ScheduleDayOfWeek[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

/** A small set of IANA timezones the runtime is guaranteed to know. */
const VALID_TIMEZONES = ['UTC', 'Africa/Johannesburg', 'America/New_York', 'Europe/London', 'Asia/Tokyo']

// ─── Helpers ────────────────────────────────────────────────────────────────

const minToHhMm = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

// ─── Shared arbitraries ─────────────────────────────────────────────────────

const distinctGenresArb: fc.Arbitrary<MusicGenre[]> = fc.uniqueArray(fc.constantFrom(...MUSIC_GENRES), {
  minLength: 1,
  maxLength: 5,
})

// ─── Valid Music_Schedule arbitrary (Property 6) ────────────────────────────

/**
 * Per-day "RNG bundle". We pre-roll all randomness up front (boundaries,
 * mode choices, genre bags, lineup extras) and then map deterministically
 * into a list of valid slots in `generateValidSlotsForDay`. Capping at 6
 * boundaries keeps slot count ≤ 3 per day, which keeps test runtime tight
 * while still exercising overlap and abutting-slot logic.
 */
const dayRngArb = fc.record({
  boundaries: fc.uniqueArray(fc.integer({ min: 0, max: 1439 }), { minLength: 0, maxLength: 6 }),
  modeChoices: fc.array(fc.constantFrom('blanket' as const, 'lineup' as const), {
    minLength: 3,
    maxLength: 3,
  }),
  blanketGenresPerSlot: fc.array(distinctGenresArb, { minLength: 3, maxLength: 3 }),
  lineupExtraStartsPerSlot: fc.array(
    fc.uniqueArray(fc.integer({ min: 0, max: 1439 }), { minLength: 0, maxLength: 4 }),
    { minLength: 3, maxLength: 3 },
  ),
  lineupGenresPerSlot: fc.array(fc.array(distinctGenresArb, { minLength: 5, maxLength: 5 }), {
    minLength: 3,
    maxLength: 3,
  }),
})

// `dayRngArb` is an `fc.Arbitrary<T>` and fast-check v4 no longer exposes a
// public `IndexableType` helper. Declare the shape explicitly — it stays in
// lockstep with `dayRngArb` because `fc.assert(fc.property(dayRngArb, ...))`
// will fail-fast if the runtime shape drifts.
interface DayRng {
  boundaries: number[]
  modeChoices: Array<'blanket' | 'lineup'>
  blanketGenresPerSlot: MusicGenre[][]
  lineupExtraStartsPerSlot: number[][]
  lineupGenresPerSlot: MusicGenre[][][]
}

/**
 * Build non-overlapping, half-open intervals from a sorted list of unique
 * boundaries. Pair consecutive boundaries (b0,b1), (b2,b3), ... so the
 * intervals are guaranteed disjoint and `start < end` for each.
 */
function buildIntervals(boundaries: number[]): Array<[number, number]> {
  const sorted = [...boundaries].sort((a, b) => a - b)
  const out: Array<[number, number]> = []
  for (let i = 0; i + 1 < sorted.length; i += 2) {
    out.push([sorted[i]!, sorted[i + 1]!])
  }
  return out
}

function generateValidSlotsForDay(rng: DayRng, day: ScheduleDayOfWeek): ScheduleSlot[] {
  const intervals = buildIntervals(rng.boundaries)
  const slots: ScheduleSlot[] = []
  for (let i = 0; i < intervals.length; i++) {
    const [s, e] = intervals[i]!
    const mode = rng.modeChoices[i] ?? 'blanket'
    const slotId = `slot-${day}-${i}`
    if (mode === 'blanket') {
      slots.push({
        slotId,
        dayOfWeek: day,
        startTime: minToHhMm(s),
        endTime: minToHhMm(e),
        startTimeMin: s,
        endTimeMin: e,
        mode: 'blanket',
        genres: rng.blanketGenresPerSlot[i] ?? ['amapiano'],
      })
    } else {
      // Lineup mode: the first entry MUST start at the slot start (R3.7).
      // Additional entries are drawn from `(slot.startTimeMin, slot.endTimeMin)`,
      // de-duped and sorted so they satisfy the unique-startTime invariant.
      const extras = (rng.lineupExtraStartsPerSlot[i] ?? [])
        .filter((m: number) => m > s && m < e)
        .filter((m: number, idx: number, arr: number[]) => arr.indexOf(m) === idx)
        .sort((a: number, b: number) => a - b)
      const allStarts = [s, ...extras]
      const lineup: LineupEntry[] = allStarts.map((m, j) => ({
        startTime: minToHhMm(m),
        startTimeMin: m,
        genres: (rng.lineupGenresPerSlot[i] ?? [])[j] ?? ['amapiano'],
      }))
      slots.push({
        slotId,
        dayOfWeek: day,
        startTime: minToHhMm(s),
        endTime: minToHhMm(e),
        startTimeMin: s,
        endTimeMin: e,
        mode: 'lineup',
        lineup,
      })
    }
  }
  return slots
}

const validScheduleArb: fc.Arbitrary<MusicSchedule> = fc
  .record({
    timezone: fc.constantFrom(...VALID_TIMEZONES),
    days: fc.tuple(dayRngArb, dayRngArb, dayRngArb, dayRngArb, dayRngArb, dayRngArb, dayRngArb),
  })
  .map(({ timezone, days }) => {
    const slots = days.flatMap((rng, idx) => generateValidSlotsForDay(rng, DAYS_OF_WEEK[idx]!))
    return {
      businessId: 'biz-1',
      scheduleId: 'sched-1',
      timezone,
      slots,
      updatedAt: '2025-01-01T00:00:00.000Z',
      schemaVersion: 1 as const,
    }
  })

// ─── Bad-input arbitraries (Property 9) ─────────────────────────────────────

/**
 * Wrap a single slot into a minimal one-slot Music_Schedule. The schema
 * accepts plain objects (no need to populate `startTimeMin`/`endTimeMin` —
 * the validator derives them from `HH:mm`).
 */
const wrapSingleSlot = (slot: Record<string, unknown>): Record<string, unknown> => ({
  businessId: 'biz-1',
  scheduleId: 'sched-1',
  timezone: 'UTC',
  slots: [slot],
  updatedAt: '2025-01-01T00:00:00.000Z',
  schemaVersion: 1,
})

/** A slot with `startTimeMin >= endTimeMin` → `invalid_slot_interval`. */
const badIntervalScheduleArb = fc
  .tuple(
    fc.integer({ min: 0, max: 1439 }),
    fc.integer({ min: 0, max: 1439 }),
    fc.constantFrom(...DAYS_OF_WEEK),
    distinctGenresArb,
  )
  .filter(([s, e]) => s >= e)
  .map(([s, e, day, genres]) =>
    wrapSingleSlot({
      slotId: 'bad-interval',
      dayOfWeek: day,
      startTime: minToHhMm(s),
      endTime: minToHhMm(e),
      mode: 'blanket',
      genres,
    }),
  )

/**
 * Two slots on the same `dayOfWeek` whose half-open intervals overlap.
 * The chained generator guarantees `s1 < e1`, `s2 < e2`, and
 * `s1 ≤ s2 < e1` so `[s1, e1) ∩ [s2, e2)` is non-empty.
 */
const overlappingSlotsScheduleArb = fc.integer({ min: 0, max: 1437 }).chain((s1) =>
  fc.integer({ min: s1 + 2, max: 1439 }).chain((e1) =>
    fc.integer({ min: s1, max: e1 - 1 }).chain((s2) =>
      fc.integer({ min: s2 + 1, max: 1439 }).chain((e2) =>
        fc.tuple(fc.constantFrom(...DAYS_OF_WEEK), distinctGenresArb, distinctGenresArb).map(([day, g1, g2]) => ({
          businessId: 'biz-1',
          scheduleId: 'sched-1',
          timezone: 'UTC',
          slots: [
            {
              slotId: 'a',
              dayOfWeek: day,
              startTime: minToHhMm(s1),
              endTime: minToHhMm(e1),
              mode: 'blanket',
              genres: g1,
            },
            {
              slotId: 'b',
              dayOfWeek: day,
              startTime: minToHhMm(s2),
              endTime: minToHhMm(e2),
              mode: 'blanket',
              genres: g2,
            },
          ],
          updatedAt: '2025-01-01T00:00:00.000Z',
          schemaVersion: 1,
        })),
      ),
    ),
  ),
)

/**
 * A lineup-mode slot whose first entry's `startTime` is strictly greater
 * than the slot's `startTime` → `lineup_first_entry_misaligned`. The slot
 * interval has at least 2 minutes of width so we can place the first entry
 * inside `(s, e)` and still satisfy `lineup_entry_outside_slot`.
 */
const misalignedLineupScheduleArb = fc.integer({ min: 0, max: 1437 }).chain((s) =>
  fc.integer({ min: s + 2, max: 1439 }).chain((e) =>
    fc.integer({ min: s + 1, max: e - 1 }).chain((firstEntryStart) =>
      fc.tuple(fc.constantFrom(...DAYS_OF_WEEK), distinctGenresArb).map(([day, genres]) =>
        wrapSingleSlot({
          slotId: 'misaligned',
          dayOfWeek: day,
          startTime: minToHhMm(s),
          endTime: minToHhMm(e),
          mode: 'lineup',
          lineup: [{ startTime: minToHhMm(firstEntryStart), genres }],
        }),
      ),
    ),
  ),
)

/**
 * A lineup-mode slot whose first entry IS aligned (so the misalignment
 * branch does not fire) but whose second entry duplicates the first entry's
 * `startTime` → `lineup_duplicate_start_times`.
 */
const duplicateLineupStartTimesScheduleArb = fc.integer({ min: 0, max: 1438 }).chain((s) =>
  fc.integer({ min: s + 1, max: 1439 }).chain((e) =>
    fc.tuple(fc.constantFrom(...DAYS_OF_WEEK), distinctGenresArb, distinctGenresArb).map(([day, g1, g2]) =>
      wrapSingleSlot({
        slotId: 'duplicate-starts',
        dayOfWeek: day,
        startTime: minToHhMm(s),
        endTime: minToHhMm(e),
        mode: 'lineup',
        lineup: [
          { startTime: minToHhMm(s), genres: g1 },
          { startTime: minToHhMm(s), genres: g2 },
        ],
      }),
    ),
  ),
)

// ─── Property 6: Music_Schedule serialize/parse round-trip ──────────────────

describe('Property 6: Music_Schedule serialize/parse round-trip', () => {
  /**
   * For any valid Music_Schedule, parsing it via `validateMusicSchedule`,
   * serialising the canonical value with JSON, and re-parsing produces a
   * value deeply equal to the first parse. The redundant `startTimeMin` /
   * `endTimeMin` fields are derived deterministically from `HH:mm` on parse,
   * so they cannot drift across the round-trip.
   *
   * Validates: Requirements 3.5, 3.7, 10.5
   */
  it('parse(serialize(parse(schedule))) is deeply equal to parse(schedule)', () => {
    fc.assert(
      fc.property(validScheduleArb, (schedule) => {
        const first = validateMusicSchedule(schedule)
        expect(first.ok).toBe(true)
        if (!first.ok) return
        const reparsed = JSON.parse(JSON.stringify(first.value))
        const second = validateMusicSchedule(reparsed)
        expect(second.ok).toBe(true)
        if (!second.ok) return
        expect(second.value).toEqual(first.value)
      }),
      { numRuns: 100 },
    )
  })

  /**
   * For any valid Music_Schedule, the parsed value's derived
   * `startTimeMin` / `endTimeMin` agree with the canonical `HH:mm` strings.
   * This is the invariant that makes the round-trip fail-safe: if the parse
   * ever drifted, this assertion would catch it.
   *
   * Validates: Requirements 3.5, 10.5
   */
  it('parsed slots have derived minutes that match their HH:mm strings', () => {
    fc.assert(
      fc.property(validScheduleArb, (schedule) => {
        const result = validateMusicSchedule(schedule)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        for (const slot of result.value.slots) {
          const [sh, sm] = slot.startTime.split(':')
          const [eh, em] = slot.endTime.split(':')
          expect(slot.startTimeMin).toBe(Number(sh) * 60 + Number(sm))
          expect(slot.endTimeMin).toBe(Number(eh) * 60 + Number(em))
          if (slot.mode === 'lineup' && slot.lineup) {
            for (const entry of slot.lineup) {
              const [h, m] = entry.startTime.split(':')
              expect(entry.startTimeMin).toBe(Number(h) * 60 + Number(m))
            }
          }
        }
      }),
      { numRuns: 100 },
    )
  })
})

// ─── Property 9: Schedule validator rejects bad intervals ───────────────────

describe('Property 9: Schedule validator rejects bad intervals and preserves prior state', () => {
  /**
   * For any slot with `startTimeMin >= endTimeMin` (including the
   * `startTime === endTime` corner), the validator rejects with
   * `invalid_slot_interval` and does not mutate the input object.
   * Cross-midnight intervals are explicitly forbidden (R5.10) — they are
   * modelled as a Cross_Midnight_Pair (R3.12) instead.
   *
   * Validates: Requirements 3.5
   */
  it('rejects schedules with startTimeMin >= endTimeMin and does not mutate the input', () => {
    fc.assert(
      fc.property(badIntervalScheduleArb, (schedule) => {
        const snapshot = JSON.parse(JSON.stringify(schedule))
        const result = validateMusicSchedule(schedule)
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.error.code).toBe('invalid_slot_interval')
        expect(schedule).toEqual(snapshot)
      }),
      { numRuns: 100 },
    )
  })

  /**
   * For any pair of slots on the same `dayOfWeek` whose half-open intervals
   * overlap, the validator rejects with `overlapping_slots` and does not
   * mutate the input object.
   *
   * Validates: Requirements 3.9
   */
  it('rejects schedules with overlapping slots on the same dayOfWeek', () => {
    fc.assert(
      fc.property(overlappingSlotsScheduleArb, (schedule) => {
        const snapshot = JSON.parse(JSON.stringify(schedule))
        const result = validateMusicSchedule(schedule)
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.error.code).toBe('overlapping_slots')
        expect(schedule).toEqual(snapshot)
      }),
      { numRuns: 100 },
    )
  })

  /**
   * For any lineup-mode slot whose first entry's `startTimeMin` is strictly
   * greater than the slot's `startTimeMin`, the validator rejects with
   * `lineup_first_entry_misaligned` and does not mutate the input object.
   *
   * Validates: Requirements 3.7
   */
  it("rejects lineup-mode slots whose first entry's startTime ≠ slot start", () => {
    fc.assert(
      fc.property(misalignedLineupScheduleArb, (schedule) => {
        const snapshot = JSON.parse(JSON.stringify(schedule))
        const result = validateMusicSchedule(schedule)
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.error.code).toBe('lineup_first_entry_misaligned')
        expect(schedule).toEqual(snapshot)
      }),
      { numRuns: 100 },
    )
  })

  /**
   * For any lineup-mode slot whose `lineup` contains two entries with the
   * same `startTime`, the validator rejects with
   * `lineup_duplicate_start_times` and does not mutate the input object.
   *
   * Validates: Requirements 3.7
   */
  it('rejects lineup-mode slots with duplicate LineupEntry startTime values', () => {
    fc.assert(
      fc.property(duplicateLineupStartTimesScheduleArb, (schedule) => {
        const snapshot = JSON.parse(JSON.stringify(schedule))
        const result = validateMusicSchedule(schedule)
        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.error.code).toBe('lineup_duplicate_start_times')
        expect(schedule).toEqual(snapshot)
      }),
      { numRuns: 100 },
    )
  })

  /**
   * Across the union of all four bad-input shapes, the validator never
   * mutates the input. This is the "preserves prior state" half of
   * Property 9: rejected operations short-circuit before any persistence
   * step would run, so prior state cannot drift.
   *
   * Validates: Requirements 10.8
   */
  it('does not mutate the input on rejection across all four failure modes', () => {
    const anyBadScheduleArb = fc.oneof(
      badIntervalScheduleArb,
      overlappingSlotsScheduleArb,
      misalignedLineupScheduleArb,
      duplicateLineupStartTimesScheduleArb,
    )
    fc.assert(
      fc.property(anyBadScheduleArb, (schedule) => {
        const snapshot = JSON.parse(JSON.stringify(schedule))
        const result = validateMusicSchedule(schedule)
        expect(result.ok).toBe(false)
        expect(schedule).toEqual(snapshot)
      }),
      { numRuns: 200 },
    )
  })
})
