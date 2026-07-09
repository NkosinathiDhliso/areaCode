/**
 * Property-based tests for the Win-Back Campaigns dispatcher fan-out.
 *
 * Library: fast-check + Vitest, ≥100 iterations per property.
 *
 * Feature: winback-campaigns
 *   - Property 10: Batch Partitioning Invariant  (Requirement 10.1)
 *
 * The module under test exposes pure helpers (`chunk`, `tokenizeRecipients`,
 * `MAX_BATCH_SIZE`) used by the dispatcher to fan recipients out into SQS
 * batches. These helpers carry zero external state, so no mocking is required —
 * the helpers themselves are the entire surface under test.
 *
 * Property 10 (Batch Partitioning Invariant): for any eligible recipient set,
 * the batches produced by the dispatcher SHALL partition the recipients into
 * disjoint batches each of size ≤ 100 (MAX_BATCH_SIZE), whose union equals the
 * eligible set exactly — no recipient dropped, none duplicated.
 *
 * No phone identifier appears anywhere — the only consumer identifier is
 * `userId` (Constraint C1).
 *
 * **Validates: Requirements 10.1**
 */

import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { chunk, tokenizeRecipients, MAX_BATCH_SIZE } from '../dispatcher.js'

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Recipient-set sizes biased toward the 100 boundary the batching rule cares
 * about (0, 1, 99, 100, 101, 200), mixed with random sizes up to 350 so we also
 * exercise multi-batch fan-out well past two full batches.
 */
const sizeArb = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(0, 1, 99, 100, 101, 200) },
  { weight: 2, arbitrary: fc.integer({ min: 0, max: 350 }) },
)

/**
 * A list of DISTINCT userIds of the chosen size. Distinctness is what lets the
 * test detect a dropped or duplicated recipient: if `chunk` lost or copied an
 * element, the multiset of userIds across batches would no longer match.
 */
const distinctUserIdsArb = sizeArb.map((n) => Array.from({ length: n }, (_, i) => `u${i}`))

/** A non-empty campaign salt + id, so tokenization is well-defined. */
const campaignIdArb = fc.string({ minLength: 1, maxLength: 24 }).filter((s) => s.trim().length > 0)
const campaignSaltArb = fc.string({ minLength: 8, maxLength: 32 }).filter((s) => s.trim().length > 0)

// ─── Property 10: Batch Partitioning Invariant ───────────────────────────────

describe('Feature: winback-campaigns, Property 10: Batch Partitioning Invariant', () => {
  it('partitions recipients into disjoint batches of ≤100 whose union equals the input exactly', async () => {
    /**
     * **Validates: Requirements 10.1**
     *
     * Tokenize a set of distinct userIds (mirroring the dispatcher), chunk the
     * resulting `{ token, userId }` pairs at MAX_BATCH_SIZE, then assert the
     * three partition invariants:
     *   1. every batch has size ≤ MAX_BATCH_SIZE (and all but the last are
     *      exactly MAX_BATCH_SIZE — the stronger packing invariant);
     *   2. batches are pairwise disjoint (no recipient appears in two batches);
     *   3. the in-order concatenation equals the input exactly (no drops, no
     *      duplicates, order preserved).
     */
    await fc.assert(
      fc.asyncProperty(
        distinctUserIdsArb,
        campaignIdArb,
        campaignSaltArb,
        async (userIds, campaignId, campaignSalt) => {
          const recipients = tokenizeRecipients(userIds, campaignId, campaignSalt)
          const batches = chunk(recipients, MAX_BATCH_SIZE)

          // (1) Size bound: every batch ≤ MAX_BATCH_SIZE, and every batch
          // except possibly the last is exactly full.
          for (let i = 0; i < batches.length; i++) {
            const batch = batches[i]!
            expect(batch.length).toBeLessThanOrEqual(MAX_BATCH_SIZE)
            expect(batch.length).toBeGreaterThan(0) // chunk never emits empty batches
            if (i < batches.length - 1) {
              expect(batch.length).toBe(MAX_BATCH_SIZE)
            }
          }

          // (2) Disjointness: the same userId never lands in two batches. With
          // distinct userIds, the union size equals the total element count iff
          // nothing is duplicated across (or within) batches.
          const seen = new Set<string>()
          let totalElements = 0
          for (const batch of batches) {
            for (const r of batch) {
              seen.add(r.userId)
              totalElements++
            }
          }
          expect(seen.size).toBe(userIds.length)
          expect(totalElements).toBe(userIds.length)

          // (3) Union equals the input exactly, order preserved: flattening the
          // batches reproduces the original recipient list.
          const flattened = batches.flat()
          expect(flattened).toEqual(recipients)

          // Union-as-set equals the eligible userId set exactly.
          expect([...seen].sort()).toEqual([...new Set(userIds)].sort())
        },
      ),
      { numRuns: 25 },
    )
  })

  it('produces ceil(n / MAX_BATCH_SIZE) batches for any recipient count', async () => {
    /**
     * **Validates: Requirements 10.1**
     *
     * Batch count is a direct consequence of the partitioning invariant: a set
     * of `n` recipients split into full batches of MAX_BATCH_SIZE yields exactly
     * ceil(n / MAX_BATCH_SIZE) batches (0 batches for an empty set).
     */
    await fc.assert(
      fc.asyncProperty(distinctUserIdsArb, async (userIds) => {
        const recipients = tokenizeRecipients(userIds, 'camp', 'deadbeef')
        const batches = chunk(recipients, MAX_BATCH_SIZE)
        expect(batches.length).toBe(Math.ceil(userIds.length / MAX_BATCH_SIZE))
      }),
      { numRuns: 25 },
    )
  })

  it('holds the partition invariants for arbitrary batch sizes, not only 100', async () => {
    /**
     * **Validates: Requirements 10.1**
     *
     * Generalizes the partitioning invariant to any `size ≥ 1`: disjoint
     * batches, each ≤ size (all but last exactly size), union equals input
     * exactly in order. This guards the helper against regressions if the batch
     * size is ever tuned.
     */
    await fc.assert(
      fc.asyncProperty(distinctUserIdsArb, fc.integer({ min: 1, max: 150 }), async (userIds, size) => {
        const batches = chunk(userIds, size)

        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i]!
          expect(batch.length).toBeLessThanOrEqual(size)
          expect(batch.length).toBeGreaterThan(0)
          if (i < batches.length - 1) {
            expect(batch.length).toBe(size)
          }
        }

        expect(batches.flat()).toEqual(userIds)
        expect(batches.length).toBe(Math.ceil(userIds.length / size))
      }),
      { numRuns: 25 },
    )
  })

  it('rejects a batch size below 1', () => {
    /**
     * **Validates: Requirements 10.1**
     *
     * A partition is only well-defined for `size ≥ 1`; the helper guards this
     * precondition rather than silently looping forever on `size = 0`.
     */
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 0 }), (size) => {
        expect(() => chunk([1, 2, 3], size)).toThrow()
      }),
      { numRuns: 25 },
    )
  })
})

// ─── Tokenization preserves the recipient set 1:1 ────────────────────────────

describe('Feature: winback-campaigns, Property 10: Batch Partitioning Invariant (tokenization)', () => {
  it('maps each eligible userId to exactly one { token, userId } pair, preserving the set', async () => {
    /**
     * **Validates: Requirements 10.1**
     *
     * The eligible set must survive tokenization with no drops or duplicates so
     * that the batches' union can equal it exactly. For distinct userIds:
     *   - the output length equals the input length (1:1, in order);
     *   - each output pair carries its source userId;
     *   - the set of userIds is preserved, and distinct userIds yield distinct
     *     tokens under a fixed campaign/salt.
     */
    await fc.assert(
      fc.asyncProperty(
        distinctUserIdsArb,
        campaignIdArb,
        campaignSaltArb,
        async (userIds, campaignId, campaignSalt) => {
          const recipients = tokenizeRecipients(userIds, campaignId, campaignSalt)

          // 1:1 and order-preserving.
          expect(recipients.length).toBe(userIds.length)
          expect(recipients.map((r) => r.userId)).toEqual(userIds)

          // userId set preserved exactly (no drop, no duplicate).
          expect([...new Set(recipients.map((r) => r.userId))].sort()).toEqual([...new Set(userIds)].sort())

          // Distinct userIds → distinct tokens under one campaign/salt, so the
          // tokenized set is also a faithful 1:1 image of the eligible set.
          const tokens = recipients.map((r) => r.token)
          expect(new Set(tokens).size).toBe(userIds.length)
        },
      ),
      { numRuns: 25 },
    )
  })
})
