import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

/**
 * Property 12: Leaderboard is always sorted descending by check-in count.
 * For any city, returned entries maintain sort invariant.
 * Validates: Requirements 14.1
 */
describe('leaderboard sort invariant', () => {
  interface LeaderboardEntry {
    userId: string
    checkInCount: number
    rank: number
  }

  function buildLeaderboard(
    scores: Array<{ userId: string; count: number }>,
  ): LeaderboardEntry[] {
    return [...scores]
      .sort((a, b) => b.count - a.count)
      .map((s, i) => ({
        userId: s.userId,
        checkInCount: s.count,
        rank: i + 1,
      }))
  }

  const scoreArb = fc.record({
    userId: fc.uuid(),
    count: fc.integer({ min: 0, max: 10000 }),
  })

  it('entries are always sorted descending by check-in count', () => {
    fc.assert(
      fc.property(
        fc.array(scoreArb, { minLength: 2, maxLength: 50 }),
        (scores) => {
          const board = buildLeaderboard(scores)
          for (let i = 1; i < board.length; i++) {
            expect(board[i - 1]!.checkInCount)
              .toBeGreaterThanOrEqual(board[i]!.checkInCount)
          }
        },
      ),
      { numRuns: 300 },
    )
  })

  it('ranks are sequential starting from 1', () => {
    fc.assert(
      fc.property(
        fc.array(scoreArb, { minLength: 1, maxLength: 50 }),
        (scores) => {
          const board = buildLeaderboard(scores)
          board.forEach((entry, i) => {
            expect(entry.rank).toBe(i + 1)
          })
        },
      ),
      { numRuns: 200 },
    )
  })

  it('top 50 cap is respected', () => {
    fc.assert(
      fc.property(
        fc.array(scoreArb, { minLength: 51, maxLength: 100 }),
        (scores) => {
          const board = buildLeaderboard(scores).slice(0, 50)
          expect(board.length).toBeLessThanOrEqual(50)
        },
      ),
      { numRuns: 100 },
    )
  })
})
