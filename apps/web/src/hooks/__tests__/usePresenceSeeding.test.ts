// @vitest-environment jsdom
/**
 * Tests for usePresenceSeeding - first-paint REST priming of the honest
 * Live_Presence_Count (honest-presence-ui task 4.3).
 *
 * Covers:
 * - Seeds only the top-N targets; the RECOMMENDED_LIMIT (20) bound is respected
 *   even when more nodes are loaded (R4.5).
 * - Writes setLivePresenceCount with the read value, including an honest 0
 *   (R4.1, R4.3).
 * - A per-node read failure leaves that node unseeded and never throws
 *   (failure isolation, R4.4).
 * - One request per target per nodes payload; no polling loop (R4.2).
 *
 * The shared API client is mocked with `vi.hoisted` so the factory can read a
 * mutable per-nodeId response map and a call log. The real `useMapStore` is
 * driven/inspected via setState/getState and reset in `beforeEach`. No network.
 */
import { useMapStore } from '@area-code/shared/stores/mapStore'
import type { Node } from '@area-code/shared/types'
import { renderHook } from '@testing-library/react'
import * as fc from 'fast-check'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RECOMMENDED_LIMIT } from '../../lib/carouselConstants'
import { pickSeedTargets, usePresenceSeeding } from '../usePresenceSeeding'

// `vi.hoisted` so the module mock factory can reference shared mutable state:
// `calls` logs every requested nodeId (call counter / no-polling check) and
// `responses` maps a nodeId to either a livePresenceCount or an Error to throw.
const apiMock = vi.hoisted(() => ({
  calls: [] as string[],
  responses: new Map<string, number | Error>(),
}))

vi.mock('@area-code/shared/lib/api', () => ({
  api: {
    get: vi.fn(async (url: string) => {
      const match = /\/v1\/nodes\/(.+)\/presence$/.exec(url)
      const nodeId = match ? match[1] : ''
      apiMock.calls.push(nodeId)
      const configured = apiMock.responses.get(nodeId)
      if (configured instanceof Error) throw configured
      const livePresenceCount = typeof configured === 'number' ? configured : 0
      return { nodeId, livePresenceCount }
    }),
  },
}))

/** Minimal Node fixture. Only id/name/category/lat/lng drive vibeRank here. */
function node(id: string): Node {
  return { id, name: `Venue ${id}`, category: 'nightlife', lat: -26.2, lng: 28.04 } as Node
}

/**
 * Build `count` nodes with zero-padded ids (n00, n01, ...). With empty pulse /
 * check-in signals, default tier, and no fresh position, `vibeRank` degrades to
 * the id-ascending tail, so the top-N targets are deterministically n00..n(N-1).
 */
function makeNodes(count: number): Node[] {
  return Array.from({ length: count }, (_, i) => node(`n${String(i).padStart(2, '0')}`))
}

beforeEach(() => {
  vi.clearAllMocks()
  apiMock.calls.length = 0
  apiMock.responses.clear()
  useMapStore.setState({ checkInCounts: {} })
})

describe('usePresenceSeeding', () => {
  it('seeds at most RECOMMENDED_LIMIT targets when more nodes are loaded (R4.5)', async () => {
    const nodes = makeNodes(RECOMMENDED_LIMIT + 5) // 25 nodes
    nodes.forEach((n) => apiMock.responses.set(n.id, 3))

    renderHook(() => usePresenceSeeding(nodes))

    await vi.waitFor(() => {
      expect(apiMock.calls.length).toBe(RECOMMENDED_LIMIT)
    })

    // The selected set is exactly the top-N by vibeRank (id ascending here).
    const expected = makeNodes(RECOMMENDED_LIMIT).map((n) => n.id)
    expect([...apiMock.calls].sort()).toEqual(expected)

    // Nodes beyond the cap are never requested or seeded.
    const counts = useMapStore.getState().checkInCounts
    expect(counts['n20']).toBeUndefined()
    expect(counts['n24']).toBeUndefined()
    expect(Object.keys(counts).length).toBe(RECOMMENDED_LIMIT)
  })

  it('writes setLivePresenceCount with the read value, including an honest 0 (R4.1, R4.3)', async () => {
    const nodes = [node('a'), node('b'), node('c')]
    apiMock.responses.set('a', 7)
    apiMock.responses.set('b', 0) // honest empty venue
    apiMock.responses.set('c', 12)

    renderHook(() => usePresenceSeeding(nodes))

    await vi.waitFor(() => {
      expect(Object.keys(useMapStore.getState().checkInCounts).length).toBe(3)
    })

    const counts = useMapStore.getState().checkInCounts
    expect(counts['a']).toBe(7)
    expect(counts['b']).toBe(0) // 0 written as 0, never substituted
    expect(counts['c']).toBe(12)
  })

  it('leaves a node unseeded on a per-node read failure and does not throw (R4.4)', async () => {
    const nodes = [node('a'), node('b'), node('c')]
    apiMock.responses.set('a', 4)
    apiMock.responses.set('b', new Error('presence read failed'))
    apiMock.responses.set('c', 9)

    // renderHook must not throw despite the rejected per-node read.
    expect(() => renderHook(() => usePresenceSeeding(nodes))).not.toThrow()

    await vi.waitFor(() => {
      // The two healthy nodes seed; the failing one is left unseeded.
      expect(Object.keys(useMapStore.getState().checkInCounts).sort()).toEqual(['a', 'c'])
    })

    const counts = useMapStore.getState().checkInCounts
    expect(counts['a']).toBe(4)
    expect(counts['c']).toBe(9)
    expect(counts['b']).toBeUndefined()
  })

  it('issues exactly one request per target per payload, with no polling (R4.2)', async () => {
    const nodes = [node('a'), node('b'), node('c')]
    nodes.forEach((n) => apiMock.responses.set(n.id, 2))

    renderHook(() => usePresenceSeeding(nodes))

    await vi.waitFor(() => {
      expect(apiMock.calls.length).toBe(3)
    })

    // Give any (incorrect) polling loop a chance to fire a second round.
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(apiMock.calls.length).toBe(3)
    expect([...apiMock.calls].sort()).toEqual(['a', 'b', 'c']) // each target once, no dupes
  })
})

describe('pickSeedTargets', () => {
  it('never returns more than the cap', () => {
    const targets = pickSeedTargets(makeNodes(RECOMMENDED_LIMIT + 10))
    expect(targets.length).toBe(RECOMMENDED_LIMIT)
  })

  it('returns all nodes when fewer than the cap, with no duplicates', () => {
    const targets = pickSeedTargets(makeNodes(4))
    const ids = targets.map((t) => t.id)
    expect(ids.length).toBe(4)
    expect(new Set(ids).size).toBe(4)
  })

  // Feature: honest-presence-ui, Property 5: Bounded, one-shot, failure-isolated seeding
  // Validates: Requirements 4.5
  //
  // For ANY node set - including sets larger than the cap and sets where node
  // ids repeat - pickSeedTargets never returns more than RECOMMENDED_LIMIT (20)
  // and never repeats a node id in its output. The repeated-id generator also
  // exercises the dedupe invariant directly.
  it('never exceeds the cap and never duplicates a node id for any node set', () => {
    // ids drawn from a small pool so collisions are frequent across varied
    // array lengths (including lengths well above and below the cap).
    const idArb = fc.integer({ min: 0, max: 30 }).map((n) => `n${n}`)
    const nodesArb = fc.array(idArb, { minLength: 0, maxLength: 60 }).map((ids) => ids.map((id) => node(id)))

    fc.assert(
      fc.property(nodesArb, (nodes) => {
        const targets = pickSeedTargets(nodes)
        const ids = targets.map((t) => t.id)

        // Bounded: never more than the cap.
        expect(targets.length).toBeLessThanOrEqual(RECOMMENDED_LIMIT)

        // Deduplicated: no node id appears twice in the output.
        expect(new Set(ids).size).toBe(ids.length)
      }),
      { numRuns: 200 },
    )
  })
})
