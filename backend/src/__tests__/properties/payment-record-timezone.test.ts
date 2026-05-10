/**
 * Property 1: Payment Record Completeness and Idempotency
 *
 * For any valid Yoco payment event processed N times (N >= 1), exactly one payment record
 * SHALL exist in DynamoDB with all required fields (amount, type, planTier, businessId,
 * paymentProvider="yoco", currency="ZAR", status), and the result of processing it N times
 * SHALL be identical to processing it once.
 *
 * Property 18: Timezone Partition Key Correctness
 *
 * For any UTC timestamp, the date portion used in partition keys (e.g., REVENUE#2025-01)
 * SHALL be computed using Africa/Johannesburg timezone (UTC+2), not UTC. Specifically,
 * a payment at 2025-01-31T23:30:00Z SHALL produce partition key REVENUE#2025-02
 * (because it's 2025-02-01T01:30:00 in SAST).
 *
 * **Validates: Requirements 1.1, 1.3, 1.4, 23.6**
 *
 * Uses fast-check with Vitest, minimum 100 iterations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fc from 'fast-check'

// ─── Mock DynamoDB before any imports ────────────────────────────────────────
const mockSend = vi.fn()

vi.mock('../../shared/db/dynamodb.js', () => ({
  documentClient: { send: (...args: unknown[]) => mockSend(...args) },
  TableNames: {
    appData: 'test-app-data',
    nodes: 'test-nodes',
    rewards: 'test-rewards',
  },
}))

vi.mock('../../shared/db/entities.js', () => ({
  generateId: () => `id-${Date.now()}`,
}))

vi.mock('../../features/auth/dynamodb-repository.js', () => ({
  getBusinessById: vi.fn(),
  getBusinessByCognitoSub: vi.fn(),
  updateBusiness: vi.fn(),
  getStaffByBusinessId: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../features/check-in/dynamodb-repository.js', () => ({
  getCheckInsByNode: vi.fn().mockResolvedValue({ checkIns: [] }),
}))

/**
 * Pure function: compute SAST (Africa/Johannesburg, UTC+2) YYYY-MM partition key.
 * Mirrors the implementation in repository.ts for independent testing.
 */
function getRevenuePartitionMonth(isoTimestamp: string): string {
  const date = new Date(isoTimestamp)
  const sastOffset = 2 * 60 * 60 * 1000
  const sastDate = new Date(date.getTime() + sastOffset)
  const year = sastDate.getUTCFullYear()
  const month = String(sastDate.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

describe('Property 1: Payment Record Completeness and Idempotency', () => {
  beforeEach(() => {
    mockSend.mockReset()
  })

  it('all required fields are present in the payment record for any valid event', async () => {
    const { createPaymentRecord } = await import('../../features/business/repository.js')

    // Use a capturing mock that stores the item and resolves
    let lastItem: Record<string, unknown> | null = null
    let lastCondition: string | null = null
    mockSend.mockImplementation((cmd: { input: { Item?: Record<string, unknown>; ConditionExpression?: string } }) => {
      if (cmd.input?.Item) {
        lastItem = cmd.input.Item
        lastCondition = cmd.input.ConditionExpression ?? null
      }
      return Promise.resolve({})
    })

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          paymentId: fc.uuid(),
          businessId: fc.uuid(),
          amount: fc.integer({ min: 100, max: 10000000 }),
          type: fc.constantFrom('subscription' as const, 'boost' as const),
          planTier: fc.constantFrom('starter', 'growth', 'pro', 'flex_daily'),
          nodeId: fc.option(fc.uuid(), { nil: null }),
          status: fc.constantFrom('succeeded' as const, 'failed' as const, 'refunded' as const, 'pending' as const),
          description: fc.string({ minLength: 1, maxLength: 100 }),
          createdAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') })
            .filter(d => !isNaN(d.getTime())).map(d => d.toISOString()),
        }),
        async (input) => {
          lastItem = null
          lastCondition = null

          const result = await createPaymentRecord(input)
          expect(result.duplicate).toBe(false)

          // Verify captured item
          expect(lastItem).not.toBeNull()
          const item = lastItem!

          // Required fields check
          expect(item['paymentId']).toBe(input.paymentId)
          expect(item['businessId']).toBe(input.businessId)
          expect(item['amount']).toBe(input.amount)
          expect(typeof item['amount']).toBe('number')
          expect(item['type']).toMatch(/^(subscription|boost)$/)
          expect(item['planTier']).toBeDefined()
          expect(item['status']).toBe(input.status)
          expect(item['paymentProvider']).toBe('yoco')
          expect(item['currency']).toBe('ZAR')
          expect(item['createdAt']).toBe(input.createdAt)

          // Dual-key pattern check
          expect(item['pk']).toBe(`PAYMENT#${input.businessId}`)
          expect(item['sk']).toContain(input.paymentId)
          expect(item['gsi1pk']).toMatch(/^REVENUE#\d{4}-\d{2}$/)
          expect(item['gsi1sk']).toContain(input.paymentId)

          // Condition expression for idempotency
          expect(lastCondition).toBe('attribute_not_exists(pk) AND attribute_not_exists(sk)')
        },
      ),
      { numRuns: 100 },
    )
  })

  it('duplicate events return duplicate=true via ConditionalCheckFailedException', async () => {
    const { createPaymentRecord } = await import('../../features/business/repository.js')

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          paymentId: fc.uuid(),
          businessId: fc.uuid(),
          amount: fc.integer({ min: 100, max: 10000000 }),
          type: fc.constantFrom('subscription' as const, 'boost' as const),
          planTier: fc.constantFrom('starter', 'growth', 'pro', 'flex_daily'),
          nodeId: fc.option(fc.uuid(), { nil: null }),
          status: fc.constantFrom('succeeded' as const),
          description: fc.string({ minLength: 1, maxLength: 50 }),
          createdAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') })
            .filter(d => !isNaN(d.getTime())).map(d => d.toISOString()),
        }),
        async (input) => {
          // Simulate ConditionalCheckFailedException (duplicate)
          const condError = new Error('Conditional check failed')
          ;(condError as unknown as { name: string }).name = 'ConditionalCheckFailedException'
          mockSend.mockRejectedValueOnce(condError)

          const result = await createPaymentRecord(input)
          expect(result.duplicate).toBe(true)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('non-duplicate errors are re-thrown', async () => {
    const { createPaymentRecord } = await import('../../features/business/repository.js')

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          paymentId: fc.uuid(),
          businessId: fc.uuid(),
          amount: fc.integer({ min: 100, max: 10000000 }),
          type: fc.constantFrom('subscription' as const, 'boost' as const),
          planTier: fc.constantFrom('starter', 'growth', 'pro', 'flex_daily'),
          nodeId: fc.option(fc.uuid(), { nil: null }),
          status: fc.constantFrom('succeeded' as const),
          description: fc.string({ minLength: 1, maxLength: 50 }),
          createdAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') })
            .filter(d => !isNaN(d.getTime())).map(d => d.toISOString()),
        }),
        async (input) => {
          const otherError = new Error('Service unavailable')
          ;(otherError as unknown as { name: string }).name = 'ServiceUnavailableException'
          mockSend.mockRejectedValueOnce(otherError)

          await expect(createPaymentRecord(input)).rejects.toThrow('Service unavailable')
        },
      ),
      { numRuns: 100 },
    )
  })
})

describe('Property 18: Timezone Partition Key Correctness', () => {
  it('partition key uses SAST (UTC+2) date, not UTC date', async () => {
    await fc.assert(
      fc.property(
        fc.date({ min: new Date('2024-01-01T00:00:00Z'), max: new Date('2026-12-31T23:59:59Z') }),
        (utcDate) => {
          const isoTimestamp = utcDate.toISOString()
          const result = getRevenuePartitionMonth(isoTimestamp)

          // Compute expected SAST date (UTC+2)
          const sastDate = new Date(utcDate.getTime() + 2 * 60 * 60 * 1000)
          const expectedYear = sastDate.getUTCFullYear()
          const expectedMonth = String(sastDate.getUTCMonth() + 1).padStart(2, '0')
          const expected = `${expectedYear}-${expectedMonth}`

          expect(result).toBe(expected)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('timestamps near midnight UTC produce correct SAST month boundaries', async () => {
    await fc.assert(
      fc.property(
        fc.integer({ min: 2024, max: 2026 }),
        fc.integer({ min: 0, max: 11 }),
        fc.integer({ min: 22, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (year, monthIdx, hour, minute) => {
          const lastDay = new Date(year, monthIdx + 1, 0).getDate()
          const utcDate = new Date(Date.UTC(year, monthIdx, lastDay, hour, minute, 0))
          const isoTimestamp = utcDate.toISOString()

          const result = getRevenuePartitionMonth(isoTimestamp)

          // In SAST (UTC+2), 22:00-23:59 UTC on last day becomes 00:00-01:59 next day
          const sastDate = new Date(utcDate.getTime() + 2 * 60 * 60 * 1000)
          const expectedYear = sastDate.getUTCFullYear()
          const expectedMonth = String(sastDate.getUTCMonth() + 1).padStart(2, '0')
          const expected = `${expectedYear}-${expectedMonth}`

          expect(result).toBe(expected)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('specific example: 2025-01-31T23:30:00Z produces REVENUE#2025-02', () => {
    const result = getRevenuePartitionMonth('2025-01-31T23:30:00Z')
    expect(result).toBe('2025-02')
  })

  it('partition key format is always YYYY-MM', async () => {
    await fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }).filter((d) => !isNaN(d.getTime())),
        (date) => {
          const result = getRevenuePartitionMonth(date.toISOString())
          expect(result).toMatch(/^\d{4}-\d{2}$/)
        },
      ),
      { numRuns: 100 },
    )
  })

  it('verifies the payment record gsi1pk uses SAST timezone for month partition', async () => {
    const { createPaymentRecord } = await import('../../features/business/repository.js')

    let lastItem: Record<string, unknown> | null = null
    mockSend.mockImplementation((cmd: { input: { Item?: Record<string, unknown> } }) => {
      if (cmd.input?.Item) {
        lastItem = cmd.input.Item
      }
      return Promise.resolve({})
    })

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2024, max: 2026 }),
        fc.integer({ min: 0, max: 11 }),
        fc.integer({ min: 22, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        async (year, monthIdx, hour, minute) => {
          lastItem = null

          const lastDay = new Date(year, monthIdx + 1, 0).getDate()
          const utcDate = new Date(Date.UTC(year, monthIdx, lastDay, hour, minute, 0))
          const createdAt = utcDate.toISOString()

          await createPaymentRecord({
            paymentId: `pay-${year}-${monthIdx}-${hour}-${minute}`,
            businessId: 'biz-test',
            amount: 5000,
            type: 'subscription',
            planTier: 'growth',
            nodeId: null,
            status: 'succeeded',
            description: 'Test payment',
            createdAt,
          })

          expect(lastItem).not.toBeNull()
          const gsi1pk = lastItem!['gsi1pk'] as string

          // Verify it uses SAST month, not UTC month
          const expectedMonth = getRevenuePartitionMonth(createdAt)
          expect(gsi1pk).toBe(`REVENUE#${expectedMonth}`)
        },
      ),
      { numRuns: 100 },
    )
  })
})
