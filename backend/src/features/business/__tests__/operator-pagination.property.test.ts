/**
 * Property 7: Operator pagination round-trip preserves order and identity.
 *
 * Validates: Requirements 6.2, 6.4
 *
 * For any seeded set of `BoosterPurchase` rows belonging to a single
 * `businessId`, traversing `service.listBoosterPurchasesForBusiness` page by
 * page at `limit=25` until `nextCursor` is `null` shall:
 *
 *   - Return each row exactly once across the union of pages (R6.2).
 *   - Return rows in `paidAt`-descending order across the union (R6.2 — the
 *     repo issues the underlying `Query` with `ScanIndexForward=false` so
 *     `sk` lexicographic descending corresponds to `paidAt` descending given
 *     the `sk = BOOST#<paidAt>#<yocoCheckoutId>` shape).
 *
 * Separately, the service shall reject a malformed cursor with the
 * underlying `MalformedCursorError` from the repo, which the handler maps to
 * 400 (R6.4).
 *
 * Strategy:
 *   The DynamoDB document client is mocked via `vi.mock` of
 *   `'../../../shared/db/dynamodb.js'`. The mock implements `QueryCommand`
 *   for `pk = BOOST#<businessId>` honouring `ScanIndexForward=false`,
 *   `Limit`, and `ExclusiveStartKey`/`LastEvaluatedKey` so the cursor
 *   encoding in the repository round-trips through the mock the same way
 *   it would through real DynamoDB. The mock sorts rows by `sk` descending,
 *   which gives `paidAt`-descending due to the
 *   `sk = BOOST#<paidAt>#<yocoCheckoutId>` shape.
 */

import * as fc from 'fast-check'
import { describe, it, expect, vi } from 'vitest'

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  // Per-test in-memory store keyed by `pk`.
  let store: Map<string, Array<Record<string, unknown>>> = new Map()

  const sendMock = vi.fn(async (cmd: unknown) => {
    const input = (cmd as { input?: Record<string, unknown> })?.input ?? {}

    // Duck-type to QueryCommand: only the repo's `Query` calls carry a
    // `KeyConditionExpression` against `pk = :pk`. The repo currently issues
    // no other DynamoDB commands on `listBoosterPurchasesForBusiness`'s code
    // path so a default empty response is safe for everything else.
    if ('KeyConditionExpression' in input) {
      const pk = (input['ExpressionAttributeValues'] as Record<string, unknown> | undefined)?.[':pk'] as
        | string
        | undefined
      if (typeof pk !== 'string') return { Items: [] }

      const limit = (input['Limit'] as number | undefined) ?? 25
      const scanForward = input['ScanIndexForward'] !== false
      const exclusiveStartKey = input['ExclusiveStartKey'] as { pk: string; sk: string } | undefined

      const partition = (store.get(pk) ?? []).slice() as Array<{ pk: string; sk: string }>
      partition.sort((a, b) => {
        if (a.sk < b.sk) return scanForward ? -1 : 1
        if (a.sk > b.sk) return scanForward ? 1 : -1
        return 0
      })

      let startIdx = 0
      if (exclusiveStartKey) {
        const idx = partition.findIndex((r) => r.pk === exclusiveStartKey.pk && r.sk === exclusiveStartKey.sk)
        startIdx = idx >= 0 ? idx + 1 : 0
      }

      const page = partition.slice(startIdx, startIdx + limit)
      const hasMore = startIdx + limit < partition.length
      const last = page[page.length - 1]

      return {
        Items: page,
        LastEvaluatedKey: hasMore && last ? { pk: last.pk, sk: last.sk } : undefined,
      }
    }

    return {}
  })

  return {
    sendMock,
    seed(rows: Array<Record<string, unknown>>): void {
      store = new Map()
      for (const row of rows) {
        const pk = row['pk'] as string
        const arr = store.get(pk) ?? []
        arr.push(row)
        store.set(pk, arr)
      }
    },
  }
})

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.sendMock },
  TableNames: {
    users: 'users',
    nodes: 'nodes',
    checkins: 'checkins',
    rewards: 'rewards',
    businesses: 'businesses',
    appData: 'app-data',
    musicSchedules: 'music-schedules',
  },
}))

// Imports must come AFTER the `vi.mock` so the module-level singletons in the
// repo pick up the stubbed `documentClient`.
import { MalformedCursorError } from '../repository.js'
import { listBoosterPurchasesForBusiness } from '../service.js'
import { type BoosterPurchaseRow } from '../types.js'

// ─── Arbitraries ────────────────────────────────────────────────────────────

const FIXED_BUSINESS_ID = 'biz-pagination-test'

const wordDashStringArb = (minLength: number, maxLength: number) =>
  fc.string({
    minLength,
    maxLength,
    unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split('')),
  })

const nodeIdArb = wordDashStringArb(1, 64)
const yocoCheckoutIdArb = wordDashStringArb(1, 128)
const neighbourhoodIdArb = wordDashStringArb(1, 64)

const durationArb = fc.constantFrom('2hr', '6hr', '24hr') as fc.Arbitrary<'2hr' | '6hr' | '24hr'>
const tierArb = fc.constantFrom('starter', 'growth', 'pro', 'payg') as fc.Arbitrary<
  'starter' | 'growth' | 'pro' | 'payg'
>

/** ISO 8601 ms-precision UTC timestamp between 2000-01-01 and 2100-01-01. */
const isoMillisUtcArb = fc
  .integer({ min: 946_684_800_000, max: 4_102_444_800_000 })
  .map((ms) => new Date(ms).toISOString())

const amountCentsArb = fc.integer({ min: 1, max: 10_000_000 })
const floorAtPurchaseCentsArb = fc.integer({ min: 1, max: 1_000_000 })

const boosterPurchaseRowArb: fc.Arbitrary<BoosterPurchaseRow> = fc
  .record({
    nodeId: nodeIdArb,
    duration: durationArb,
    amountCents: amountCentsArb,
    yocoCheckoutId: yocoCheckoutIdArb,
    paidAt: isoMillisUtcArb,
    tierSnapshot: tierArb,
    neighbourhoodIdSnapshot: fc.option(neighbourhoodIdArb, { nil: null }),
    floorAtPurchaseCents: floorAtPurchaseCentsArb,
    createdAt: isoMillisUtcArb,
  })
  .map((parts) => ({
    pk: `BOOST#${FIXED_BUSINESS_ID}`,
    sk: `BOOST#${parts.paidAt}#${parts.yocoCheckoutId}`,
    gsi1pk: 'BOOST_BY_TIME' as const,
    gsi1sk: parts.paidAt,
    businessId: FIXED_BUSINESS_ID,
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

/** Up to 100 rows with unique `yocoCheckoutId`s (and therefore unique `sk`s). */
const seedSetArb = fc.uniqueArray(boosterPurchaseRowArb, {
  minLength: 0,
  maxLength: 100,
  selector: (row) => row.yocoCheckoutId,
})

// ─── Property 7: pagination round-trip ──────────────────────────────────────

describe('Property 7: operator pagination round-trip preserves order and identity', () => {
  it('union of pages contains every seed row exactly once, paidAt-descending', { timeout: 60_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(seedSetArb, async (rows) => {
        mocks.seed(rows)

        const collected: Array<{ yocoCheckoutId: string; paidAt: string }> = []
        let cursor: string | null = null
        let pageCount = 0
        const maxPages = Math.ceil(rows.length / 25) + 2 // safety bound

        do {
          const result = await listBoosterPurchasesForBusiness(FIXED_BUSINESS_ID, cursor, 25)
          for (const item of result.items) {
            collected.push({ yocoCheckoutId: item.yocoCheckoutId, paidAt: item.paidAt })
          }
          cursor = result.nextCursor
          pageCount++
          if (pageCount > maxPages) {
            throw new Error(`Pagination failed to terminate after ${pageCount} pages (rows=${rows.length})`)
          }
        } while (cursor !== null)

        // Total count matches seed count.
        expect(collected.length).toBe(rows.length)

        // Each row appears exactly once across the union of pages.
        const collectedIds = new Set(collected.map((r) => r.yocoCheckoutId))
        expect(collectedIds.size).toBe(collected.length)

        const seedIds = new Set(rows.map((r) => r.yocoCheckoutId))
        expect(collectedIds).toEqual(seedIds)

        // Union is paidAt-descending (non-strict — ties are allowed when two
        // rows happen to share the same paidAt timestamp; the secondary sk
        // ordering on yocoCheckoutId disambiguates the tie deterministically).
        for (let i = 1; i < collected.length; i++) {
          const prev = collected[i - 1]!.paidAt
          const curr = collected[i]!.paidAt
          expect(curr <= prev).toBe(true)
        }
      }),
      { numRuns: 25 },
    )
  })
})

// ─── Malformed-cursor rejection ─────────────────────────────────────────────

const malformedCursorArb = fc.oneof(
  fc.constant('###NOT-BASE64###'),
  fc.constant('%%%not-json%%%'),
  fc.constant('!@#$%^&*'),
  fc.constant('not a cursor'),
  // base64url("[1,2]") — decodes to JSON but to an array, which the repo's
  // `decodeCursor` rejects (it requires a non-array object).
  fc.constant(Buffer.from('[1,2]').toString('base64url')),
  // base64url("null") — decodes to JSON null, which the repo also rejects.
  fc.constant(Buffer.from('null').toString('base64url')),
  // Random short strings that are extremely unlikely to round-trip to a
  // non-array object after base64url+JSON.parse.
  fc.string({ minLength: 1, maxLength: 32 }).filter((s) => {
    try {
      const decoded = Buffer.from(s, 'base64url').toString()
      if (decoded.length === 0) return true
      const parsed = JSON.parse(decoded)
      return parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
    } catch {
      return true
    }
  }),
)

describe('malformed cursor is rejected with MalformedCursorError (R6.4)', () => {
  it('throws MalformedCursorError for arbitrary garbage cursor strings', async () => {
    await fc.assert(
      fc.asyncProperty(malformedCursorArb, async (garbage) => {
        mocks.seed([])
        await expect(listBoosterPurchasesForBusiness('any-id', garbage, 25)).rejects.toBeInstanceOf(
          MalformedCursorError,
        )
      }),
      { numRuns: 25 },
    )
  })

  it('throws MalformedCursorError for the literal example from the task description', async () => {
    mocks.seed([])
    await expect(listBoosterPurchasesForBusiness('any-id', '###NOT-BASE64###', 25)).rejects.toBeInstanceOf(
      MalformedCursorError,
    )
  })
})
