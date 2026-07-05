/**
 * Unit tests for the live-archetype-evaluator Lambda — the I/O boundary that
 * wraps the pure `resolveLiveArchetype` (live-vibe-declaration task 4.2).
 *
 * Validates the flag-gated presence-is-truth wiring (task 4.1):
 *   - When `live_vibe_declaration` is ON, the honest present count
 *     (`readHonestPresenceCount` → `getCounter`) is passed through to the
 *     resolver: a count ≥ Presence_Floor (3) with a qualifying recent
 *     check-in yields the `crowd_live` branch; below the floor with an
 *     Active_Slot yields `declared_promise` (R2.4).
 *   - When `live_vibe_declaration` is OFF, the presence read is NEVER
 *     performed (`getCounter` receives zero calls) and the resolver runs the
 *     legacy live-vibe-on-map precedence (the schedule declaration wins)
 *     (R10.3 / R9.3 read budget).
 *   - Emission only on archetype change, carrying `{ nodeId, liveArchetypeId,
 *     branch }`, reusing the existing coalescing (R4.2).
 *   - `writeLastArchetype` persists BOTH `lastArchetypeId` and `lastBranch`
 *     on change (R3.1, R3.3).
 *   - Bounded reads per tick: schedule GetItem + check-ins Query +
 *     node-fields GetItem, plus the single presence read only when the flag
 *     is on (R9.3).
 *   - Failure paths: `getCounter` rejecting / timing out yields count 0 and
 *     never throws — falls back to the declared promise / default (R7.x).
 *
 * Strategy:
 *   The real pure resolver runs (no mock) so the branch decision is exercised
 *   end to end. Only the I/O boundary is stubbed:
 *     - `documentClient.send` is duck-typed by command shape to serve the
 *       schedule GetItem, the check-ins Query, the node-fields GetItem, and
 *       to capture the UpdateCommand that persists the cache.
 *     - `getCounter` (presence-integrity read path) is mocked directly so the
 *       presence-read call count is observable for the read-budget and
 *       flag-off assertions.
 *     - `emitArchetypeChange` / `countRoomConnections` are stubbed so emission and the
 *       subscriber check are observable.
 *   The feature flags are driven through the real `setFeatureFlagOverride`
 *   test seam (the module's dedicated override mechanism) so the genuine
 *   fallback semantics are preserved. `live_vibe_on_map` is held ON in every
 *   case (the evaluator short-circuits on it first).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setFeatureFlagOverride, clearFeatureFlagOverrides } from '@area-code/shared/lib/featureGating'

// ─── Module mocks (hoisted so the factory spies are defined first) ───────────

const mocks = vi.hoisted(() => {
  // Captured command inputs, classified by the duck-typed `send` below.
  const reads: Array<Record<string, unknown>> = []
  const updates: Array<Record<string, unknown>> = []

  // Per-case fixtures, reset in beforeEach.
  const state: {
    scheduleItem: Record<string, unknown> | null
    checkinItems: Array<{ archetypeId?: string | null }>
    nodeItem: Record<string, unknown> | null
  } = {
    scheduleItem: null,
    checkinItems: [],
    nodeItem: null,
  }

  const sendMock = vi.fn(async (cmd: unknown) => {
    const input = ((cmd as { input?: Record<string, unknown> })?.input ?? {}) as Record<string, unknown>

    // UpdateCommand (cache write) — not a read.
    if ('UpdateExpression' in input) {
      updates.push(input)
      return { Attributes: {} }
    }

    // QueryCommand against the CheckIns NodeIndex GSI — one read.
    if ('IndexName' in input) {
      reads.push(input)
      return { Items: state.checkinItems }
    }

    // GetCommand — one read. Disambiguate schedule vs node by the Key shape.
    if ('Key' in input) {
      reads.push(input)
      const key = input['Key'] as { pk?: string; nodeId?: string }
      if (typeof key?.pk === 'string' && key.pk.startsWith('BUSINESS#')) {
        return state.scheduleItem ? { Item: state.scheduleItem } : {}
      }
      return state.nodeItem ? { Item: state.nodeItem } : {}
    }

    return {}
  })

  // Presence-integrity read path (the honest present count).
  const getCounter = vi.fn(async (_nodeId: string) => 0)

  // Realtime fan-out stubs: emitArchetypeChange and the room-count read.
  // 1 subscriber by default so the emit path is exercised.
  const emitMock = vi.fn(async () => 1)
  const countConnectionsMock = vi.fn(async () => 1)

  return { reads, updates, state, sendMock, getCounter, emitMock, countConnectionsMock }
})

vi.mock('../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.sendMock },
  TableNames: {
    musicSchedules: 'music-schedules',
    nodes: 'nodes',
    checkins: 'checkins',
    appData: 'app-data',
  },
}))

vi.mock('../../features/presence/repository.js', () => ({
  getCounter: mocks.getCounter,
}))

vi.mock('../../shared/socket/events.js', () => ({
  emitArchetypeChange: mocks.emitMock,
}))

vi.mock('../../shared/websocket/broadcast.js', () => ({
  countRoomConnections: mocks.countConnectionsMock,
}))

// Import AFTER mocks so the module-level singletons pick up the stubs.
import { evaluateLiveArchetype, __resetLastEmitForTests } from '../live-archetype-evaluator'
import type { EvaluationTickEvent } from '../live-archetype-evaluator'
import type { LiveArchetypeBranch } from '@area-code/shared/types'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NODE_ID = 'node-1'
const CITY_SLUG = 'johannesburg'

/** 2025-01-01 is a Wednesday; 12:00 UTC sits inside a 00:00–23:59 WED slot. */
const TIMESTAMP_ISO = '2025-01-01T12:00:00.000Z'

const CATALOG_ARCHETYPE = 'archetype-festival-spirit'

/** A blanket Active_Slot covering all of Wednesday in UTC, declaring a valid
 *  catalog genre so the schedule branch resolves to a catalog archetype. */
function makeActiveScheduleItem(): Record<string, unknown> {
  return {
    businessId: 'biz-1',
    scheduleId: 'sched-1',
    timezone: 'UTC',
    slots: [
      {
        slotId: 'slot-wed-blanket',
        dayOfWeek: 'WED',
        startTime: '00:00',
        endTime: '23:59',
        startTimeMin: 0,
        endTimeMin: 1439,
        mode: 'blanket',
        genres: ['amapiano'],
      },
    ],
    updatedAt: '2025-01-01T00:00:00.000Z',
  }
}

function makeEvent(): EvaluationTickEvent {
  return {
    businessId: 'biz-1',
    scheduleId: 'sched-1',
    nodeId: NODE_ID,
    citySlug: CITY_SLUG,
    timestampIso: TIMESTAMP_ISO,
  }
}

/** Count of data-plane reads (GetItem + Query) issued through documentClient. */
function dynamoReadCount(): number {
  return mocks.reads.length
}

beforeEach(() => {
  clearFeatureFlagOverrides()
  __resetLastEmitForTests()
  mocks.reads.length = 0
  mocks.updates.length = 0
  mocks.state.scheduleItem = null
  mocks.state.checkinItems = []
  mocks.state.nodeItem = null
  mocks.sendMock.mockClear()
  mocks.getCounter.mockReset()
  mocks.getCounter.mockResolvedValue(0)
  mocks.emitMock.mockClear()
  mocks.emitMock.mockResolvedValue(1)
  mocks.countConnectionsMock.mockClear()
  mocks.countConnectionsMock.mockResolvedValue(1)

  // The evaluator short-circuits on `live_vibe_on_map` first — keep it ON for
  // every case.
  setFeatureFlagOverride('live_vibe_on_map', true)
})

afterEach(() => {
  clearFeatureFlagOverrides()
})

// ─── Flag ON: presence read maps to the resolver input ───────────────────────

describe('live_vibe_declaration ON: honest present count gates the branch (R2.4)', () => {
  it('count >= Presence_Floor with a qualifying crowd yields crowd_live', async () => {
    setFeatureFlagOverride('live_vibe_declaration', true)
    // Honest present count above the floor (3).
    mocks.getCounter.mockResolvedValue(5)
    // Recent check-ins carry a catalog archetypeId → a qualifying Crowd_Vibe.
    mocks.state.checkinItems = [
      { archetypeId: CATALOG_ARCHETYPE },
      { archetypeId: CATALOG_ARCHETYPE },
      { archetypeId: CATALOG_ARCHETYPE },
    ]
    // An Active_Slot is also present — the real crowd must beat it.
    mocks.state.scheduleItem = makeActiveScheduleItem()
    mocks.state.nodeItem = { lastArchetypeId: 'archetype-old', lastBranch: 'declared_promise' }

    const outcome = await evaluateLiveArchetype(makeEvent())

    expect(mocks.getCounter).toHaveBeenCalledTimes(1)
    expect(mocks.getCounter).toHaveBeenCalledWith(NODE_ID)
    expect(outcome.branch).toBe('crowd_live')
    expect(outcome.archetypeId).toBe(CATALOG_ARCHETYPE)
  })

  it('count below Presence_Floor with an Active_Slot yields declared_promise', async () => {
    setFeatureFlagOverride('live_vibe_declaration', true)
    // Below the floor (3): the room is not proven.
    mocks.getCounter.mockResolvedValue(1)
    mocks.state.checkinItems = [{ archetypeId: CATALOG_ARCHETYPE }]
    mocks.state.scheduleItem = makeActiveScheduleItem()
    mocks.state.nodeItem = { lastArchetypeId: 'archetype-old', lastBranch: null }

    const outcome = await evaluateLiveArchetype(makeEvent())

    expect(mocks.getCounter).toHaveBeenCalledTimes(1)
    expect(outcome.branch).toBe('declared_promise')
  })
})

// ─── Flag OFF: presence read skipped, legacy precedence runs ─────────────────

describe('live_vibe_declaration OFF: presence read skipped, schedule wins (R10.3, R9.3)', () => {
  it('never calls getCounter and the declaration beats the crowd', async () => {
    // Flag left OFF (default). Provide BOTH an Active_Slot and a strong crowd:
    // under the legacy precedence the schedule declaration wins outright.
    mocks.state.scheduleItem = makeActiveScheduleItem()
    mocks.state.checkinItems = [
      { archetypeId: CATALOG_ARCHETYPE },
      { archetypeId: CATALOG_ARCHETYPE },
      { archetypeId: CATALOG_ARCHETYPE },
      { archetypeId: CATALOG_ARCHETYPE },
    ]
    mocks.state.nodeItem = { lastArchetypeId: 'archetype-old', lastBranch: null }

    const outcome = await evaluateLiveArchetype(makeEvent())

    // R9.3 read budget: the presence GetItem is NOT paid when the flag is off.
    expect(mocks.getCounter).toHaveBeenCalledTimes(0)
    // Legacy precedence: the schedule branch wins, never a feature branch.
    expect(outcome.branch).toBe('schedule_blanket')
    expect(outcome.branch).not.toBe('crowd_live')
    expect(outcome.branch).not.toBe('declared_promise')
  })
})

// ─── Emission only on archetype change ───────────────────────────────────────

describe('emission only on archetype change, payload shape (R4.2)', () => {
  it('does NOT emit when the resolved archetype equals the cached lastArchetypeId', async () => {
    setFeatureFlagOverride('live_vibe_declaration', true)
    mocks.getCounter.mockResolvedValue(5)
    mocks.state.checkinItems = [
      { archetypeId: CATALOG_ARCHETYPE },
      { archetypeId: CATALOG_ARCHETYPE },
      { archetypeId: CATALOG_ARCHETYPE },
    ]
    // Cache already holds the value the resolver will produce → no change.
    mocks.state.nodeItem = { lastArchetypeId: CATALOG_ARCHETYPE, lastBranch: 'crowd_live' }

    const outcome = await evaluateLiveArchetype(makeEvent())

    expect(outcome.changed).toBe(false)
    expect(outcome.emitted).toBe(false)
    expect(mocks.emitMock).not.toHaveBeenCalled()
    // No change → no cache write.
    expect(mocks.updates.length).toBe(0)
  })

  it('emits exactly one node:archetype_change carrying { nodeId, liveArchetypeId, branch } on change', async () => {
    setFeatureFlagOverride('live_vibe_declaration', true)
    mocks.getCounter.mockResolvedValue(5)
    mocks.state.checkinItems = [
      { archetypeId: CATALOG_ARCHETYPE },
      { archetypeId: CATALOG_ARCHETYPE },
      { archetypeId: CATALOG_ARCHETYPE },
    ]
    // Cache differs → change, and a subscriber exists.
    mocks.state.nodeItem = { lastArchetypeId: 'archetype-old', lastBranch: 'declared_promise' }

    const outcome = await evaluateLiveArchetype(makeEvent())

    expect(outcome.changed).toBe(true)
    expect(outcome.emitted).toBe(true)
    expect(mocks.emitMock).toHaveBeenCalledTimes(1)
    expect(mocks.emitMock).toHaveBeenCalledWith(CITY_SLUG, {
      nodeId: NODE_ID,
      liveArchetypeId: CATALOG_ARCHETYPE,
      branch: 'crowd_live',
    })
  })
})

// ─── writeLastArchetype persists lastArchetypeId AND lastBranch ──────────────

describe('writeLastArchetype persists both lastArchetypeId and lastBranch (R3.1, R3.3)', () => {
  it('captures an UpdateCommand setting :a (archetypeId) and :b (branch) on change', async () => {
    setFeatureFlagOverride('live_vibe_declaration', true)
    mocks.getCounter.mockResolvedValue(5)
    mocks.state.checkinItems = [
      { archetypeId: CATALOG_ARCHETYPE },
      { archetypeId: CATALOG_ARCHETYPE },
      { archetypeId: CATALOG_ARCHETYPE },
    ]
    mocks.state.nodeItem = { lastArchetypeId: 'archetype-old', lastBranch: null }

    await evaluateLiveArchetype(makeEvent())

    expect(mocks.updates.length).toBe(1)
    const update = mocks.updates[0]!
    expect(String(update['UpdateExpression'])).toContain('lastArchetypeId = :a')
    expect(String(update['UpdateExpression'])).toContain('lastBranch = :b')
    const values = update['ExpressionAttributeValues'] as Record<string, unknown>
    expect(values[':a']).toBe(CATALOG_ARCHETYPE)
    expect(values[':b']).toBe('crowd_live')
  })
})

// ─── Bounded reads per tick (R9.3) ───────────────────────────────────────────

describe('bounded read budget per Evaluation_Tick (R9.3)', () => {
  it('flag ON: schedule GetItem + check-ins Query + node-fields GetItem (3) + one presence read', async () => {
    setFeatureFlagOverride('live_vibe_declaration', true)
    mocks.getCounter.mockResolvedValue(5)
    mocks.state.checkinItems = [{ archetypeId: CATALOG_ARCHETYPE }]
    mocks.state.scheduleItem = makeActiveScheduleItem()
    mocks.state.nodeItem = { lastArchetypeId: 'archetype-old', lastBranch: null }

    await evaluateLiveArchetype(makeEvent())

    // Exactly three DynamoDB data-plane reads through documentClient.
    expect(dynamoReadCount()).toBe(3)
    // Plus the single presence read (mocked away from documentClient).
    expect(mocks.getCounter).toHaveBeenCalledTimes(1)
  })

  it('flag OFF: the same three reads and NO presence read', async () => {
    mocks.state.scheduleItem = makeActiveScheduleItem()
    mocks.state.checkinItems = [{ archetypeId: CATALOG_ARCHETYPE }]
    mocks.state.nodeItem = { lastArchetypeId: 'archetype-old', lastBranch: null }

    await evaluateLiveArchetype(makeEvent())

    expect(dynamoReadCount()).toBe(3)
    expect(mocks.getCounter).toHaveBeenCalledTimes(0)
  })
})

// ─── Failure paths: presence read never throws, falls back to count 0 ────────

describe('presence-read failure paths fall back to count 0 without throwing (R7.x)', () => {
  it('getCounter rejecting yields count 0 → declared_promise (room not proven)', async () => {
    setFeatureFlagOverride('live_vibe_declaration', true)
    mocks.getCounter.mockRejectedValue(new Error('dynamo throttled'))
    // A real crowd is present in the check-ins, but the failed read means the
    // floor is not met (count 0) so the room cannot be proven.
    mocks.state.checkinItems = [
      { archetypeId: CATALOG_ARCHETYPE },
      { archetypeId: CATALOG_ARCHETYPE },
      { archetypeId: CATALOG_ARCHETYPE },
    ]
    mocks.state.scheduleItem = makeActiveScheduleItem()
    mocks.state.nodeItem = { lastArchetypeId: 'archetype-old', lastBranch: null }

    const outcome = await evaluateLiveArchetype(makeEvent())

    // Did not throw; fell back to the declared promise (count treated as 0).
    expect(outcome.branch).toBe('declared_promise')
  })

  it('getCounter hanging past the timeout yields count 0 → falls back', async () => {
    vi.useFakeTimers()
    try {
      setFeatureFlagOverride('live_vibe_declaration', true)
      // Never resolves on its own — the internal 500 ms timeout race wins.
      mocks.getCounter.mockImplementation(() => new Promise<number>(() => {}))
      mocks.state.checkinItems = [
        { archetypeId: CATALOG_ARCHETYPE },
        { archetypeId: CATALOG_ARCHETYPE },
        { archetypeId: CATALOG_ARCHETYPE },
      ]
      mocks.state.scheduleItem = makeActiveScheduleItem()
      mocks.state.nodeItem = { lastArchetypeId: 'archetype-old', lastBranch: null }

      const pending = evaluateLiveArchetype(makeEvent())
      // Advance past the presence-count timeout so the race resolves to 0.
      await vi.advanceTimersByTimeAsync(600)
      const outcome = await pending

      expect(outcome.branch).toBe('declared_promise')
    } finally {
      vi.useRealTimers()
    }
  })

  it('no presence proof and no Active_Slot falls through to the default tail', async () => {
    setFeatureFlagOverride('live_vibe_declaration', true)
    mocks.getCounter.mockResolvedValue(0)
    mocks.state.checkinItems = []
    mocks.state.scheduleItem = null
    mocks.state.nodeItem = { lastArchetypeId: null, lastBranch: null }

    const outcome = await evaluateLiveArchetype(makeEvent())

    // Below floor, no declaration → default → eclectic tail (never a feature branch).
    expect(['default', 'eclectic_fallback']).toContain(outcome.branch)
    expect(outcome.branch).not.toBe('crowd_live')
    expect(outcome.branch).not.toBe('declared_promise')
  })
})

// ─── End-to-end lifecycle: cold-start → fill → empty (task 10.1) ─────────────
//
// Drives the REAL pure resolver through the full presence arc for one venue
// with `live_vibe_declaration` ON, an Active_Slot present throughout, and a
// qualifying catalog Crowd_Vibe available throughout. Only the I/O boundary is
// mocked (reusing the task 4.2 harness above); the branch decision is exercised
// end to end.
//
// The arc proves the silver-bullet rule "presence is the truth":
//   1. COLD START (0 present, below floor 3): the promise shows on an empty
//      map → `declared_promise` (R1.1).
//   2. FILLS UP (3 present, at floor): presence becomes truth, the crowd beats
//      the declaration → `crowd_live`, and `lastBranch = 'crowd_live'` is
//      persisted (R2.1).
//   3. HOVER AT BOUNDARY (2 present = floor − grace, previousBranch crowd_live):
//      the downward grace holds the branch → STAYS `crowd_live`, no flicker
//      (R3.1).
//   4. EMPTIES (1 present, below floor − grace): the room is no longer proven →
//      reverts to `declared_promise` (R2.4).
//
// Across the arc every archetype-changing transition emits exactly one
// `node:archetype_change` carrying ONLY `{ nodeId, liveArchetypeId, branch }` —
// no consumer identity, no headcount/presence, no beam visual (glyph-identity
// only; POPIA R4.3, R11.2, R11.3, R11.4).

describe('e2e lifecycle: cold-start → fill → empty (R1.1, R2.1, R2.4, R3.1, R4.3, R11.2–R11.4)', () => {
  /** The only keys a `node:archetype_change` delta may carry (R11.3). */
  const ALLOWED_PAYLOAD_KEYS = ['branch', 'liveArchetypeId', 'nodeId']

  /** Keys that would betray identity, location, headcount, or beam visuals —
   *  none may ever appear on the glyph-identity delta (R4.3, R11.1–R11.3). */
  const FORBIDDEN_PAYLOAD_KEYS = [
    'userId',
    'cognitoSub',
    'displayName',
    'email',
    'phone',
    'avatarUrl',
    'lat',
    'lng',
    'latitude',
    'longitude',
    'coordinates',
    'coords',
    'count',
    'presenceCount',
    'headcount',
    'checkInCount',
    'liveCount',
    'beamBrightness',
    'beamHeight',
    'beamSpeed',
    'pulse',
    'pulseScore',
    'pulseState',
  ]

  /** Assert a captured delta carries exactly the glyph-identity triple and no
   *  identity / presence / beam field (R4.3, R11.2, R11.3). */
  function assertGlyphIdentityOnlyPayload(payload: Record<string, unknown>): void {
    expect(Object.keys(payload).sort()).toEqual(ALLOWED_PAYLOAD_KEYS)
    expect(payload['nodeId']).toBe(NODE_ID)
    expect(typeof payload['liveArchetypeId']).toBe('string')
    expect(typeof payload['branch']).toBe('string')
    for (const forbidden of FORBIDDEN_PAYLOAD_KEYS) {
      expect(payload).not.toHaveProperty(forbidden)
    }
  }

  /** Grab the single emitted `node:archetype_change` payload from the stub. */
  function lastEmittedPayload(): Record<string, unknown> {
    expect(mocks.emitMock).toHaveBeenCalledTimes(1)
    const call = mocks.emitMock.mock.calls[0]!
    expect(call[0]).toBe(CITY_SLUG)
    return call[1] as Record<string, unknown>
  }

  it('drives the evaluator through declared_promise → crowd_live → (grace) crowd_live → declared_promise', async () => {
    // Flag ON for the whole arc; `live_vibe_on_map` stays ON (set in beforeEach).
    setFeatureFlagOverride('live_vibe_declaration', true)

    // An Active_Slot (amapiano blanket) AND a qualifying catalog Crowd_Vibe are
    // present in EVERY phase — only the honest present count moves.
    const qualifyingCheckIns = [
      { archetypeId: CATALOG_ARCHETYPE },
      { archetypeId: CATALOG_ARCHETYPE },
      { archetypeId: CATALOG_ARCHETYPE },
    ]

    // Carry the persisted cache forward between phases so `previousBranch`
    // (sourced from the Node row's `lastBranch`) is realistic, exactly as the
    // live Lambda would read it back on the next tick.
    let persistedArchetypeId: string | null = 'archetype-cold-start-seed'
    let persistedBranch: LiveArchetypeBranch | null = null

    // ── Phase 1: COLD START — empty room, promise shows on an empty map ──────
    __resetLastEmitForTests()
    mocks.updates.length = 0
    mocks.emitMock.mockClear()
    mocks.getCounter.mockResolvedValue(0) // below floor (3)
    mocks.state.checkinItems = qualifyingCheckIns
    mocks.state.scheduleItem = makeActiveScheduleItem()
    mocks.state.nodeItem = { lastArchetypeId: persistedArchetypeId, lastBranch: persistedBranch }

    const cold = await evaluateLiveArchetype(makeEvent())

    expect(cold.branch).toBe('declared_promise') // R1.1: promise on an empty map
    expect(cold.emitted).toBe(true)
    const declaredId = cold.archetypeId!
    expect(typeof declaredId).toBe('string')

    const coldPayload = lastEmittedPayload()
    expect(coldPayload['branch']).toBe('declared_promise')
    expect(coldPayload['liveArchetypeId']).toBe(declaredId)
    assertGlyphIdentityOnlyPayload(coldPayload)

    // Cache persisted the declared promise.
    expect(mocks.updates.length).toBe(1)
    {
      const values = mocks.updates[0]!['ExpressionAttributeValues'] as Record<string, unknown>
      expect(values[':b']).toBe('declared_promise')
      expect(values[':a']).toBe(declaredId)
      persistedArchetypeId = values[':a'] as string
      persistedBranch = values[':b'] as LiveArchetypeBranch | null
    }

    // ── Phase 2: FILLS UP — presence becomes truth, crowd beats declaration ──
    __resetLastEmitForTests() // avoid coalescing the next emit
    mocks.updates.length = 0
    mocks.emitMock.mockClear()
    mocks.getCounter.mockResolvedValue(3) // at the floor exactly
    mocks.state.checkinItems = qualifyingCheckIns
    mocks.state.scheduleItem = makeActiveScheduleItem()
    // Feed the persisted lastBranch forward (previousBranch === 'declared_promise').
    mocks.state.nodeItem = { lastArchetypeId: persistedArchetypeId, lastBranch: persistedBranch }

    const filled = await evaluateLiveArchetype(makeEvent())

    expect(filled.branch).toBe('crowd_live') // R2.1: presence is the truth
    const crowdId = filled.archetypeId!
    expect(crowdId).toBe(CATALOG_ARCHETYPE)
    expect(crowdId).not.toBe(declaredId) // glyph identity actually changes → emits
    expect(filled.emitted).toBe(true)

    const filledPayload = lastEmittedPayload()
    expect(filledPayload['branch']).toBe('crowd_live')
    expect(filledPayload['liveArchetypeId']).toBe(crowdId)
    assertGlyphIdentityOnlyPayload(filledPayload)

    // Cache write persisted lastBranch = 'crowd_live'.
    expect(mocks.updates.length).toBe(1)
    {
      const values = mocks.updates[0]!['ExpressionAttributeValues'] as Record<string, unknown>
      expect(values[':b']).toBe('crowd_live')
      expect(values[':a']).toBe(crowdId)
      persistedArchetypeId = values[':a'] as string
      persistedBranch = values[':b'] as LiveArchetypeBranch | null
    }

    // ── Phase 3: HOVER AT BOUNDARY — grace holds the branch, no flicker ──────
    __resetLastEmitForTests()
    mocks.updates.length = 0
    mocks.emitMock.mockClear()
    mocks.getCounter.mockResolvedValue(2) // = floor − grace (3 − 1), inside the band
    mocks.state.checkinItems = qualifyingCheckIns
    mocks.state.scheduleItem = makeActiveScheduleItem()
    // previousBranch === 'crowd_live' lowers the effective floor to 2.
    mocks.state.nodeItem = { lastArchetypeId: persistedArchetypeId, lastBranch: persistedBranch }

    const hover = await evaluateLiveArchetype(makeEvent())

    expect(hover.branch).toBe('crowd_live') // R3.1: stays — no boundary flicker
    expect(hover.archetypeId).toBe(crowdId)
    expect(hover.changed).toBe(false) // same glyph identity → nothing changed
    expect(hover.emitted).toBe(false)
    expect(mocks.emitMock).not.toHaveBeenCalled() // no archetype change → no delta
    expect(mocks.updates.length).toBe(0) // no change → no cache write
    // The persisted branch is unchanged (still 'crowd_live') for the next tick.

    // ── Phase 4: EMPTIES — room no longer proven, reverts to the promise ─────
    __resetLastEmitForTests()
    mocks.updates.length = 0
    mocks.emitMock.mockClear()
    mocks.getCounter.mockResolvedValue(1) // below floor − grace (< 2)
    mocks.state.checkinItems = qualifyingCheckIns
    mocks.state.scheduleItem = makeActiveScheduleItem()
    // previousBranch is still 'crowd_live' (phase 3 wrote nothing).
    mocks.state.nodeItem = { lastArchetypeId: persistedArchetypeId, lastBranch: persistedBranch }

    const emptied = await evaluateLiveArchetype(makeEvent())

    expect(emptied.branch).toBe('declared_promise') // R2.4: reverts to the promise
    expect(emptied.archetypeId).toBe(declaredId)
    expect(emptied.emitted).toBe(true)

    const emptiedPayload = lastEmittedPayload()
    expect(emptiedPayload['branch']).toBe('declared_promise')
    expect(emptiedPayload['liveArchetypeId']).toBe(declaredId)
    assertGlyphIdentityOnlyPayload(emptiedPayload)

    // ── Whole-arc invariant: ONLY the glyph identity (archetype id / branch)
    //    moved. The nodeId was constant on every delta and no payload ever
    //    carried presence/headcount or a beam field (R4.3, R11.2, R11.3).
    expect(coldPayload['nodeId']).toBe(NODE_ID)
    expect(filledPayload['nodeId']).toBe(NODE_ID)
    expect(emptiedPayload['nodeId']).toBe(NODE_ID)

    // Phase-by-phase branch arc, asserted as a sequence for readability.
    expect([cold.branch, filled.branch, hover.branch, emptied.branch]).toEqual([
      'declared_promise',
      'crowd_live',
      'crowd_live',
      'declared_promise',
    ])
  })
})
