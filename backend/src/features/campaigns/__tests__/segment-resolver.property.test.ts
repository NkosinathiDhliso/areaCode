/**
 * Property-based tests for the Win-Back Campaigns segment resolver.
 *
 * Library: fast-check + Vitest, ≥100 iterations per property.
 *
 * `getCheckInsByNode` is the only DB dependency; it is stubbed (vi.hoisted +
 * vi.mock + the `seed()` helper) so the resolver logic is the sole surface
 * under test. No phone identifier appears anywhere — the only consumer
 * identifier is `userId` (Constraint C1).
 *
 * ── SHARED SECTION ──────────────────────────────────────────────────────────
 * The imports, mocks, and helpers below (`FakeCheckIn`, `DAY`, `NOW`, `iso`,
 * `seed`, the `beforeEach` reset, and the shared arbitraries) are intended to be
 * reused by every property in this file. Additional properties (e.g. Property 1:
 * Lapsed Segment Exclusivity) SHOULD be appended as new `describe(...)` blocks
 * that build on these shared declarations rather than re-declaring the module
 * mock (vi.mock is hoisted/module-level and would collide).
 *
 * Properties currently covered here:
 *   - Property 2: Segment Deduplication      (Requirements 2.2, 3.4)
 *   - Property 3: First-Timers Correctness    (Requirement 3.1)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'

const mocks = vi.hoisted(() => ({
  getCheckInsByNode: vi.fn(),
}))

vi.mock('../../check-in/dynamodb-repository.js', () => ({
  getCheckInsByNode: mocks.getCheckInsByNode,
}))

import { resolveSegment } from '../segment-resolver.js'
import type { Segment } from '../types.js'

// ─── Shared helpers ──────────────────────────────────────────────────────────

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

// ─── Shared arbitraries ──────────────────────────────────────────────────────

/**
 * Small fixed pools so that userIds naturally repeat across nodes (the
 * condition Property 2 cares about) and per-user counts vary (Property 3).
 */
const NODE_POOL = ['n1', 'n2', 'n3'] as const
const USER_POOL = ['u0', 'u1', 'u2', 'u3', 'u4', 'u5'] as const

/** A single raw check-in over the fixed user/node pools. */
const checkInArb = fc.record({
  userId: fc.constantFrom(...USER_POOL),
  nodeId: fc.constantFrom(...NODE_POOL),
  daysAgo: fc.integer({ min: 0, max: 120 }),
})

/**
 * A resolution scenario: a list of check-ins grouped into the per-node map the
 * resolver reads through `getCheckInsByNode`. Because the user pool is small and
 * there are multiple nodes, the same userId routinely appears at more than one
 * node — exactly the cross-node repetition Property 2 must collapse.
 */
const scenarioArb = fc.array(checkInArb, { minLength: 0, maxLength: 60 }).map((rows) => {
  const checkInsByNode: Record<string, FakeCheckIn[]> = {}
  for (const r of rows) {
    ;(checkInsByNode[r.nodeId] ??= []).push({
      userId: r.userId,
      nodeId: r.nodeId,
      checkedInAt: iso(r.daysAgo),
    })
  }
  return checkInsByNode
})

/** All four segments — Property 2 (dedup) must hold for every one of them. */
const ALL_SEGMENTS: Segment[] = ['lapsed', 'first_timers', 'regulars', 'all_past_visitors']

// ─── Property 2: Segment Deduplication ───────────────────────────────────────

describe('Feature: winback-campaigns, Property 2: Segment Deduplication', () => {
  it('returns each userId at most once even when they appear at multiple nodes', async () => {
    /**
     * **Validates: Requirements 2.2, 3.4**
     */
    await fc.assert(
      fc.asyncProperty(
        scenarioArb,
        fc.constantFrom(...ALL_SEGMENTS),
        fc.integer({ min: 7, max: 90 }),
        async (checkInsByNode, segment, lapsedWindowDays) => {
          seed(checkInsByNode)

          const result = await resolveSegment({
            segment,
            nodeIds: [...NODE_POOL],
            lapsedWindowDays,
            nowMs: NOW,
          })

          // No userId may appear more than once in any resolved segment.
          const unique = new Set(result)
          expect(unique.size).toBe(result.length)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('counts a userId present at several nodes a single time in the result', async () => {
    /**
     * **Validates: Requirements 2.2, 3.4**
     *
     * Stronger form: when a userId checks in at every node, the resolved
     * `all_past_visitors` segment contains that userId exactly once.
     */
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...USER_POOL), fc.integer({ min: 1, max: 5 }), async (userId, perNodeCount) => {
        // Place `perNodeCount` check-ins for `userId` at EACH node.
        const checkInsByNode: Record<string, FakeCheckIn[]> = {}
        for (const nodeId of NODE_POOL) {
          checkInsByNode[nodeId] = Array.from({ length: perNodeCount }, (_, i) => ({
            userId,
            nodeId,
            checkedInAt: iso(i + 1),
          }))
        }
        seed(checkInsByNode)

        const result = await resolveSegment({
          segment: 'all_past_visitors',
          nodeIds: [...NODE_POOL],
          lapsedWindowDays: 21,
          nowMs: NOW,
        })

        expect(result).toEqual([userId])
      }),
      { numRuns: 100 },
    )
  })
})

// ─── Property 3: First-Timers Correctness ────────────────────────────────────

describe('Feature: winback-campaigns, Property 3: First-Timers Correctness', () => {
  it('first_timers contains exactly the userIds whose total check-in count equals 1', async () => {
    /**
     * **Validates: Requirements 3.1**
     */
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (checkInsByNode) => {
        seed(checkInsByNode)

        // Oracle: total check-in count per user across all of the campaign's
        // nodes (the resolver counts every check-in at any targeted node).
        const totals = new Map<string, number>()
        for (const nodeId of NODE_POOL) {
          for (const ci of checkInsByNode[nodeId] ?? []) {
            totals.set(ci.userId, (totals.get(ci.userId) ?? 0) + 1)
          }
        }
        const expected = new Set([...totals.entries()].filter(([, count]) => count === 1).map(([userId]) => userId))

        const result = await resolveSegment({
          segment: 'first_timers',
          nodeIds: [...NODE_POOL],
          lapsedWindowDays: 21,
          nowMs: NOW,
        })
        const actual = new Set(result)

        // Set equality: nothing missing, nothing extra.
        expect(actual).toEqual(expected)
      }),
      { numRuns: 100 },
    )
  })

  it('excludes any userId with two or more check-ins (across same or different nodes)', async () => {
    /**
     * **Validates: Requirements 3.1**
     *
     * A user with ≥2 check-ins is never a first-timer, regardless of whether the
     * check-ins land on one node or are spread across several.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...USER_POOL),
        fc.array(fc.constantFrom(...NODE_POOL), { minLength: 2, maxLength: 6 }),
        async (userId, nodeAssignments) => {
          const checkInsByNode: Record<string, FakeCheckIn[]> = {}
          nodeAssignments.forEach((nodeId, i) => {
            ;(checkInsByNode[nodeId] ??= []).push({
              userId,
              nodeId,
              checkedInAt: iso(i + 1),
            })
          })
          seed(checkInsByNode)

          const result = await resolveSegment({
            segment: 'first_timers',
            nodeIds: [...NODE_POOL],
            lapsedWindowDays: 21,
            nowMs: NOW,
          })

          expect(result).not.toContain(userId)
        },
      ),
      { numRuns: 100 },
    )
  })
})

// ─── Property 1: Lapsed Segment Exclusivity ──────────────────────────────────

describe('Feature: winback-campaigns, Property 1: Lapsed Segment Exclusivity', () => {
  it('lapsed = users whose most-recent check-in is before the cutoff, and never an in-window user', async () => {
    /**
     * **Validates: Requirements 2.1, 2.3**
     *
     * Oracle: cutoff = NOW - lapsedWindowDays*DAY. A user is lapsed iff they
     * have at least one check-in across the campaign's nodes AND their
     * most-recent check-in is strictly before the cutoff (equivalently: no
     * check-in within the most recent `lapsedWindowDays`). The resolver's rule
     * is `lastCheckInMs < cutoffMs`, so a check-in exactly at the window edge
     * counts as active, not lapsed.
     */
    await fc.assert(
      fc.asyncProperty(scenarioArb, fc.integer({ min: 7, max: 90 }), async (checkInsByNode, lapsedWindowDays) => {
        seed(checkInsByNode)

        const cutoffMs = NOW - lapsedWindowDays * DAY

        // Oracle: most-recent check-in time per user across the campaign's
        // nodes (presence in the map ⇒ "checked in at least once").
        const lastByUser = new Map<string, number>()
        for (const nodeId of NODE_POOL) {
          for (const ci of checkInsByNode[nodeId] ?? []) {
            const ms = new Date(ci.checkedInAt).getTime()
            const prev = lastByUser.get(ci.userId)
            if (prev === undefined || ms > prev) lastByUser.set(ci.userId, ms)
          }
        }

        const expected = new Set(
          [...lastByUser.entries()].filter(([, lastMs]) => lastMs < cutoffMs).map(([userId]) => userId),
        )

        const result = await resolveSegment({
          segment: 'lapsed',
          nodeIds: [...NODE_POOL],
          lapsedWindowDays,
          nowMs: NOW,
        })
        const actual = new Set(result)

        // Set equality with the oracle: nothing missing, nothing extra.
        expect(actual).toEqual(expected)

        // Exclusivity (Req 2.3): no user with an in-window check-in
        // (lastMs ≥ cutoff) may appear in the lapsed set.
        for (const userId of result) {
          const lastMs = lastByUser.get(userId)
          expect(lastMs).toBeLessThan(cutoffMs)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('treats a single check-in exactly at the window edge as active (not lapsed)', async () => {
    /**
     * **Validates: Requirements 2.1, 2.3**
     *
     * Boundary: a check-in exactly `lapsedWindowDays` ago lands on the cutoff
     * (ms === cutoffMs). Per the resolver's `lastCheckInMs < cutoffMs` rule this
     * is an active customer and MUST NOT be in the lapsed segment.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...USER_POOL),
        fc.integer({ min: 7, max: 90 }),
        async (userId, lapsedWindowDays) => {
          seed({ n1: [{ userId, nodeId: 'n1', checkedInAt: iso(lapsedWindowDays) }] })

          const result = await resolveSegment({
            segment: 'lapsed',
            nodeIds: [...NODE_POOL],
            lapsedWindowDays,
            nowMs: NOW,
          })

          expect(result).not.toContain(userId)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('includes a user whose only check-in falls just outside the window', async () => {
    /**
     * **Validates: Requirements 2.1, 2.3**
     *
     * One day older than the edge ⇒ most-recent check-in is strictly before the
     * cutoff ⇒ the user is lapsed.
     */
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...USER_POOL),
        fc.integer({ min: 7, max: 90 }),
        async (userId, lapsedWindowDays) => {
          seed({ n1: [{ userId, nodeId: 'n1', checkedInAt: iso(lapsedWindowDays + 1) }] })

          const result = await resolveSegment({
            segment: 'lapsed',
            nodeIds: [...NODE_POOL],
            lapsedWindowDays,
            nowMs: NOW,
          })

          expect(result).toEqual([userId])
        },
      ),
      { numRuns: 100 },
    )
  })
})
