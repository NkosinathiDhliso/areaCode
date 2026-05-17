import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { genresToArchetype } from '../genreToArchetype'
import { MUSIC_GENRES } from '../../constants/genre-weights'
import type { MusicGenre } from '../../types'

/**
 * Property tests for `genresToArchetype` (R6).
 *
 * Property 5 (R6.6, R10.4): Genre → Archetype order-independence.
 *   For any non-empty MusicGenre input of size 1-50, two permutations of the
 *   same multiset SHALL resolve to the same Archetype `id`.
 *
 * Determinism (R6.7): Two consecutive calls with the same input SHALL return
 *   the same Archetype `id` against the same catalog version.
 *
 * The generators use the full `MUSIC_GENRES` catalog from the shared
 * constants module so the test stays in lockstep with the runtime weight
 * matrix (no hand-maintained genre list to drift). Duplicates are allowed
 * because the spec in tasks.md explicitly calls out size 1-50 even though
 * there are only 12 distinct catalog genres -- the function is required to
 * handle duplicates as plain repeat occurrences.
 */

const genreArb = fc.constantFrom<MusicGenre>(...MUSIC_GENRES)

/**
 * Non-empty array of MusicGenre values, length 1-50, duplicates allowed.
 * Matches the task's "size 1-50" wording (R6.1's bounds).
 */
const genreListArb = fc.array(genreArb, { minLength: 1, maxLength: 50 })

/**
 * Produce a uniformly-random permutation of `arr` by tagging each element
 * with a random sort key and sorting. We tie-break on the original index so
 * the result is deterministic for any given (arr, keys) pair, which keeps
 * fast-check's shrinker happy.
 */
function permutationOf<T>(arr: readonly T[]): fc.Arbitrary<T[]> {
  if (arr.length <= 1) return fc.constant(arr.slice())
  return fc
    .array(fc.double({ min: 0, max: 1, noNaN: true }), {
      minLength: arr.length,
      maxLength: arr.length,
    })
    .map((keys) =>
      arr
        .map((value, idx) => ({ value, key: keys[idx]!, idx }))
        .sort((a, b) => a.key - b.key || a.idx - b.idx)
        .map((entry) => entry.value),
    )
}

/**
 * Produce a base list plus two independent permutations of it. We chain so
 * the shrinker can shrink the list and the permutations together.
 */
const listWithTwoPermutationsArb = genreListArb.chain((list) =>
  fc.tuple(fc.constant(list), permutationOf(list), permutationOf(list)),
)

describe('genresToArchetype', () => {
  /**
   * Property 5: Genre → Archetype order-independence.
   * Two permutations of the same multiset of genres resolve to the same id.
   * Validates: Requirements 6.6, 10.4
   */
  it('order-independence: two permutations of the same genre multiset resolve to the same archetype id', () => {
    fc.assert(
      fc.property(listWithTwoPermutationsArb, ([_orig, perm1, perm2]) => {
        const r1 = genresToArchetype(perm1)
        const r2 = genresToArchetype(perm2)
        expect(r1.archetype.id).toBe(r2.archetype.id)
      }),
      { numRuns: 200 },
    )
  })

  /**
   * Property 5 (companion): order-independence also holds when one input
   * is an Array and the other is a Set built from the same elements. This
   * exercises the `Set` branch of the input handling. Sets dedupe, so we
   * compare against an Array of the unique elements rather than the
   * original list.
   * Validates: Requirements 6.6, 10.4
   */
  it('order-independence: Set input matches the dedup-equivalent Array input', () => {
    fc.assert(
      fc.property(genreListArb, (list) => {
        const unique = Array.from(new Set(list))
        const fromArray = genresToArchetype(unique)
        const fromSet = genresToArchetype(new Set(unique))
        expect(fromArray.archetype.id).toBe(fromSet.archetype.id)
      }),
      { numRuns: 200 },
    )
  })

  /**
   * Determinism: two consecutive calls with the same input return the same
   * archetype id (R6.7). The property is implied by R6.6 + purity, but we
   * assert it explicitly so a regression that introduced hidden state
   * (e.g. memoisation by reference identity) would fail loudly.
   * Validates: Requirements 6.7
   */
  it('determinism: two consecutive calls with the same input return the same archetype id', () => {
    fc.assert(
      fc.property(genreListArb, (list) => {
        const r1 = genresToArchetype(list)
        const r2 = genresToArchetype(list)
        expect(r1.archetype.id).toBe(r2.archetype.id)
      }),
      { numRuns: 200 },
    )
  })
})
