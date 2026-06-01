/**
 * Unit tests for the Win-Back Campaigns segment resolver.
 *
 * Covers the four segments (lapsed / first_timers / regulars /
 * all_past_visitors), cross-node deduplication, the lapsed-window boundary,
 * and the 10000-per-node truncation flag (Requirement 14.4).
 *
 * `getCheckInsByNode` is the only DB dependency; it is stubbed so the resolver
 * logic is the sole surface under test. No phone identifier appears anywhere —
 * the only consumer identifier is `userId` (Constraint C1).
 *
 * _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 14.4_
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCheckInsByNode: vi.fn(),
}))

vi.mock('../../check-in/dynamodb-repository.js', () => ({
  getCheckInsByNode: mocks.getCheckInsByNode,
}))

import { resolveSegment, resolveSegmentWithMeta } from '../segment-resolver.js'

// ─── Helpers ────────────────────────────────────────────────────────────────

interface FakeCheckIn {
  userId: string
  nodeId: string
  checkedInAt: string
}

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 0, 31) // fixed reference time

function iso(daysAgo: number): string {
  return new Date(NOW - daysAgo * DAY).toISOString()
}

/**
 * Wire the mock so each node returns its own list of check-ins, paginated in
 * pages of `pageSize` to exercise the resolver's pagination loop.
 */
function seed(checkInsByNode: Record<string, FakeCheckIn[]>, pageSize = 100): void {
  mocks.getCheckInsByNode.mockImplementation((nodeId: string, options?: { limit?: number; cursor?: string }) => {
    const all = checkInsByNode[nodeId] ?? []
    const start = options?.cursor ? parseInt(options.cursor, 10) : 0
    const limit = Math.min(options?.limit ?? 50, pageSize)
    const slice = all.slice(start, start + limit)
    const next = start + limit
    return Promise.resolve({
      checkIns: slice,
      nextCursor: next < all.length ? String(next) : undefined,
    })
  })
}

beforeEach(() => {
  mocks.getCheckInsByNode.mockReset()
})

// ─── all_past_visitors ──────────────────────────────────────────────────────

describe('resolveSegment — all_past_visitors', () => {
  it('returns every consumer who checked in at least once', async () => {
    seed({
      n1: [
        { userId: 'u1', nodeId: 'n1', checkedInAt: iso(40) },
        { userId: 'u2', nodeId: 'n1', checkedInAt: iso(3) },
      ],
    })
    const result = await resolveSegment({
      segment: 'all_past_visitors',
      nodeIds: ['n1'],
      lapsedWindowDays: 21,
      nowMs: NOW,
    })
    expect(result.sort()).toEqual(['u1', 'u2'])
  })

  it('returns an empty array when there are no nodes', async () => {
    const result = await resolveSegment({
      segment: 'all_past_visitors',
      nodeIds: [],
      lapsedWindowDays: 21,
      nowMs: NOW,
    })
    expect(result).toEqual([])
    expect(mocks.getCheckInsByNode).not.toHaveBeenCalled()
  })
})

// ─── Deduplication across nodes (Requirement 2.2, 3.4) ──────────────────────

describe('resolveSegment — deduplication', () => {
  it('counts a consumer who visited multiple nodes exactly once', async () => {
    seed({
      n1: [{ userId: 'u1', nodeId: 'n1', checkedInAt: iso(40) }],
      n2: [{ userId: 'u1', nodeId: 'n2', checkedInAt: iso(35) }],
    })
    const result = await resolveSegment({
      segment: 'all_past_visitors',
      nodeIds: ['n1', 'n2'],
      lapsedWindowDays: 21,
      nowMs: NOW,
    })
    expect(result).toEqual(['u1'])
  })
})

// ─── lapsed (Requirements 2.1, 2.3) ─────────────────────────────────────────

describe('resolveSegment — lapsed', () => {
  it('includes users whose last check-in is older than the window', async () => {
    seed({
      n1: [
        { userId: 'lapsed', nodeId: 'n1', checkedInAt: iso(40) }, // outside 21d
        { userId: 'active', nodeId: 'n1', checkedInAt: iso(5) }, // inside 21d
      ],
    })
    const result = await resolveSegment({
      segment: 'lapsed',
      nodeIds: ['n1'],
      lapsedWindowDays: 21,
      nowMs: NOW,
    })
    expect(result).toEqual(['lapsed'])
  })

  it('excludes a user with any check-in inside the window, even if they also have old ones', async () => {
    seed({
      n1: [
        { userId: 'u1', nodeId: 'n1', checkedInAt: iso(40) },
        { userId: 'u1', nodeId: 'n1', checkedInAt: iso(2) }, // recent → not lapsed
      ],
    })
    const result = await resolveSegment({
      segment: 'lapsed',
      nodeIds: ['n1'],
      lapsedWindowDays: 21,
      nowMs: NOW,
    })
    expect(result).toEqual([])
  })

  it('treats a check-in exactly at the window edge as still active (boundary)', async () => {
    // lastCheckIn === cutoff is NOT older than cutoff → not lapsed
    seed({
      n1: [{ userId: 'edge', nodeId: 'n1', checkedInAt: iso(21) }],
    })
    const result = await resolveSegment({
      segment: 'lapsed',
      nodeIds: ['n1'],
      lapsedWindowDays: 21,
      nowMs: NOW,
    })
    expect(result).toEqual([])
  })
})

// ─── first_timers (Requirement 3.1) ─────────────────────────────────────────

describe('resolveSegment — first_timers', () => {
  it('includes only users with exactly one check-in across all nodes', async () => {
    seed({
      n1: [
        { userId: 'once', nodeId: 'n1', checkedInAt: iso(10) },
        { userId: 'twice', nodeId: 'n1', checkedInAt: iso(10) },
      ],
      n2: [{ userId: 'twice', nodeId: 'n2', checkedInAt: iso(8) }],
    })
    const result = await resolveSegment({
      segment: 'first_timers',
      nodeIds: ['n1', 'n2'],
      lapsedWindowDays: 21,
      nowMs: NOW,
    })
    expect(result).toEqual(['once'])
  })
})

// ─── regulars (Requirement 3.2) ─────────────────────────────────────────────

describe('resolveSegment — regulars', () => {
  it('includes users whose tier is regular or higher (>= 10 check-ins)', async () => {
    const tenCheckIns = Array.from({ length: 10 }, (_, i) => ({
      userId: 'regular',
      nodeId: 'n1',
      checkedInAt: iso(i + 1),
    }))
    const nineCheckIns = Array.from({ length: 9 }, (_, i) => ({
      userId: 'local',
      nodeId: 'n1',
      checkedInAt: iso(i + 1),
    }))
    seed({ n1: [...tenCheckIns, ...nineCheckIns] })

    const result = await resolveSegment({
      segment: 'regulars',
      nodeIds: ['n1'],
      lapsedWindowDays: 21,
      nowMs: NOW,
    })
    expect(result).toEqual(['regular'])
  })
})

// ─── Truncation flag (Requirement 14.4) ─────────────────────────────────────

describe('resolveSegmentWithMeta — truncation', () => {
  it('does not flag truncation when under the per-node cap', async () => {
    seed({ n1: [{ userId: 'u1', nodeId: 'n1', checkedInAt: iso(40) }] })
    const { truncated } = await resolveSegmentWithMeta({
      segment: 'all_past_visitors',
      nodeIds: ['n1'],
      lapsedWindowDays: 21,
      nowMs: NOW,
    })
    expect(truncated).toBe(false)
  })

  it('flags truncation when a node exceeds the 10000 check-in cap', async () => {
    // 10001 check-ins → resolver scans 10000 then stops with a remaining cursor.
    const many = Array.from({ length: 10001 }, (_, i) => ({
      userId: `u${i}`,
      nodeId: 'n1',
      checkedInAt: iso(40),
    }))
    seed({ n1: many })

    const { truncated, userIds } = await resolveSegmentWithMeta({
      segment: 'all_past_visitors',
      nodeIds: ['n1'],
      lapsedWindowDays: 21,
      nowMs: NOW,
    })
    expect(truncated).toBe(true)
    // Exactly the capped number of distinct users were scanned.
    expect(userIds.length).toBe(10000)
  })
})
