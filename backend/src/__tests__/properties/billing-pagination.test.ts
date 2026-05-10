/**
 * Property 12: Billing Pagination and Sorting
 *
 * For any set of payment records belonging to a business, the billing endpoint SHALL return
 * at most 20 records per page, sorted by date descending, and the union of all pages SHALL
 * equal the complete set of that business's payment records (no duplicates, no omissions).
 *
 * **Validates: Requirements 9.2**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'

// ─── Pure pagination logic for property testing ──────────────────────────────

interface PaymentRecord {
  paymentId: string
  businessId: string
  amount: number
  type: 'subscription' | 'boost'
  planTier: string
  status: 'succeeded' | 'failed' | 'refunded' | 'pending'
  createdAt: string
  description: string
}

const PAGE_SIZE = 20

/**
 * Simulate the billing pagination logic:
 * - Records sorted by createdAt descending (most recent first)
 * - At most PAGE_SIZE records per page
 * - Cursor-based pagination using the last record's sort key
 */
function paginateBillingRecords(
  allRecords: PaymentRecord[],
  pageSize: number = PAGE_SIZE,
): PaymentRecord[][] {
  // Sort by createdAt descending (matching DynamoDB ScanIndexForward: false)
  const sorted = [...allRecords].sort((a, b) => {
    const skA = `${a.createdAt}#${a.paymentId}`
    const skB = `${b.createdAt}#${b.paymentId}`
    return skB.localeCompare(skA)
  })

  const pages: PaymentRecord[][] = []
  for (let i = 0; i < sorted.length; i += pageSize) {
    pages.push(sorted.slice(i, i + pageSize))
  }

  // If no records, return one empty page
  if (pages.length === 0) {
    pages.push([])
  }

  return pages
}

// ─── Generators ──────────────────────────────────────────────────────────────

const paymentRecordArb = fc.record({
  paymentId: fc.uuid(),
  businessId: fc.constant('biz-test-123'),
  amount: fc.integer({ min: 100, max: 5000000 }),
  type: fc.constantFrom('subscription' as const, 'boost' as const),
  planTier: fc.constantFrom('starter', 'growth', 'pro', 'flex_daily'),
  status: fc.constantFrom('succeeded' as const, 'failed' as const, 'refunded' as const, 'pending' as const),
  createdAt: fc
    .integer({ min: new Date('2024-01-01T00:00:00Z').getTime(), max: new Date('2025-12-31T23:59:59Z').getTime() })
    .map((ts) => new Date(ts).toISOString()),
  description: fc.constantFrom(
    'Growth monthly subscription',
    'Pro monthly subscription',
    'Flex Daily subscription',
    '24h Boost - Node A',
    '48h Boost - Node B',
  ),
})

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property 12: Billing Pagination and Sorting', () => {
  it('each page contains at most 20 records', () => {
    fc.assert(
      fc.property(
        fc.array(paymentRecordArb, { minLength: 0, maxLength: 100 }),
        (records) => {
          const pages = paginateBillingRecords(records)

          for (const page of pages) {
            expect(page.length).toBeLessThanOrEqual(PAGE_SIZE)
          }
        },
      ),
      { numRuns: 100 },
    )
  })

  it('records within each page are sorted by date descending', () => {
    fc.assert(
      fc.property(
        fc.array(paymentRecordArb, { minLength: 2, maxLength: 100 }),
        (records) => {
          const pages = paginateBillingRecords(records)

          for (const page of pages) {
            for (let i = 0; i < page.length - 1; i++) {
              const currentSk = `${page[i]!.createdAt}#${page[i]!.paymentId}`
              const nextSk = `${page[i + 1]!.createdAt}#${page[i + 1]!.paymentId}`
              // Descending order: current should be >= next
              expect(currentSk >= nextSk).toBe(true)
            }
          }
        },
      ),
      { numRuns: 100 },
    )
  })

  it('union of all pages equals the complete set (no duplicates, no omissions)', () => {
    fc.assert(
      fc.property(
        fc.array(paymentRecordArb, { minLength: 0, maxLength: 100 }),
        (records) => {
          const pages = paginateBillingRecords(records)
          const allFromPages = pages.flat()

          // No omissions: total count matches
          expect(allFromPages.length).toBe(records.length)

          // No duplicates: all paymentIds are unique in the output
          const paymentIds = allFromPages.map((r) => r.paymentId)
          const uniqueIds = new Set(paymentIds)
          expect(uniqueIds.size).toBe(paymentIds.length)

          // All original records are present
          const originalIds = new Set(records.map((r) => r.paymentId))
          for (const id of paymentIds) {
            expect(originalIds.has(id)).toBe(true)
          }
        },
      ),
      { numRuns: 100 },
    )
  })

  it('pages are contiguous — last item of page N > first item of page N+1', () => {
    fc.assert(
      fc.property(
        fc.array(paymentRecordArb, { minLength: 21, maxLength: 100 }),
        (records) => {
          const pages = paginateBillingRecords(records)

          for (let p = 0; p < pages.length - 1; p++) {
            const lastOfCurrent = pages[p]![pages[p]!.length - 1]!
            const firstOfNext = pages[p + 1]![0]!

            const lastSk = `${lastOfCurrent.createdAt}#${lastOfCurrent.paymentId}`
            const firstSk = `${firstOfNext.createdAt}#${firstOfNext.paymentId}`

            // In descending order, last of current page should be >= first of next page
            expect(lastSk >= firstSk).toBe(true)
          }
        },
      ),
      { numRuns: 100 },
    )
  })

  it('empty record set returns one empty page', () => {
    const pages = paginateBillingRecords([])
    expect(pages.length).toBe(1)
    expect(pages[0]!.length).toBe(0)
  })

  it('exactly 20 records fit in one page', () => {
    fc.assert(
      fc.property(
        fc.array(paymentRecordArb, { minLength: 20, maxLength: 20 }),
        (records) => {
          const pages = paginateBillingRecords(records)
          expect(pages.length).toBe(1)
          expect(pages[0]!.length).toBe(20)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('21 records produce exactly 2 pages (20 + 1)', () => {
    fc.assert(
      fc.property(
        fc.array(paymentRecordArb, { minLength: 21, maxLength: 21 }),
        (records) => {
          const pages = paginateBillingRecords(records)
          expect(pages.length).toBe(2)
          expect(pages[0]!.length).toBe(20)
          expect(pages[1]!.length).toBe(1)
        },
      ),
      { numRuns: 100 },
    )
  })
})
