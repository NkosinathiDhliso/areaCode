/**
 * Property tests for the Live_Archetype resolver.
 *
 *  - Property 7: Live_Archetype returns exactly one catalog Archetype - for
 *    any valid `LiveArchetypeInputs`, the returned `result.archetype.id`
 *    is always one of the ids in `ARCHETYPE_CATALOG`. Each of the five
 *    resolver branches (`schedule_lineup`, `schedule_blanket`,
 *    `checkin_mode`, `default`, `eclectic_fallback`) is generated as a
 *    distinct branch arbitrary so the property exercises the full decision
 *    tree.
 *  - Property 8: Live_Archetype idempotence - two consecutive calls with
 *    the same inputs return the same `archetype.id` AND the same `branch`.
 *    The resolver is observably pure (R7.9): no `Date.now()`, no globals,
 *    no I/O - same inputs → same output.
 *
 * Validates: Requirements 7.1, 7.9, 10.6, 10.7
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

import { ARCHETYPE_CATALOG } from '../../constants/archetype-catalog'
import { MUSIC_GENRES } from '../../constants/genre-weights'
import type { MusicGenre, MusicSchedule, ScheduleDayOfWeek } from '../../types'
import { resolveLiveArchetype, type LiveArchetypeCheckIn, type LiveArchetypeInputs } from '../liveArchetype'

// ─── Constants ──────────────────────────────────────────────────────────────

/** Set of catalog archetype ids; used by the membership assertion in P7. */
const CATALOG_IDS: ReadonlySet<string> = new Set(ARCHETYPE_CATALOG.map((a) => a.id))

/** UTC `Date.getUTCDay()` index → schedule `dayOfWeek` (0 = Sunday). */
const UTC_DAY_TO_SCHEDULE: readonly ScheduleDayOfWeek[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

/** Wide window for timestamp generation; spans common DST transitions. */
const EPOCH_MIN_MS = Date.UTC(2024, 0, 1)
const EPOCH_MAX_MS = Date.UTC(2030, 11, 31, 22, 0, 0, 0)

// ─── Helpers ────────────────────────────────────────────────────────────────

const minToHhMm = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/**
 * Build a single-slot UTC Music_Schedule whose one blanket slot is active
 * at any minute of `dayOfWeek` (`[00:00, 23:59)`). With `timezone: 'UTC'`,
 * the resolver's local-minutes computation uses the same UTC parts the
 * arbitrary derived from `Date.getUTCDay()` / `getUTCHours()` so the slot
 * is guaranteed to be the Active_Slot at the generated timestamp.
 */
function makeBlanketSchedule(dayOfWeek: ScheduleDayOfWeek, genres: MusicGenre[]): MusicSchedule {
  return {
    businessId: 'biz-1',
    scheduleId: 'sched-blanket',
    timezone: 'UTC',
    slots: [
      {
        slotId: `slot-${dayOfWeek}-blanket`,
        dayOfWeek,
        startTime: '00:00',
        endTime: '23:59',
        startTimeMin: 0,
        endTimeMin: 1439,
        mode: 'blanket',
        genres,
      },
    ],
    updatedAt: '2025-01-01T00:00:00.000Z',
    schemaVersion: 1,
  }
}

/**
 * Build a single-slot UTC Music_Schedule with one lineup-mode slot active
 * at any minute of `dayOfWeek`. The lineup carries a single entry whose
 * `startTime` aligns with the slot's start (R3.7), so the resolver always
 * has exactly one LineupEntry to pick (R5.7).
 */
function makeLineupSchedule(dayOfWeek: ScheduleDayOfWeek, genres: MusicGenre[]): MusicSchedule {
  return {
    businessId: 'biz-1',
    scheduleId: 'sched-lineup',
    timezone: 'UTC',
    slots: [
      {
        slotId: `slot-${dayOfWeek}-lineup`,
        dayOfWeek,
        startTime: '00:00',
        endTime: '23:59',
        startTimeMin: 0,
        endTimeMin: 1439,
        mode: 'lineup',
        lineup: [
          {
            startTime: '00:00',
            startTimeMin: 0,
            genres,
          },
        ],
      },
    ],
    updatedAt: '2025-01-01T00:00:00.000Z',
    schemaVersion: 1,
  }
}

// ─── Shared arbitraries ─────────────────────────────────────────────────────

const distinctGenresArb: fc.Arbitrary<MusicGenre[]> = fc.uniqueArray(fc.constantFrom(...MUSIC_GENRES), {
  minLength: 1,
  maxLength: 5,
})

/** A single catalog archetype id. */
const catalogIdArb: fc.Arbitrary<string> = fc.constantFrom(...ARCHETYPE_CATALOG.map((a) => a.id))

/**
 * RFC 3339 timestamp with the local UTC parts pre-computed so each branch
 * arbitrary can build a schedule whose slot is guaranteed to be active at
 * the timestamp. We snap to the minute boundary and re-base to noon when
 * `localMin` falls in `[1438, 1440)` so a slot ending at `23:59` (the max
 * `endTimeMin` of `1439`) stays strictly above the timestamp's minute under
 * the half-open `[startTimeMin, endTimeMin)` semantics from R5.4.
 */
const localizedTimestampArb = fc.integer({ min: EPOCH_MIN_MS, max: EPOCH_MAX_MS }).map((rawMs) => {
  const minuteMs = Math.floor(rawMs / 60000) * 60000
  const d = new Date(minuteMs)
  let localMin = d.getUTCHours() * 60 + d.getUTCMinutes()
  if (localMin >= 1438) {
    // Re-base to noon - keeps the dayOfWeek stable since 12:00 UTC is
    // always on the same calendar day in UTC.
    d.setUTCHours(12, 0, 0, 0)
    localMin = 12 * 60
  }
  return {
    timestampIso: d.toISOString(),
    dayOfWeek: UTC_DAY_TO_SCHEDULE[d.getUTCDay()]!,
    localMin,
    hhMm: minToHhMm(localMin),
  }
})

// ─── Per-branch arbitraries (Property 7 coverage) ──────────────────────────

interface BranchScenario {
  inputs: LiveArchetypeInputs
  expectedBranch: 'schedule_lineup' | 'schedule_blanket' | 'checkin_mode' | 'default' | 'eclectic_fallback'
  /** Human-readable label kept for fast-check shrink output. */
  label: string
}

const lineupBranchArb: fc.Arbitrary<BranchScenario> = fc
  .tuple(localizedTimestampArb, distinctGenresArb)
  .map(([ts, genres]) => ({
    inputs: {
      node: { id: 'node-1' },
      schedule: makeLineupSchedule(ts.dayOfWeek, genres),
      recentCheckIns: [],
      timestampIso: ts.timestampIso,
    },
    expectedBranch: 'schedule_lineup',
    label: `lineup@${ts.dayOfWeek} ${ts.hhMm}`,
  }))

const blanketBranchArb: fc.Arbitrary<BranchScenario> = fc
  .tuple(localizedTimestampArb, distinctGenresArb)
  .map(([ts, genres]) => ({
    inputs: {
      node: { id: 'node-1' },
      schedule: makeBlanketSchedule(ts.dayOfWeek, genres),
      recentCheckIns: [],
      timestampIso: ts.timestampIso,
    },
    expectedBranch: 'schedule_blanket',
    label: `blanket@${ts.dayOfWeek} ${ts.hhMm}`,
  }))

const checkInArb: fc.Arbitrary<LiveArchetypeCheckIn> = catalogIdArb.map((id) => ({ archetypeId: id }))

const checkinBranchArb: fc.Arbitrary<BranchScenario> = fc
  .tuple(localizedTimestampArb, fc.array(checkInArb, { minLength: 1, maxLength: 20 }))
  .map(([ts, checkIns]) => ({
    inputs: {
      node: { id: 'node-1' },
      // No schedule → step 1/2 are skipped, fall straight into step 3.
      recentCheckIns: checkIns,
      timestampIso: ts.timestampIso,
    },
    expectedBranch: 'checkin_mode',
    label: `checkin n=${checkIns.length}`,
  }))

const defaultBranchArb: fc.Arbitrary<BranchScenario> = fc
  .tuple(localizedTimestampArb, catalogIdArb)
  .map(([ts, defaultId]) => ({
    inputs: {
      node: { id: 'node-1', defaultArchetypeId: defaultId },
      // No schedule, no check-ins → step 1/2/3 skipped, step 4 fires.
      recentCheckIns: [],
      timestampIso: ts.timestampIso,
    },
    expectedBranch: 'default',
    label: `default ${defaultId}`,
  }))

const eclecticBranchArb: fc.Arbitrary<BranchScenario> = localizedTimestampArb.map((ts) => ({
  inputs: {
    // No `defaultArchetypeId` on the node, no schedule, no check-ins →
    // every prior branch is skipped, eclectic fallback fires (R7.8).
    node: { id: 'node-1' },
    recentCheckIns: [],
    timestampIso: ts.timestampIso,
  },
  expectedBranch: 'eclectic_fallback',
  label: `eclectic`,
}))

const anyBranchArb: fc.Arbitrary<BranchScenario> = fc.oneof(
  lineupBranchArb,
  blanketBranchArb,
  checkinBranchArb,
  defaultBranchArb,
  eclecticBranchArb,
)

// ─── Property 7: returns exactly one catalog Archetype ─────────────────────

describe('Property 7: Live_Archetype returns exactly one catalog Archetype', () => {
  /**
   * Across all five branches, the returned archetype `id` is present in
   * `ARCHETYPE_CATALOG` and the resolver returns a single result (not null,
   * not an array). The branch label on the result also matches the branch
   * the input was constructed to exercise - this is the "exactly one"
   * half: a single deterministic branch fires per input.
   *
   * Validates: Requirements 7.1, 10.6
   */
  it('returns a catalog archetype id and the expected branch for every branch', () => {
    fc.assert(
      fc.property(anyBranchArb, ({ inputs, expectedBranch }) => {
        const result = resolveLiveArchetype(inputs)
        expect(result).toBeDefined()
        expect(result.archetype).toBeDefined()
        expect(typeof result.archetype.id).toBe('string')
        expect(CATALOG_IDS.has(result.archetype.id)).toBe(true)
        expect(result.branch).toBe(expectedBranch)
      }),
      { numRuns: 200 },
    )
  })

  /**
   * Per-branch sanity: every branch arbitrary fires its named branch at
   * least sometimes. Without this, a regression that silently collapsed
   * (say) `checkin_mode` into `eclectic_fallback` would still pass the
   * across-the-board membership check above, because `archetype-eclectic`
   * is also in the catalog. The per-branch arbs already assert
   * `result.branch === expectedBranch`, so we just exercise each one
   * with a small numRuns to keep coverage explicit.
   *
   * Validates: Requirements 7.1, 10.6
   */
  it('exercises each branch and returns a catalog archetype id', () => {
    const cases: Array<[string, fc.Arbitrary<BranchScenario>]> = [
      ['schedule_lineup', lineupBranchArb],
      ['schedule_blanket', blanketBranchArb],
      ['checkin_mode', checkinBranchArb],
      ['default', defaultBranchArb],
      ['eclectic_fallback', eclecticBranchArb],
    ]
    for (const [name, arb] of cases) {
      fc.assert(
        fc.property(arb, ({ inputs, expectedBranch }) => {
          const result = resolveLiveArchetype(inputs)
          expect(result.branch, `branch for ${name}`).toBe(expectedBranch)
          expect(CATALOG_IDS.has(result.archetype.id), `${name} returned non-catalog id ${result.archetype.id}`).toBe(
            true,
          )
        }),
        { numRuns: 50 },
      )
    }
  })
})

// ─── Property 8: idempotence ───────────────────────────────────────────────

describe('Property 8: Live_Archetype idempotence', () => {
  /**
   * Two consecutive calls with the same inputs return the same
   * `archetype.id` and the same `branch`. The resolver is observably pure
   * (R7.9): no `Date.now()`, no globals, no I/O. We compare on `(id, branch)`
   * rather than the full archetype object so a future, additive change to
   * the catalog entry shape (e.g. extra metadata) does not flag a
   * false-positive non-determinism - the id+branch tuple is what the
   * caller actually emits over `node:archetype_change` (R11.2).
   *
   * Validates: Requirements 7.9, 10.7
   */
  it('two consecutive calls return the same archetype id and branch', () => {
    fc.assert(
      fc.property(anyBranchArb, ({ inputs }) => {
        const first = resolveLiveArchetype(inputs)
        const second = resolveLiveArchetype(inputs)
        expect(second.archetype.id).toBe(first.archetype.id)
        expect(second.branch).toBe(first.branch)
      }),
      { numRuns: 200 },
    )
  })

  /**
   * Stronger form: the full result is structurally equal across calls.
   * R7.9 mandates observable purity - same inputs → same output under
   * deep equality. If a regression introduced a hidden mutable cache or
   * `Math.random()` tie-break, this would catch it where the
   * id+branch-only check could not.
   *
   * Validates: Requirements 7.9, 10.7
   */
  it('two consecutive calls are deeply equal', () => {
    fc.assert(
      fc.property(anyBranchArb, ({ inputs }) => {
        const first = resolveLiveArchetype(inputs)
        const second = resolveLiveArchetype(inputs)
        expect(second).toEqual(first)
      }),
      { numRuns: 200 },
    )
  })
})
