/**
 * Property tests for the Schedule_Resolver.
 *
 *  - Property 1: Schedule resolver returns at most one Active_Slot - for any
 *    valid Music_Schedule and any RFC 3339 timestamp, the resolver returns
 *    either `null` or a single `ResolvedSlot`.
 *  - Property 2: Active_Slot interval contains the timestamp - when a slot is
 *    returned, the timestamp's local minutes-since-midnight (computed in the
 *    schedule's IANA timezone the same way the resolver does) lies inside
 *    the half-open interval `[slot.startTimeMin, slot.endTimeMin)`.
 *  - Property 3: Schedule resolver idempotence - two consecutive calls with
 *    the same inputs return deeply equal results.
 *  - Property 4: Lineup-active slot always returns exactly one LineupEntry -
 *    when a lineup-mode slot is the Active_Slot, the resolver returns a
 *    `lineupEntry` whose `startTimeMin <= localMin` and is the maximum such
 *    value among the slot's lineup entries.
 *
 * Validates: Requirements 5.1, 5.4, 5.7, 5.9, 10.1, 10.2, 10.3
 */
import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { MUSIC_GENRES } from '../../constants/genre-weights'
import type { LineupEntry, MusicGenre, MusicSchedule, ScheduleDayOfWeek, ScheduleSlot } from '../../types'
import { resolveActiveSlot } from '../scheduleResolver'

// ─── Constants ──────────────────────────────────────────────────────────────

const DAYS_OF_WEEK: ScheduleDayOfWeek[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

/** A small set of IANA timezones the runtime is guaranteed to know. */
const VALID_TIMEZONES = ['UTC', 'Africa/Johannesburg', 'America/New_York', 'Europe/London', 'Asia/Tokyo']

const WEEKDAY_MAP: Readonly<Record<string, ScheduleDayOfWeek>> = Object.freeze({
  Mon: 'MON',
  Tue: 'TUE',
  Wed: 'WED',
  Thu: 'THU',
  Fri: 'FRI',
  Sat: 'SAT',
  Sun: 'SUN',
})

// ─── Helpers ────────────────────────────────────────────────────────────────

const minToHhMm = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/**
 * Mirror of the resolver's internal `toLocalParts`. Computing the expected
 * local minutes here (rather than re-deriving from `Date.getUTCHours()`)
 * means we exercise the same `Intl.DateTimeFormat` path the resolver uses,
 * so cross-runtime DST edge cases stay consistent.
 */
function localPartsForAssertion(
  date: Date,
  timezone: string,
): {
  dayOfWeek: ScheduleDayOfWeek
  minutesSinceMidnight: number
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = fmt.formatToParts(date)
  let weekdayRaw: string | undefined
  let hourRaw: string | undefined
  let minuteRaw: string | undefined
  for (const part of parts) {
    if (part.type === 'weekday') weekdayRaw = part.value
    else if (part.type === 'hour') hourRaw = part.value
    else if (part.type === 'minute') minuteRaw = part.value
  }
  const dayOfWeek = WEEKDAY_MAP[weekdayRaw ?? '']
  if (!dayOfWeek || hourRaw === undefined || minuteRaw === undefined) {
    throw new Error(
      `localPartsForAssertion: unexpected formatToParts result (weekday=${String(weekdayRaw)}, hour=${String(hourRaw)}, minute=${String(minuteRaw)})`,
    )
  }
  let hour = Number.parseInt(hourRaw, 10)
  const minute = Number.parseInt(minuteRaw, 10)
  if (hour === 24) hour = 0
  return { dayOfWeek, minutesSinceMidnight: hour * 60 + minute }
}

// ─── Shared arbitraries ─────────────────────────────────────────────────────

const distinctGenresArb: fc.Arbitrary<MusicGenre[]> = fc.uniqueArray(fc.constantFrom(...MUSIC_GENRES), {
  minLength: 1,
  maxLength: 5,
})

/**
 * Per-day "RNG bundle". We pre-roll all randomness up front and then map
 * deterministically into a list of valid slots in `generateValidSlotsForDay`.
 * Capping at 6 boundaries keeps slot count ≤ 3 per day, which keeps test
 * runtime tight while still exercising lineup and blanket modes.
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
// public `IndexableType` helper. Declare the shape explicitly - it stays in
// lockstep with `dayRngArb` because the runtime always satisfies it.
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
      // R3.7: first LineupEntry MUST start at the slot start.
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

/**
 * RFC 3339 timestamp arbitrary. We pick an epoch millisecond inside a wide
 * window spanning roughly 2000-2050 so DST transitions and leap days are
 * well-represented across the IANA timezones in `VALID_TIMEZONES`. The
 * resulting `Date.toISOString()` string is RFC 3339 with the `Z` offset.
 */
const EPOCH_MIN_MS = Date.UTC(2000, 0, 1)
const EPOCH_MAX_MS = Date.UTC(2050, 11, 31, 23, 59, 59, 999)

const rfc3339TimestampArb: fc.Arbitrary<string> = fc
  .integer({ min: EPOCH_MIN_MS, max: EPOCH_MAX_MS })
  .map((ms) => new Date(ms).toISOString())

// ─── Property 1: at most one Active_Slot ────────────────────────────────────

describe('Property 1: Schedule resolver returns at most one Active_Slot', () => {
  /**
   * For any valid Music_Schedule and any RFC 3339 timestamp, the resolver
   * returns either `null` or a single `ResolvedSlot`. The validator already
   * guarantees no two slots overlap on the same `dayOfWeek` (R3.9 / R5.6),
   * so this is the observable "at most one" guarantee from R5.1 / R10.1.
   *
   * We additionally cross-check by counting slots that match
   * `[startTimeMin, endTimeMin)` for the local `dayOfWeek` using the same
   * Intl-derived local minutes the resolver uses; the count must be 0 or 1
   * and must agree with the resolver's null / non-null verdict.
   *
   * Validates: Requirements 5.1, 10.1
   */
  it('returns null or exactly one ResolvedSlot for any valid input', () => {
    fc.assert(
      fc.property(validScheduleArb, rfc3339TimestampArb, (schedule, timestamp) => {
        const result = resolveActiveSlot(schedule, timestamp)
        if (result !== null) {
          // Single slot, present.
          expect(typeof result).toBe('object')
          expect(result.slot).toBeDefined()
        }

        // Independent count using the same Intl-derived local parts.
        const local = localPartsForAssertion(new Date(timestamp), schedule.timezone)
        const matching = schedule.slots.filter(
          (slot) =>
            slot.dayOfWeek === local.dayOfWeek &&
            slot.startTimeMin <= local.minutesSinceMidnight &&
            local.minutesSinceMidnight < slot.endTimeMin,
        )
        expect(matching.length).toBeLessThanOrEqual(1)
        if (matching.length === 0) {
          expect(result).toBeNull()
        } else {
          expect(result).not.toBeNull()
          expect(result!.slot.slotId).toBe(matching[0]!.slotId)
        }
      }),
      { numRuns: 200 },
    )
  })
})

// ─── Property 2: Active_Slot interval contains the timestamp ────────────────

describe('Property 2: Active_Slot interval contains the timestamp', () => {
  /**
   * When the resolver returns a `ResolvedSlot`, the timestamp's local
   * minutes-since-midnight (computed against the schedule's IANA timezone
   * the same way the resolver does, via `Intl.DateTimeFormat`) lies inside
   * the slot's half-open interval `[startTimeMin, endTimeMin)` for the
   * matching `dayOfWeek`.
   *
   * Validates: Requirements 5.4, 10.2
   */
  it('returned slot contains the timestamp under half-open interval semantics', () => {
    fc.assert(
      fc.property(validScheduleArb, rfc3339TimestampArb, (schedule, timestamp) => {
        const result = resolveActiveSlot(schedule, timestamp)
        if (result === null) return // R5.5: nothing to assert.
        const local = localPartsForAssertion(new Date(timestamp), schedule.timezone)
        expect(result.slot.dayOfWeek).toBe(local.dayOfWeek)
        expect(result.slot.startTimeMin).toBeLessThanOrEqual(local.minutesSinceMidnight)
        expect(local.minutesSinceMidnight).toBeLessThan(result.slot.endTimeMin)
      }),
      { numRuns: 200 },
    )
  })
})

// ─── Property 3: idempotence ────────────────────────────────────────────────

describe('Property 3: Schedule resolver idempotence', () => {
  /**
   * Two consecutive calls with the same valid Music_Schedule and timestamp
   * return deeply equal results. The resolver is observably pure (R5.9):
   * no `Date.now()`, no globals, no I/O - same inputs → same output under
   * deep structural comparison.
   *
   * Validates: Requirements 5.9, 10.3
   */
  it('two consecutive calls produce deeply equal results', () => {
    fc.assert(
      fc.property(validScheduleArb, rfc3339TimestampArb, (schedule, timestamp) => {
        const a = resolveActiveSlot(schedule, timestamp)
        const b = resolveActiveSlot(schedule, timestamp)
        expect(b).toEqual(a)
      }),
      { numRuns: 200 },
    )
  })
})

// ─── Property 4: lineup-active slot returns exactly one LineupEntry ─────────

describe('Property 4: Lineup-active slot always returns exactly one LineupEntry', () => {
  /**
   * Whenever the Active_Slot is in `lineup` mode, the resolver returns a
   * `lineupEntry` whose `startTimeMin <= localMin` and is the maximum such
   * value among the slot's lineup entries (R5.7). R3.7 guarantees the first
   * LineupEntry's `startTimeMin` equals the slot's `startTimeMin`, so a
   * matching entry always exists and is unique by `startTime`.
   *
   * Blanket-mode slots are asserted to NOT carry a `lineupEntry`.
   *
   * Validates: Requirements 5.7, 10.1
   */
  it('lineup-mode slot returns the LineupEntry with the greatest startTimeMin ≤ local minutes', () => {
    fc.assert(
      fc.property(validScheduleArb, rfc3339TimestampArb, (schedule, timestamp) => {
        const result = resolveActiveSlot(schedule, timestamp)
        if (result === null) return

        if (result.slot.mode === 'blanket') {
          expect(result.lineupEntry).toBeUndefined()
          return
        }

        // Lineup mode: exactly one LineupEntry must be present and selected.
        const local = localPartsForAssertion(new Date(timestamp), schedule.timezone)
        expect(result.lineupEntry).toBeDefined()
        const chosen = result.lineupEntry!
        expect(chosen.startTimeMin).toBeLessThanOrEqual(local.minutesSinceMidnight)

        const lineup = result.slot.lineup ?? []
        // Independently compute the expected pick: max startTimeMin ≤ localMin.
        const candidates = lineup.filter((e) => e.startTimeMin <= local.minutesSinceMidnight)
        expect(candidates.length).toBeGreaterThanOrEqual(1)
        const expectedMax = candidates.reduce((acc, e) => (e.startTimeMin > acc ? e.startTimeMin : acc), -1)
        expect(chosen.startTimeMin).toBe(expectedMax)
        // Uniqueness: no other entry shares that startTimeMin (R3.7).
        const tied = lineup.filter((e) => e.startTimeMin === chosen.startTimeMin)
        expect(tied.length).toBe(1)
      }),
      { numRuns: 200 },
    )
  })

  /**
   * Sanity check: a synthetic schedule with a known lineup slot covering
   * the full day in a fixed timezone returns the expected entry, regardless
   * of the timestamp's local minutes. This anchors the property test to a
   * concrete example so a future regression in the Intl path is obvious.
   *
   * Validates: Requirements 5.7
   */
  it('selects the latest LineupEntry whose startTimeMin ≤ local minutes (concrete example)', () => {
    const schedule: MusicSchedule = {
      businessId: 'biz-1',
      scheduleId: 'sched-1',
      timezone: 'UTC',
      slots: [
        {
          slotId: 'slot-mon-allday',
          dayOfWeek: 'MON',
          startTime: '00:00',
          endTime: '23:59',
          startTimeMin: 0,
          endTimeMin: 23 * 60 + 59,
          mode: 'lineup',
          lineup: [
            { startTime: '00:00', startTimeMin: 0, genres: ['amapiano'] },
            { startTime: '12:00', startTimeMin: 720, genres: ['deep_house'] },
            { startTime: '18:30', startTimeMin: 18 * 60 + 30, genres: ['hip_hop'] },
          ],
        },
      ],
      updatedAt: '2025-01-06T00:00:00.000Z',
      schemaVersion: 1,
    }
    // 2025-01-06 is a Monday in UTC.
    expect(resolveActiveSlot(schedule, '2025-01-06T05:00:00.000Z')?.lineupEntry?.startTime).toBe('00:00')
    expect(resolveActiveSlot(schedule, '2025-01-06T12:00:00.000Z')?.lineupEntry?.startTime).toBe('12:00')
    expect(resolveActiveSlot(schedule, '2025-01-06T18:29:00.000Z')?.lineupEntry?.startTime).toBe('12:00')
    expect(resolveActiveSlot(schedule, '2025-01-06T18:30:00.000Z')?.lineupEntry?.startTime).toBe('18:30')
    expect(resolveActiveSlot(schedule, '2025-01-06T23:58:00.000Z')?.lineupEntry?.startTime).toBe('18:30')
  })
})
