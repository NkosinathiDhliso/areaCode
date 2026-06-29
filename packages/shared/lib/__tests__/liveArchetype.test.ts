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
import type { LiveArchetypeBranch, MusicGenre, MusicSchedule, ScheduleDayOfWeek } from '../../types'
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

// ════════════════════════════════════════════════════════════════════════════
// live-vibe-declaration: presence-is-truth (flag-on) properties P1-P5
//
// These exercise the extended resolver path where `presenceFloor` is DEFINED
// (the flag-on path, design "The precedence flip"). The flag-off path
// (`presenceFloor === undefined`) is covered by Properties 7 / 8 above and the
// dedicated regression lock P6 (task 2.2).
//
// effectiveFloor = previousBranch === 'crowd_live'
//   ? presenceFloor - (presenceGrace ?? 0)   // downward grace only (R3.1, R3.2)
//   : presenceFloor
// ════════════════════════════════════════════════════════════════════════════

// ─── Flag-on shared arbitraries ─────────────────────────────────────────────

/** A check-in whose archetypeId is NOT in the catalog (or is null/absent). */
const nonCatalogCheckInArb: fc.Arbitrary<LiveArchetypeCheckIn> = fc.constantFrom<LiveArchetypeCheckIn[]>(
  { archetypeId: null },
  { archetypeId: undefined },
  { archetypeId: '' },
  { archetypeId: 'not-a-catalog-archetype' },
)

/** A check-in that may or may not carry a catalog archetypeId. */
const mixedCheckInArb: fc.Arbitrary<LiveArchetypeCheckIn> = fc.oneof(checkInArb, nonCatalogCheckInArb)

/** Any prior Resolution_Branch, including `crowd_live` (the only one that engages grace) and `null`. */
const previousBranchArb: fc.Arbitrary<LiveArchetypeBranch | null> = fc.constantFrom<(LiveArchetypeBranch | null)[]>(
  'crowd_live',
  'declared_promise',
  'checkin_mode',
  'default',
  'eclectic_fallback',
  'schedule_lineup',
  'schedule_blanket',
  null,
)

/** True iff at least one check-in carries an archetypeId present in the catalog. */
const hasCatalogMode = (checkIns: LiveArchetypeCheckIn[]): boolean =>
  checkIns.some((ci) => typeof ci.archetypeId === 'string' && CATALOG_IDS.has(ci.archetypeId))

/** Schedule presence: sometimes absent, sometimes a blanket or lineup Active_Slot. */
type ScheduleKind = 'none' | 'blanket' | 'lineup'
const scheduleKindArb: fc.Arbitrary<ScheduleKind> = fc.constantFrom('none', 'blanket', 'lineup')

const buildSchedule = (
  kind: ScheduleKind,
  dayOfWeek: ScheduleDayOfWeek,
  genres: MusicGenre[],
): MusicSchedule | undefined =>
  kind === 'blanket'
    ? makeBlanketSchedule(dayOfWeek, genres)
    : kind === 'lineup'
      ? makeLineupSchedule(dayOfWeek, genres)
      : undefined

interface FlagOnScenario {
  inputs: LiveArchetypeInputs
  /** Floor after applying the downward-only grace (the threshold the resolver actually compares against). */
  effectiveFloor: number
  /** Whether the generated check-ins yield a qualifying Crowd_Vibe (≥1 catalog archetypeId). */
  hasQualifyingCrowd: boolean
  label: string
}

/**
 * General flag-on generator. `presenceFloor` is always defined (small positive
 * int); `presenceGrace` spans 0..floor; `qualifyingPresenceCount` spans below,
 * at, and above the floor; schedules are sometimes present; check-ins are a
 * mix of catalog and non-catalog ids; `previousBranch` is any branch or null.
 * Determinism: a fixed timestamp is passed in `timestampIso` (no Date.now()).
 */
const flagOnScenarioArb: fc.Arbitrary<FlagOnScenario> = fc
  .record({
    ts: localizedTimestampArb,
    floor: fc.integer({ min: 1, max: 6 }),
    graceRaw: fc.integer({ min: 0, max: 6 }),
    count: fc.integer({ min: 0, max: 12 }),
    scheduleKind: scheduleKindArb,
    genres: distinctGenresArb,
    checkIns: fc.array(mixedCheckInArb, { maxLength: 20 }),
    previousBranch: previousBranchArb,
  })
  .map(({ ts, floor, graceRaw, count, scheduleKind, genres, checkIns, previousBranch }) => {
    const presenceGrace = Math.min(graceRaw, floor) // grace in 0..floor
    const inputs: LiveArchetypeInputs = {
      node: { id: 'node-1' },
      schedule: buildSchedule(scheduleKind, ts.dayOfWeek, genres),
      recentCheckIns: checkIns,
      timestampIso: ts.timestampIso,
      presenceFloor: floor,
      presenceGrace,
      qualifyingPresenceCount: count,
      previousBranch,
    }
    const effectiveFloor = previousBranch === 'crowd_live' ? floor - presenceGrace : floor
    return {
      inputs,
      effectiveFloor,
      hasQualifyingCrowd: hasCatalogMode(checkIns),
      label: `floor=${floor} grace=${presenceGrace} count=${count} prev=${String(previousBranch)} sched=${scheduleKind} crowd=${hasCatalogMode(checkIns)}`,
    }
  })

// ─── Property 1: flag-on resolver returns exactly one catalog Archetype ──────

describe('Property 1: flag-on resolver returns one active-catalog archetype', () => {
  /**
   * For any generated `qualifyingPresenceCount` and `presenceFloor` (with the
   * presence gate engaged), the resolver returns exactly one archetype whose
   * `id` is in `ARCHETYPE_CATALOG`.
   *
   * Validates: Requirements 12.1
   */
  it('returns a catalog archetype id for any presenceFloor / qualifyingPresenceCount', () => {
    fc.assert(
      fc.property(flagOnScenarioArb, ({ inputs }) => {
        const result = resolveLiveArchetype(inputs)
        expect(result).toBeDefined()
        expect(result.archetype).toBeDefined()
        expect(typeof result.archetype.id).toBe('string')
        expect(CATALOG_IDS.has(result.archetype.id)).toBe(true)
      }),
      { numRuns: 300 },
    )
  })
})

// ─── Property 2: flag-on idempotence ─────────────────────────────────────────

describe('Property 2: flag-on idempotence', () => {
  /**
   * Two consecutive calls with identical flag-on inputs return the same
   * archetype `id` and the same `branch`. The presence gate adds no hidden
   * state - the resolver stays observably pure (R4.1).
   *
   * Validates: Requirements 12.2, 4.1
   */
  it('two consecutive calls return the same archetype id and branch', () => {
    fc.assert(
      fc.property(flagOnScenarioArb, ({ inputs }) => {
        const first = resolveLiveArchetype(inputs)
        const second = resolveLiveArchetype(inputs)
        expect(second.archetype.id).toBe(first.archetype.id)
        expect(second.branch).toBe(first.branch)
      }),
      { numRuns: 300 },
    )
  })
})

// ─── Property 3: no crowd_live below the effective floor ─────────────────────

describe('Property 3: never crowd_live below the effective floor', () => {
  /**
   * Whenever `qualifyingPresenceCount < effectiveFloor` (accounting for the
   * downward grace), the branch is never `crowd_live`. The room is not proven,
   * so the glyph can only be a `declared_promise` or the default/eclectic tail.
   *
   * Validates: Requirements 1.1, 12.3
   */
  it('never returns crowd_live when count < effectiveFloor', () => {
    fc.assert(
      fc.property(flagOnScenarioArb, ({ inputs, effectiveFloor }) => {
        fc.pre((inputs.qualifyingPresenceCount ?? 0) < effectiveFloor)
        const result = resolveLiveArchetype(inputs)
        expect(result.branch).not.toBe('crowd_live')
      }),
      { numRuns: 400 },
    )
  })
})

// ─── Property 4: no declared_promise at/above the floor with a real crowd ────

/**
 * Generator guaranteeing both (a) `count >= effectiveFloor` and (b) at least
 * one catalog check-in (a qualifying Crowd_Vibe exists). Used by P4 so the
 * precondition is structurally satisfied rather than filtered.
 */
const qualifyingCrowdAtOrAboveFloorArb: fc.Arbitrary<FlagOnScenario> = fc
  .record({
    ts: localizedTimestampArb,
    floor: fc.integer({ min: 1, max: 6 }),
    graceRaw: fc.integer({ min: 0, max: 6 }),
    extra: fc.integer({ min: 0, max: 8 }),
    scheduleKind: scheduleKindArb,
    genres: distinctGenresArb,
    guaranteedId: catalogIdArb,
    rest: fc.array(mixedCheckInArb, { maxLength: 19 }),
    previousBranch: previousBranchArb,
  })
  .map(({ ts, floor, graceRaw, extra, scheduleKind, genres, guaranteedId, rest, previousBranch }) => {
    const presenceGrace = Math.min(graceRaw, floor)
    const effectiveFloor = previousBranch === 'crowd_live' ? floor - presenceGrace : floor
    const count = effectiveFloor + extra // guaranteed >= effectiveFloor (effectiveFloor >= 0)
    const checkIns: LiveArchetypeCheckIn[] = [{ archetypeId: guaranteedId }, ...rest]
    const inputs: LiveArchetypeInputs = {
      node: { id: 'node-1' },
      schedule: buildSchedule(scheduleKind, ts.dayOfWeek, genres),
      recentCheckIns: checkIns,
      timestampIso: ts.timestampIso,
      presenceFloor: floor,
      presenceGrace,
      qualifyingPresenceCount: count,
      previousBranch,
    }
    return {
      inputs,
      effectiveFloor,
      hasQualifyingCrowd: true,
      label: `floor=${floor} grace=${presenceGrace} count=${count} prev=${String(previousBranch)} sched=${scheduleKind}`,
    }
  })

describe('Property 4: never declared_promise at/above floor with a qualifying crowd', () => {
  /**
   * Whenever `qualifyingPresenceCount >= effectiveFloor` AND the check-ins
   * carry at least one catalog archetypeId (a qualifying Crowd_Vibe exists),
   * the branch is never `declared_promise` - the real crowd wins outright,
   * even when an Active_Slot declaration is present.
   *
   * Validates: Requirements 2.1, 12.4
   */
  it('never returns declared_promise when count >= effectiveFloor and a crowd mode exists', () => {
    fc.assert(
      fc.property(qualifyingCrowdAtOrAboveFloorArb, ({ inputs }) => {
        const result = resolveLiveArchetype(inputs)
        expect(result.branch).not.toBe('declared_promise')
      }),
      { numRuns: 400 },
    )
  })
})

// ─── Property 5: presence-grace prevents oscillation ─────────────────────────

/**
 * Generator pinning `previousBranch === 'crowd_live'` and holding the count
 * strictly inside the grace band `[presenceFloor - presenceGrace, presenceFloor)`,
 * with a guaranteed qualifying crowd. `presenceGrace >= 1` so the band is
 * non-empty.
 */
const graceBandHoldArb: fc.Arbitrary<FlagOnScenario> = fc
  .record({
    ts: localizedTimestampArb,
    floor: fc.integer({ min: 1, max: 6 }),
    scheduleKind: scheduleKindArb,
    genres: distinctGenresArb,
    guaranteedId: catalogIdArb,
    rest: fc.array(mixedCheckInArb, { maxLength: 19 }),
  })
  .chain((base) =>
    fc.integer({ min: 1, max: base.floor }).chain((grace) =>
      // count in [floor - grace, floor - 1]: strictly inside the grace band.
      fc.integer({ min: base.floor - grace, max: base.floor - 1 }).map((count) => {
        const checkIns: LiveArchetypeCheckIn[] = [{ archetypeId: base.guaranteedId }, ...base.rest]
        const inputs: LiveArchetypeInputs = {
          node: { id: 'node-1' },
          schedule: buildSchedule(base.scheduleKind, base.ts.dayOfWeek, base.genres),
          recentCheckIns: checkIns,
          timestampIso: base.ts.timestampIso,
          presenceFloor: base.floor,
          presenceGrace: grace,
          qualifyingPresenceCount: count,
          previousBranch: 'crowd_live',
        }
        return {
          inputs,
          effectiveFloor: base.floor - grace,
          hasQualifyingCrowd: true,
          label: `floor=${base.floor} grace=${grace} count=${count} band=[${base.floor - grace},${base.floor})`,
        }
      }),
    ),
  )

describe('Property 5: presence-grace holds crowd_live within the grace band', () => {
  /**
   * When `previousBranch === 'crowd_live'` and the count is held within
   * `[presenceFloor - presenceGrace, presenceFloor)` (below the raw floor but
   * inside the grace band), the branch stays `crowd_live` - it does not flip
   * back to `declared_promise` or the default tail. This is the no-oscillation
   * guarantee, given a qualifying crowd mode exists.
   *
   * Validates: Requirements 3.1, 3.3, 12.5
   */
  it('stays crowd_live when count is held inside the grace band', () => {
    fc.assert(
      fc.property(graceBandHoldArb, ({ inputs }) => {
        // Precondition sanity: we really are below the raw floor.
        fc.pre((inputs.qualifyingPresenceCount ?? 0) < (inputs.presenceFloor ?? 0))
        const result = resolveLiveArchetype(inputs)
        expect(result.branch).toBe('crowd_live')
      }),
      { numRuns: 300 },
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
// live-vibe-declaration: P6 (flag-off regression lock) and P7 (glyph-identity)
//
// P6 locks the flag-off path (`presenceFloor === undefined`) to the pre-feature
// resolver: the legacy branch set is preserved (never `crowd_live` /
// `declared_promise`), and passing the presence fields explicitly as
// `undefined` is byte-for-byte identical to omitting them. P7 is a structural
// invariant over both flag-on and flag-off outputs: the result is exactly
// `{ archetype, branch }` and the archetype carries no beam brightness / height
// / animation (visual) field - glyph identity only (constellation-mode keeps
// beam visuals a function of pulse alone).
// ════════════════════════════════════════════════════════════════════════════

/** The five pre-feature (legacy) Resolution_Branch values. */
const LEGACY_BRANCHES: ReadonlySet<LiveArchetypeBranch> = new Set<LiveArchetypeBranch>([
  'schedule_lineup',
  'schedule_blanket',
  'checkin_mode',
  'default',
  'eclectic_fallback',
])

/** Branches introduced by live-vibe-declaration - must never appear on the flag-off path. */
const FEATURE_BRANCHES: ReadonlySet<LiveArchetypeBranch> = new Set<LiveArchetypeBranch>([
  'crowd_live',
  'declared_promise',
])

/**
 * Beam / aliveness visual keys that the glyph-identity resolver must never
 * read or write (constellation-mode: beam brightness, height, and animation
 * speed are a function of pulse only, R4.3). The structural assertion in P7
 * fails if any of these surface on the result or its archetype.
 */
const FORBIDDEN_VISUAL_KEYS: readonly string[] = [
  'brightness',
  'beamBrightness',
  'height',
  'beamHeight',
  'animation',
  'animationSpeed',
  'beamAnimationSpeed',
  'pulse',
  'pulseScore',
  'pulseState',
  'beam',
  'glow',
  'opacity',
]

// ─── Property 6: flag-off regression lock ────────────────────────────────────

describe('Property 6: flag-off path is locked to the pre-feature resolver', () => {
  /**
   * For any legacy scenario (no presence fields set), the resolver returns a
   * branch from the pre-feature set and NEVER one of the feature branches
   * (`crowd_live` / `declared_promise`). This characterises the flag-off path
   * directly: with `presenceFloor` absent, the presence-is-truth gate is dead
   * code and the original precedence runs verbatim.
   *
   * Validates: Requirements 10.3
   */
  it('returns only legacy branches and never a feature branch', () => {
    fc.assert(
      fc.property(anyBranchArb, ({ inputs }) => {
        const result = resolveLiveArchetype(inputs)
        expect(LEGACY_BRANCHES.has(result.branch)).toBe(true)
        expect(FEATURE_BRANCHES.has(result.branch)).toBe(false)
      }),
      { numRuns: 300 },
    )
  })

  /**
   * Passing the presence-gate fields explicitly as `undefined` is identical to
   * omitting them entirely: deep equality of the full result. This proves the
   * flag-off contract is keyed on `presenceFloor === undefined` and not on the
   * mere absence of the property, so a caller that always spreads `undefined`
   * presence inputs (the flag-off code path in the evaluator) gets byte-for-byte
   * the pre-feature behaviour.
   *
   * Validates: Requirements 10.3
   */
  it('explicit-undefined presence fields are deeply equal to omitting them', () => {
    fc.assert(
      fc.property(anyBranchArb, ({ inputs }) => {
        const omitted = resolveLiveArchetype(inputs)
        const explicitUndefined = resolveLiveArchetype({
          ...inputs,
          presenceFloor: undefined,
          presenceGrace: undefined,
          qualifyingPresenceCount: undefined,
          previousBranch: undefined,
        })
        expect(explicitUndefined).toEqual(omitted)
      }),
      { numRuns: 300 },
    )
  })
})

// ─── Property 7: glyph-identity only (no beam / visual fields) ───────────────

/** Inputs from both the flag-off (legacy) and flag-on (presence-gate) spaces. */
const anyScenarioInputsArb: fc.Arbitrary<LiveArchetypeInputs> = fc.oneof(
  anyBranchArb.map((s) => s.inputs),
  flagOnScenarioArb.map((s) => s.inputs),
)

describe('Property 7: resolver result is glyph identity only', () => {
  /**
   * For any resolution outcome (flag-on or flag-off), the result object shape
   * is exactly `{ archetype, branch }` and the archetype is a catalog
   * PersonalityArchetype carrying no beam brightness / height / animation
   * (visual) key. The resolver decides glyph identity only; beam visuals stay
   * a function of pulse per constellation-mode (R4.3).
   *
   * Validates: Requirements 4.3
   */
  it('returns exactly { archetype, branch } with no beam/visual fields', () => {
    fc.assert(
      fc.property(anyScenarioInputsArb, (inputs) => {
        const result = resolveLiveArchetype(inputs)

        // Result shape is exactly the identity pair.
        expect(Object.keys(result).sort()).toEqual(['archetype', 'branch'])
        expect(typeof result.branch).toBe('string')

        // Archetype is a catalog entry by id.
        expect(CATALOG_IDS.has(result.archetype.id)).toBe(true)

        // No forbidden visual key on the result or the archetype.
        const resultKeys = Object.keys(result).map((k) => k.toLowerCase())
        const archetypeKeys = Object.keys(result.archetype).map((k) => k.toLowerCase())
        for (const forbidden of FORBIDDEN_VISUAL_KEYS) {
          const f = forbidden.toLowerCase()
          expect(resultKeys).not.toContain(f)
          expect(archetypeKeys).not.toContain(f)
        }
      }),
      { numRuns: 400 },
    )
  })
})
