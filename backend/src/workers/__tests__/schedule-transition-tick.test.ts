/**
 * Integration tests for the schedule-transition-tick fan-out (Live Vibe
 * on Map § R11.3, R11.4, R11.5, R12.5).
 *
 * Validates:
 *   - Property 13: per-venue read budget — the orchestrator fans out
 *     exactly one Evaluation_Tick per matching schedule row.
 *   - 100-venue simulation: every venue is evaluated once, latency
 *     telemetry rolls up cleanly, and per-venue exceptions do not poison
 *     the rest of the tick.
 *   - One bad row never poisons the whole tick (R11.5).
 *
 * Strategy:
 *   The repository (`queryNextTransitions`) and the in-process evaluator
 *   (`evaluateLiveArchetype`) are mocked so the orchestrator's behaviour
 *   is the only surface under test. Routing reads go through the AWS SDK
 *   `documentClient`, which we stub to return a deterministic node + city
 *   row per businessId.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ───────────────────────────────────────────────────────────
//
// `vi.hoisted` runs before the `vi.mock` factories so the spy references
// inside the factories are guaranteed to be defined when the mocks are
// installed. Without it the const declarations end up below the hoisted
// `vi.mock` calls and the test file fails to load with a TDZ error.

const mocks = vi.hoisted(() => {
  const queryNextTransitions = vi.fn()
  const evaluateLiveArchetype = vi.fn()
  const sendMock = vi.fn(async (cmd: unknown) => {
    // Detect command shape by duck-typing — QueryCommand has `input.IndexName`,
    // GetCommand has `input.Key`.
    const input = (cmd as { input?: Record<string, unknown> })?.input ?? {}
    if ('IndexName' in input && input['IndexName'] === 'BusinessIndex') {
      const businessId = (input as { ExpressionAttributeValues?: Record<string, unknown> })
        ?.ExpressionAttributeValues?.[':bid'] as string | undefined
      return {
        Items: [
          {
            nodeId: `node-${businessId}`,
            cityId: 'city-jhb',
            isActive: true,
          },
        ],
      }
    }
    if ('Key' in input) {
      const key = input['Key'] as { pk?: string }
      if (typeof key?.pk === 'string' && key.pk.startsWith('CITY#')) {
        return { Item: { slug: 'johannesburg' } }
      }
    }
    return {}
  })
  return { queryNextTransitions, evaluateLiveArchetype, sendMock }
})

const { queryNextTransitions, evaluateLiveArchetype, sendMock } = mocks

vi.mock('../../features/music/schedule-repository.js', () => ({
  queryNextTransitions: mocks.queryNextTransitions,
}))

vi.mock('../live-archetype-evaluator.js', () => ({
  evaluateLiveArchetype: mocks.evaluateLiveArchetype,
}))

vi.mock('../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.sendMock },
  TableNames: {
    musicSchedules: 'music-schedules',
    nodes: 'nodes',
    checkins: 'checkins',
    appData: 'app-data',
  },
}))

// Import AFTER mocks so the module-level singletons pick up the stubs.
import { runTransitionTick } from '../schedule-transition-tick'
import type { NextTransitionRow } from '../../features/music/schedule-repository.js'

function makeRow(i: number): NextTransitionRow {
  return {
    businessId: `biz-${i}`,
    scheduleId: 'default',
    nextTransitionAt: new Date(Date.now() + i * 100).toISOString(),
  }
}

beforeEach(() => {
  queryNextTransitions.mockReset()
  evaluateLiveArchetype.mockReset()
  sendMock.mockClear()
})

describe('schedule-transition-tick fan-out (R11.3, R11.4, R11.5)', () => {
  it('fans out exactly one Evaluation_Tick per matching schedule row', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => makeRow(i))
    queryNextTransitions.mockResolvedValue(rows)
    evaluateLiveArchetype.mockResolvedValue({
      archetypeId: 'archetype-eclectic',
      branch: 'default',
      changed: false,
      emitted: false,
      reason: 'no_change_no_emit',
    })

    const outcome = await runTransitionTick()

    expect(evaluateLiveArchetype).toHaveBeenCalledTimes(100)
    expect(outcome.venuesEvaluated).toBe(100)
    expect(outcome.routingFailures).toBe(0)
    expect(outcome.evaluatorErrors).toBe(0)
  })

  it('reports changes only when the evaluator returns changed=true', async () => {
    queryNextTransitions.mockResolvedValue([makeRow(0), makeRow(1), makeRow(2)])
    evaluateLiveArchetype
      .mockResolvedValueOnce({
        archetypeId: 'a',
        branch: 'schedule_blanket',
        changed: true,
        emitted: true,
        reason: 'emitted',
      })
      .mockResolvedValueOnce({
        archetypeId: 'b',
        branch: 'default',
        changed: false,
        emitted: false,
        reason: 'unchanged',
      })
      .mockResolvedValueOnce({
        archetypeId: 'c',
        branch: 'schedule_lineup',
        changed: true,
        emitted: false,
        reason: 'no_subscribers',
      })

    const outcome = await runTransitionTick()
    expect(outcome.venuesEvaluated).toBe(3)
    expect(outcome.changesEmitted).toBe(2)
  })

  it('continues processing when an individual evaluator call throws (R11.5)', async () => {
    queryNextTransitions.mockResolvedValue([makeRow(0), makeRow(1), makeRow(2)])
    evaluateLiveArchetype
      .mockResolvedValueOnce({
        archetypeId: 'a',
        branch: 'default',
        changed: false,
        emitted: false,
        reason: 'no_change_no_emit',
      })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        archetypeId: 'c',
        branch: 'default',
        changed: false,
        emitted: false,
        reason: 'no_change_no_emit',
      })

    const outcome = await runTransitionTick()
    expect(outcome.venuesEvaluated).toBe(2)
    expect(outcome.evaluatorErrors).toBe(1)
  })

  it('emits a zeroed outcome when the GSI query itself fails (no retry storm)', async () => {
    queryNextTransitions.mockRejectedValue(new Error('gsi unavailable'))
    const outcome = await runTransitionTick()
    expect(evaluateLiveArchetype).not.toHaveBeenCalled()
    expect(outcome.venuesEvaluated).toBe(0)
    expect(outcome.changesEmitted).toBe(0)
    expect(outcome.evaluatorErrors).toBe(0)
  })
})
