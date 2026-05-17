/**
 * Property 6: Admin date-range query result-set with range-validation gate.
 *
 * For any seeded set of `BoosterPurchase` rows and any `(fromIso, toIso)` pair:
 *
 *   (a) When `from > to` OR `(to - from) > 367 days`, the service rejects with
 *       `AppError` status 400 AND issues no DynamoDB call (verified by spying
 *       on the mocked `documentClient`).
 *   (b) Otherwise, the union of paginated results equals exactly the set of
 *       seeded rows whose `paidAt ∈ [from, to]` (boundary-inclusive).
 *
 * Strategy:
 *   - The function under test is `service.listBoosterPurchasesByDateRange`.
 *   - We mock `documentClient` from `'../../../shared/db/dynamodb.js'` with an
 *     in-memory `QueryCommand` simulator that respects `IndexName='GSI1'`,
 *     `gsi1pk='BOOST_BY_TIME'`, `gsi1sk BETWEEN :from AND :to`, `Limit`, and
 *     `ExclusiveStartKey` / `LastEvaluatedKey`.
 *   - We track `sendMock` call count so the invalid-range branch can assert
 *     "no DB call when validation fails."
 *   - The set-equality assertion uses `(businessId, paidAt, yocoCheckoutId)` as
 *     the row's identifying triple — those are the fields the
 *     `AdminBoosterPurchaseView` projection preserves verbatim.
 *
 * Validates: Requirements 7.2, 7.4, 7.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'

import { AppError } from '../../../shared/errors/AppError.js'
import type { BoosterPurchaseRow, BoostDuration } from '../types.js'

// ─── In-memory `documentClient.send` test double ────────────────────────────
//
// `vi.hoisted` runs before the `vi.mock` factory so the spy reference inside
// the factory is guaranteed to be defined at module-init time. The closure
// reads from a mutable `state.seededRows` array so per-iteration seeding is
// just a property mutation.

const mocks = vi.hoisted(() => {
  const state: { seededRows: Array<Record<string, unknown>> } = { seededRows: [] }

  const sendMock = vi.fn(async (cmd: unknown) => {
    const input = (cmd as { input?: Record<string, unknown> })?.input ?? {}

    // Date-range Query against GSI1 — the only operation `queryBoosterPurchasesByTimeRange` issues.
    if (input['IndexName'] === 'GSI1') {
      const eav = input['ExpressionAttributeValues'] as Record<string, string>
      const fromIso = eav[':from'] ?? ''
      const toIso = eav[':to'] ?? ''
      const limit = (input['Limit'] as number) ?? 25
      const startKey = input['ExclusiveStartKey'] as
        | { pk: string; sk: string; gsi1pk: string; gsi1sk: string }
        | undefined

      // Filter to rows in `[from, to]` on `gsi1sk`, sorted newest-first to
      // mirror the repo's `ScanIndexForward: false` (the test asserts set
      // equality so ordering does not affect correctness, but matching the
      // production order makes the simulator easier to reason about).
      const matching = state.seededRows
        .filter(
          (r) =>
            r['gsi1pk'] === 'BOOST_BY_TIME' &&
            typeof r['gsi1sk'] === 'string' &&
            (r['gsi1sk'] as string) >= fromIso &&
            (r['gsi1sk'] as string) <= toIso,
        )
        .sort((a, b) => {
          const skA = a['gsi1sk'] as string
          const skB = b['gsi1sk'] as string
          if (skA !== skB) return skB.localeCompare(skA)
          // Tiebreak on table sk so pagination is deterministic.
          return (b['sk'] as string).localeCompare(a['sk'] as string)
        })

      let startIndex = 0
      if (startKey) {
        const idx = matching.findIndex((r) => r['pk'] === startKey.pk && r['sk'] === startKey.sk)
        startIndex = idx >= 0 ? idx + 1 : matching.length
      }

      const page = matching.slice(startIndex, startIndex + limit)
      const hasMore = startIndex + limit < matching.length
      const lastEval =
        hasMore && page.length > 0
          ? {
              pk: page[page.length - 1]!['pk'] as string,
              sk: page[page.length - 1]!['sk'] as string,
              gsi1pk: page[page.length - 1]!['gsi1pk'] as string,
              gsi1sk: page[page.length - 1]!['gsi1sk'] as string,
            }
          : undefined

      return { Items: page, LastEvaluatedKey: lastEval }
    }

    // No other DynamoDB operations are expected from the SUT.
    return { Items: [] }
  })

  return { state, sendMock }
})

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.sendMock },
  TableNames: {
    appData: 'app-data',
    users: 'users',
    nodes: 'nodes',
    checkins: 'checkins',
    rewards: 'rewards',
    businesses: 'businesses',
    musicSchedules: 'music-schedules',
  },
}))

// Import the SUT *after* the mocks are installed.
import { listBoosterPurchasesByDateRange } from '../service.js'
import { ADMIN_BOOST_REPORT_MAX_RANGE_DAYS } from '../types.js'

// ─── Arbitraries ────────────────────────────────────────────────────────────

const RANGE_MS = ADMIN_BOOST_REPORT_MAX_RANGE_DAYS * 24 * 60 * 60 * 1000

// Wide but bounded window so generated `fromIso`/`toIso` and seeded row
// `paidAt` values share enough overlap to exercise the boundary-inclusive
// filter without burning runs on disjoint sets.
const MIN_TIME_MS = Date.UTC(2024, 0, 1)
const MAX_TIME_MS = Date.UTC(2030, 0, 1)

const wordDashStringArb = (min: number, max: number) =>
  fc.string({
    minLength: min,
    maxLength: max,
    unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split('')),
  })

const businessIdArb = wordDashStringArb(1, 64)
const nodeIdArb = wordDashStringArb(1, 64)
const yocoCheckoutIdArb = wordDashStringArb(1, 128)
const neighbourhoodIdArb = wordDashStringArb(1, 64)
const durationArb: fc.Arbitrary<BoostDuration> = fc.constantFrom('2hr', '6hr', '24hr')
const tierArb = fc.constantFrom('starter', 'growth', 'pro', 'payg') as fc.Arbitrary<
  'starter' | 'growth' | 'pro' | 'payg'
>
const isoMillisArb = fc.integer({ min: MIN_TIME_MS, max: MAX_TIME_MS }).map((ms) => new Date(ms).toISOString())

const boosterPurchaseRowArb: fc.Arbitrary<BoosterPurchaseRow> = fc
  .record({
    businessId: businessIdArb,
    nodeId: nodeIdArb,
    duration: durationArb,
    amountCents: fc.integer({ min: 1, max: 10_000_000 }),
    yocoCheckoutId: yocoCheckoutIdArb,
    paidAt: isoMillisArb,
    tierSnapshot: tierArb,
    neighbourhoodIdSnapshot: fc.option(neighbourhoodIdArb, { nil: null }),
    floorAtPurchaseCents: fc.integer({ min: 1, max: 1_000_000 }),
    createdAt: isoMillisArb,
  })
  .map((parts) => ({
    pk: `BOOST#${parts.businessId}`,
    sk: `BOOST#${parts.paidAt}#${parts.yocoCheckoutId}`,
    gsi1pk: 'BOOST_BY_TIME' as const,
    gsi1sk: parts.paidAt,
    businessId: parts.businessId,
    nodeId: parts.nodeId,
    duration: parts.duration,
    amountCents: parts.amountCents,
    currency: 'ZAR' as const,
    yocoCheckoutId: parts.yocoCheckoutId,
    paidAt: parts.paidAt,
    tierSnapshot: parts.tierSnapshot,
    neighbourhoodIdSnapshot: parts.neighbourhoodIdSnapshot,
    floorAtPurchaseCents: parts.floorAtPurchaseCents,
    createdAt: parts.createdAt,
  }))

/**
 * Dedupe seeded rows by `(pk, sk)` so the in-memory store has no exact-key
 * collisions — DynamoDB enforces uniqueness on its primary key, so the
 * test corpus must too.
 */
function dedupeByPkSk(rows: BoosterPurchaseRow[]): BoosterPurchaseRow[] {
  const seen = new Set<string>()
  const out: BoosterPurchaseRow[] = []
  for (const r of rows) {
    const key = `${r.pk}|${r.sk}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(r)
    }
  }
  return out
}

const seedSetArb = fc.array(boosterPurchaseRowArb, { minLength: 0, maxLength: 60 }).map(dedupeByPkSk)

// ─── Range arbitraries: valid, inverted, over-cap ───────────────────────────

type RangeClass = 'valid' | 'inverted' | 'over-cap'
type GeneratedRange = { fromIso: string; toIso: string; classification: RangeClass }

/** `from <= to` AND `(to - from) <= 367 days` — service accepts. */
const validRangeArb: fc.Arbitrary<GeneratedRange> = fc
  .tuple(fc.integer({ min: MIN_TIME_MS, max: MAX_TIME_MS }), fc.integer({ min: 0, max: RANGE_MS }))
  .map(([fromMs, deltaMs]) => ({
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(fromMs + deltaMs).toISOString(),
    classification: 'valid' as const,
  }))

/** `from > to` — service rejects with 400 before any DynamoDB call. */
const invertedRangeArb: fc.Arbitrary<GeneratedRange> = fc
  .tuple(fc.integer({ min: MIN_TIME_MS + 1, max: MAX_TIME_MS }), fc.integer({ min: 1, max: RANGE_MS }))
  .map(([toMs, deltaMs]) => ({
    fromIso: new Date(toMs).toISOString(),
    toIso: new Date(toMs - deltaMs).toISOString(),
    classification: 'inverted' as const,
  }))

/** `(to - from) > 367 days` — service rejects with 400 before any DynamoDB call. */
const overCapRangeArb: fc.Arbitrary<GeneratedRange> = fc
  .tuple(
    fc.integer({ min: MIN_TIME_MS, max: MIN_TIME_MS + RANGE_MS }),
    fc.integer({ min: RANGE_MS + 1, max: 5 * RANGE_MS }),
  )
  .map(([fromMs, deltaMs]) => ({
    fromIso: new Date(fromMs).toISOString(),
    toIso: new Date(fromMs + deltaMs).toISOString(),
    classification: 'over-cap' as const,
  }))

const rangeArb = fc.oneof(validRangeArb, invertedRangeArb, overCapRangeArb)

// ─── Test suite ─────────────────────────────────────────────────────────────

beforeEach(() => {
  mocks.state.seededRows = []
  mocks.sendMock.mockClear()
})

describe('Property 6: admin date-range query result-set with range-validation gate', () => {
  /**
   * **Validates: Requirements 7.2, 7.4, 7.5**
   *
   * (a) Invalid range (inverted or over-cap) → AppError(400) AND no DynamoDB call.
   * (b) Valid range → union of paginated results equals exactly the set of
   *     seeded rows whose `paidAt ∈ [from, to]` (boundary-inclusive).
   */
  it('rejects invalid ranges with 400 and never calls DynamoDB; valid ranges paginate to the exact filtered set', async () => {
    await fc.assert(
      fc.asyncProperty(seedSetArb, rangeArb, async (rows, range) => {
        // Re-seed and reset call history per iteration.
        mocks.state.seededRows = rows as unknown as Array<Record<string, unknown>>
        mocks.sendMock.mockClear()

        if (range.classification !== 'valid') {
          // (a) Service must reject with AppError(400) and never touch DynamoDB.
          let thrown: unknown = null
          try {
            await listBoosterPurchasesByDateRange(range.fromIso, range.toIso, null, 25)
          } catch (err) {
            thrown = err
          }
          expect(thrown).toBeInstanceOf(AppError)
          expect((thrown as AppError).statusCode).toBe(400)
          expect(mocks.sendMock).not.toHaveBeenCalled()
          return
        }

        // (b) Valid range: drive pagination to completion and assert set equality
        // against the boundary-inclusive in-memory filter.
        const expected = rows.filter((r) => r.gsi1sk >= range.fromIso && r.gsi1sk <= range.toIso)

        type CollectedRow = { businessId: string; paidAt: string; yocoCheckoutId: string }
        const collected: CollectedRow[] = []
        let cursor: string | null = null

        // Use `limit=5` to force multi-page traversal even with small seeded sets.
        // Hard upper bound on iterations as a safety rail against runaway cursors.
        for (let safety = 0; safety < 200; safety++) {
          const page = await listBoosterPurchasesByDateRange(range.fromIso, range.toIso, cursor, 5)
          collected.push(...page.items)
          if (page.nextCursor === null) break
          cursor = page.nextCursor
        }

        // Identify rows by `(businessId, paidAt, yocoCheckoutId)` — the unique
        // triple preserved by the `AdminBoosterPurchaseView` projection and
        // the underlying `(pk, sk)` key.
        const toKey = (r: { businessId: string; paidAt: string; yocoCheckoutId: string }) =>
          `${r.businessId}|${r.paidAt}|${r.yocoCheckoutId}`

        const expectedKeys = new Set(expected.map(toKey))
        const collectedKeys = new Set(collected.map(toKey))

        // No row appears more than once across pages.
        expect(collected.length).toBe(expected.length)
        // Set equality of the union vs. the in-memory filter.
        expect(collectedKeys).toEqual(expectedKeys)
      }),
      { numRuns: 100 },
    )
  })
})
