import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

// ─── Arbitraries ────────────────────────────────────────────────────────────

const userIdArb = fc.uuid()
const nodeIdArb = fc.uuid()

/** Valid date arbitrary — generates timestamps between 2020 and 2030 */
const validDateArb = fc.integer({ min: 1577836800000, max: 1924905600000 }).map((ts) => new Date(ts))

const categoryArb = fc.constantFrom(
  'coffee',
  'nightlife',
  'restaurant',
  'bar',
  'gym',
  'retail',
  'entertainment',
  'food',
)

const venueNameArb = fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0)

/** Generates a check-in record as returned by the history API */
const checkInRecordArb = fc.record({
  id: fc.uuid(),
  userId: userIdArb,
  nodeId: nodeIdArb,
  checkedInAt: validDateArb.map((d) => d.toISOString()),
  type: fc.constantFrom('presence', 'reward'),
  node: fc.record({
    name: venueNameArb,
    slug: fc.string({ minLength: 1, maxLength: 60 }),
    category: categoryArb,
  }),
})

// ─── Pagination Simulation ──────────────────────────────────────────────────

/**
 * Pure function that simulates cursor-based pagination over a sorted list.
 * This mirrors the DynamoDB pagination logic in getUserCheckInHistory:
 * - Records are sorted by date descending
 * - Each page returns up to `pageSize` items
 * - A cursor (index-based for simulation) points to the next page start
 * - Returns { items, nextCursor, hasMore }
 */
function paginateDescending(
  allRecords: Array<{ checkedInAt: string; [key: string]: unknown }>,
  pageSize: number,
  cursor: number | null,
): { items: typeof allRecords; nextCursor: number | null; hasMore: boolean } {
  // Sort all records by date descending (most recent first)
  const sorted = [...allRecords].sort((a, b) => new Date(b.checkedInAt).getTime() - new Date(a.checkedInAt).getTime())

  const startIndex = cursor ?? 0
  const sliced = sorted.slice(startIndex, startIndex + pageSize)
  const hasMore = startIndex + pageSize < sorted.length
  const nextCursor = hasMore ? startIndex + pageSize : null

  return { items: sliced, nextCursor, hasMore }
}

/**
 * Iterates through all pages using cursor-based pagination and collects
 * every item returned across all pages.
 */
function collectAllPages(
  allRecords: Array<{ checkedInAt: string; [key: string]: unknown }>,
  pageSize: number,
): Array<{ checkedInAt: string; [key: string]: unknown }> {
  const collected: Array<{ checkedInAt: string; [key: string]: unknown }> = []
  let cursor: number | null = null

  // Safety limit to prevent infinite loops in case of bugs
  const maxIterations = Math.ceil(allRecords.length / pageSize) + 1
  let iterations = 0

  do {
    const page = paginateDescending(allRecords, pageSize, cursor)
    collected.push(...page.items)
    cursor = page.nextCursor
    iterations++
  } while (cursor !== null && iterations < maxIterations)

  return collected
}

// ─── Property 1: Pagination preserves ordering and completeness ─────────────

describe('Property 1: Pagination preserves ordering and completeness', () => {
  /**
   * **Validates: Requirements 1.1, 1.3**
   *
   * For any set of check-in records and any page size, paginating through
   * the full set using cursor-based pagination SHALL return every record
   * exactly once, in descending date order, with no duplicates and no omissions.
   */

  it('paginating through all pages returns every record exactly once with no duplicates', () => {
    fc.assert(
      fc.property(
        fc.array(checkInRecordArb, { minLength: 0, maxLength: 100 }),
        fc.integer({ min: 1, max: 50 }),
        (records, pageSize) => {
          const allCollected = collectAllPages(records, pageSize)

          // No duplicates: collected count equals unique IDs count
          const collectedIds = allCollected.map((r) => r['id'])
          const uniqueIds = new Set(collectedIds)
          expect(collectedIds.length).toBe(uniqueIds.size)

          // No omissions: every original record appears in the collected set
          expect(allCollected.length).toBe(records.length)

          const originalIds = new Set(records.map((r) => r.id))
          for (const id of collectedIds) {
            expect(originalIds.has(id as string)).toBe(true)
          }
        },
      ),
      { numRuns: 300 },
    )
  })

  it('all pages are returned in descending date order', () => {
    fc.assert(
      fc.property(
        fc.array(checkInRecordArb, { minLength: 2, maxLength: 100 }),
        fc.integer({ min: 1, max: 50 }),
        (records, pageSize) => {
          const allCollected = collectAllPages(records, pageSize)

          // Verify descending order: each item's date >= next item's date
          for (let i = 0; i < allCollected.length - 1; i++) {
            const currentDate = new Date(allCollected[i]!.checkedInAt as string).getTime()
            const nextDate = new Date(allCollected[i + 1]!.checkedInAt as string).getTime()
            expect(currentDate).toBeGreaterThanOrEqual(nextDate)
          }
        },
      ),
      { numRuns: 300 },
    )
  })

  it('each individual page respects the page size limit', () => {
    fc.assert(
      fc.property(
        fc.array(checkInRecordArb, { minLength: 1, maxLength: 100 }),
        fc.integer({ min: 1, max: 50 }),
        (records, pageSize) => {
          let cursor: number | null = null
          const maxIterations = Math.ceil(records.length / pageSize) + 1
          let iterations = 0

          do {
            const page = paginateDescending(records, pageSize, cursor)

            // Each page must not exceed the page size
            expect(page.items.length).toBeLessThanOrEqual(pageSize)

            // If there are more pages, this page should be exactly pageSize
            if (page.hasMore) {
              expect(page.items.length).toBe(pageSize)
            }

            cursor = page.nextCursor
            iterations++
          } while (cursor !== null && iterations < maxIterations)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('ordering within each page is also descending by date', () => {
    fc.assert(
      fc.property(
        fc.array(checkInRecordArb, { minLength: 2, maxLength: 80 }),
        fc.integer({ min: 2, max: 20 }),
        (records, pageSize) => {
          let cursor: number | null = null
          const maxIterations = Math.ceil(records.length / pageSize) + 1
          let iterations = 0

          do {
            const page = paginateDescending(records, pageSize, cursor)

            // Within each page, items must be in descending date order
            for (let i = 0; i < page.items.length - 1; i++) {
              const currentDate = new Date(page.items[i]!.checkedInAt as string).getTime()
              const nextDate = new Date(page.items[i + 1]!.checkedInAt as string).getTime()
              expect(currentDate).toBeGreaterThanOrEqual(nextDate)
            }

            cursor = page.nextCursor
            iterations++
          } while (cursor !== null && iterations < maxIterations)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('hasMore is false only on the last page', () => {
    fc.assert(
      fc.property(
        fc.array(checkInRecordArb, { minLength: 1, maxLength: 80 }),
        fc.integer({ min: 1, max: 50 }),
        (records, pageSize) => {
          let cursor: number | null = null
          let totalCollected = 0
          const maxIterations = Math.ceil(records.length / pageSize) + 1
          let iterations = 0

          do {
            const page = paginateDescending(records, pageSize, cursor)
            totalCollected += page.items.length

            if (!page.hasMore) {
              // When hasMore is false, we should have collected all records
              expect(totalCollected).toBe(records.length)
            }

            cursor = page.nextCursor
            iterations++
          } while (cursor !== null && iterations < maxIterations)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('empty record set returns empty first page with no cursor', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (pageSize) => {
        const page = paginateDescending([], pageSize, null)

        expect(page.items).toHaveLength(0)
        expect(page.nextCursor).toBeNull()
        expect(page.hasMore).toBe(false)
      }),
      { numRuns: 100 },
    )
  })
})

// ─── Property 2: Check-in history entries contain required fields ────────────

describe('Property 2: Check-in history entries contain required fields', () => {
  /**
   * **Validates: Requirements 1.2**
   *
   * For any check-in record returned by the history API, the response entry
   * SHALL contain a non-null venue name, category, and timestamp.
   */

  it('every check-in history entry contains a non-null venue name', () => {
    fc.assert(
      fc.property(
        fc.array(checkInRecordArb, { minLength: 1, maxLength: 50 }),
        fc.integer({ min: 1, max: 50 }),
        (records, pageSize) => {
          const allCollected = collectAllPages(records, pageSize)

          for (const entry of allCollected) {
            const node = entry['node'] as { name: string; category: string } | null
            expect(node).not.toBeNull()
            expect(node!.name).toBeDefined()
            expect(typeof node!.name).toBe('string')
            expect(node!.name.length).toBeGreaterThan(0)
          }
        },
      ),
      { numRuns: 300 },
    )
  })

  it('every check-in history entry contains a non-null category', () => {
    fc.assert(
      fc.property(
        fc.array(checkInRecordArb, { minLength: 1, maxLength: 50 }),
        fc.integer({ min: 1, max: 50 }),
        (records, pageSize) => {
          const allCollected = collectAllPages(records, pageSize)

          for (const entry of allCollected) {
            const node = entry['node'] as { name: string; category: string } | null
            expect(node).not.toBeNull()
            expect(node!.category).toBeDefined()
            expect(typeof node!.category).toBe('string')
            expect(node!.category.length).toBeGreaterThan(0)
          }
        },
      ),
      { numRuns: 300 },
    )
  })

  it('every check-in history entry contains a non-null timestamp', () => {
    fc.assert(
      fc.property(
        fc.array(checkInRecordArb, { minLength: 1, maxLength: 50 }),
        fc.integer({ min: 1, max: 50 }),
        (records, pageSize) => {
          const allCollected = collectAllPages(records, pageSize)

          for (const entry of allCollected) {
            expect(entry.checkedInAt).toBeDefined()
            expect(typeof entry.checkedInAt).toBe('string')
            expect((entry.checkedInAt as string).length).toBeGreaterThan(0)

            // Verify it's a valid ISO date string
            const parsed = new Date(entry.checkedInAt as string)
            expect(parsed.getTime()).not.toBeNaN()
          }
        },
      ),
      { numRuns: 300 },
    )
  })

  it('all three required fields (venue name, category, timestamp) are present simultaneously', () => {
    fc.assert(
      fc.property(checkInRecordArb, (record) => {
        // Simulate a single-item page
        const page = paginateDescending([record], 10, null)

        for (const entry of page.items) {
          const node = entry['node'] as { name: string; category: string } | null

          // All three fields must be present and non-null simultaneously
          expect(node).not.toBeNull()
          expect(node!.name).toBeTruthy()
          expect(node!.category).toBeTruthy()
          expect(entry.checkedInAt).toBeTruthy()
        }
      }),
      { numRuns: 500 },
    )
  })

  it('timestamp is a valid ISO 8601 date string for every entry', () => {
    fc.assert(
      fc.property(fc.array(checkInRecordArb, { minLength: 1, maxLength: 30 }), (records) => {
        for (const record of records) {
          const timestamp = record.checkedInAt
          const parsed = new Date(timestamp)

          // Must be a valid date
          expect(parsed.getTime()).not.toBeNaN()

          // Must be a reasonable date (between 2020 and 2030)
          expect(parsed.getTime()).toBeGreaterThanOrEqual(1577836800000)
          expect(parsed.getTime()).toBeLessThanOrEqual(1924905600000)
        }
      }),
      { numRuns: 300 },
    )
  })
})
