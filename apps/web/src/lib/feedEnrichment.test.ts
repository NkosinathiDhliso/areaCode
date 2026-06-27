import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { NodeState } from '@area-code/shared/types'
import {
  filterArchetypeCluster,
  filterLiveGets,
  isAlive,
  isJoinEligible,
  sortFeedItems,
  type FeedType,
  type SortableFeedItem,
} from './feedEnrichment'

/**
 * City Feed pure-helper property tests.
 *
 * Validates: Requirements 11.2.1, 11.2.3, 11.3.2, 11.4.4, 11.6.1, 11.6.2
 */

const ALL_STATES: NodeState[] = ['dormant', 'quiet', 'active', 'buzzing', 'popping']
const ALIVE: ReadonlySet<NodeState> = new Set<NodeState>(['active', 'buzzing', 'popping'])
const stateArb = fc.constantFrom(...ALL_STATES)
const feedTypeArb = fc.constantFrom<FeedType>('checkin', 'milestone', 'live_get', 'archetype_cluster')

describe('Feature: vibe-ranked-browse, Property 10: "Join them?" eligibility', () => {
  it('CTA shown iff friend is still present AND venue pulse state is alive', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.option(stateArb, { nil: null }), (friendPresent, state) => {
        const expected = friendPresent && state != null && ALIVE.has(state)
        expect(isJoinEligible(friendPresent, state)).toBe(expected)
        // isAlive agrees with the alive-state set
        expect(isAlive(state)).toBe(state != null && ALIVE.has(state))
      }),
      { numRuns: 200 },
    )
  })
})

describe('Feature: vibe-ranked-browse, Property 11: archetype cluster membership', () => {
  it('every clustered item matches the consumer archetype; empty when consumer has none', () => {
    const itemArb = fc.record({
      user: fc.record({ archetypeId: fc.option(fc.string({ minLength: 1, maxLength: 6 }), { nil: null }) }),
    })
    fc.assert(
      fc.property(
        fc.array(itemArb, { maxLength: 30 }),
        fc.option(fc.string({ minLength: 1, maxLength: 6 }), { nil: null }),
        (items, consumerId) => {
          const cluster = filterArchetypeCluster(items, consumerId)
          if (consumerId == null) {
            expect(cluster).toEqual([])
          } else {
            for (const c of cluster) expect(c.user.archetypeId).toBe(consumerId)
            // No matching item is dropped
            const expectedCount = items.filter((i) => i.user.archetypeId === consumerId).length
            expect(cluster.length).toBe(expectedCount)
          }
        },
      ),
      { numRuns: 200 },
    )
  })
})

describe('Feature: vibe-ranked-browse, Property 12: live gets exclude non-live', () => {
  it('keeps only event/offer gets with lifecycle "live"', () => {
    const rewardArb = fc.record({
      getCategory: fc.constantFrom('loyalty', 'event', 'offer', undefined),
      lifecycle: fc.constantFrom('upcoming', 'live', 'ended', undefined),
    })
    fc.assert(
      fc.property(fc.array(rewardArb, { maxLength: 30 }), (rewards) => {
        const live = filterLiveGets(rewards)
        for (const r of live) {
          expect(r.lifecycle).toBe('live')
          expect(r.getCategory === 'event' || r.getCategory === 'offer').toBe(true)
        }
        const expected = rewards.filter(
          (r) => (r.getCategory === 'event' || r.getCategory === 'offer') && r.lifecycle === 'live',
        ).length
        expect(live.length).toBe(expected)
      }),
      { numRuns: 200 },
    )
  })
})

describe('Feature: vibe-ranked-browse, Property 14: feed ordering invariant', () => {
  it('cluster pinned first, then happening-now, then reverse-chronological rest; total permutation', () => {
    const itemArb = fc.record({
      feedType: feedTypeArb,
      checkedInAt: fc
        .integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2026, 0, 1) })
        .map((ms) => new Date(ms).toISOString()),
      friendStillPresent: fc.boolean(),
      venuePulseState: fc.option(stateArb, { nil: null }),
    })
    fc.assert(
      fc.property(fc.array(itemArb, { maxLength: 25 }), (items) => {
        const sorted = sortFeedItems(items as SortableFeedItem[])

        // Permutation: same length (no drops/dupes)
        expect(sorted.length).toBe(items.length)

        const isHappening = (i: SortableFeedItem) =>
          i.feedType === 'checkin' && i.friendStillPresent === true && isAlive(i.venuePulseState)
        const rank = (i: SortableFeedItem) => (i.feedType === 'archetype_cluster' ? 0 : isHappening(i) ? 1 : 2)

        // Sections are in order: 0 (cluster) <= 1 (happening) <= 2 (rest)
        for (let k = 1; k < sorted.length; k++) {
          expect(rank(sorted[k - 1]!)).toBeLessThanOrEqual(rank(sorted[k]!))
        }
        // Within happening-now and rest, reverse-chronological
        for (let k = 1; k < sorted.length; k++) {
          const prev = sorted[k - 1]!
          const next = sorted[k]!
          if (rank(prev) === rank(next) && rank(prev) !== 0) {
            expect(Date.parse(prev.checkedInAt)).toBeGreaterThanOrEqual(Date.parse(next.checkedInAt))
          }
        }
      }),
      { numRuns: 200 },
    )
  })
})
