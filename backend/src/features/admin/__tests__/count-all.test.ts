/**
 * Unit tests for the paginated `countAll` helper used by `getDashboardMetrics`
 * (data-integrity-ops-hardening H5, task 1.2).
 *
 * A single-page `Scan` `Count` undercounts once a table/filter exceeds one
 * DynamoDB Scan page. `countAll` loops over `LastEvaluatedKey`, summing each
 * page's `Count`, so the total reflects the whole table/filter — never just
 * page 1. These tests stub `documentClient.send` to return `LastEvaluatedKey`
 * across multiple pages and assert the summed total equals the sum of all
 * pages, covering single-page, multi-page, and empty results.
 *
 * _Requirements: 1.1, 1.2_
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ───────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({ sendMock: vi.fn() }))

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.sendMock },
  TableNames: {
    users: 'users',
    businesses: 'businesses',
    checkins: 'checkins',
    rewards: 'rewards',
    appData: 'app-data',
    nodes: 'nodes',
  },
}))

// Peers pulled in transitively by repository.ts imports; none are exercised
// by countAll, stub them so importing the module under test is side-effect free.
vi.mock('../../auth/dynamodb-repository.js', () => ({
  getUserById: vi.fn(),
  getBusinessById: vi.fn(),
  updateUser: vi.fn(),
  updateBusiness: vi.fn(),
  getStaffByBusinessId: vi.fn(),
}))
vi.mock('../../check-in/dynamodb-repository.js', () => ({
  getCheckInsByUser: vi.fn(),
}))
vi.mock('../../nodes/dynamodb-repository.js', () => ({
  getNodeById: vi.fn(),
}))
vi.mock('../../notifications/repository.js', () => ({
  getActivePushTokens: vi.fn(),
  getNotificationPreferences: vi.fn(),
}))

import { countAll } from '../repository.js'

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Queue `documentClient.send` to resolve one response per page. Every page but
 * the last carries a `LastEvaluatedKey`, so `countAll` keeps looping until the
 * scan is exhausted. Returns the expected summed total for convenience.
 */
function stubPages(counts: number[]): number {
  mocks.sendMock.mockReset()
  counts.forEach((count, i) => {
    const isLast = i === counts.length - 1
    mocks.sendMock.mockResolvedValueOnce({
      Count: count,
      LastEvaluatedKey: isLast ? undefined : { pk: `page-${i}` },
    })
  })
  return counts.reduce((sum, c) => sum + c, 0)
}

beforeEach(() => {
  mocks.sendMock.mockReset()
})

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('countAll — paginated COUNT summation (H5)', () => {
  it('returns the single-page count when the scan fits in one page', async () => {
    const expected = stubPages([5])

    const total = await countAll({ TableName: 'users' })

    expect(total).toBe(5)
    expect(expected).toBe(5)
    expect(mocks.sendMock).toHaveBeenCalledTimes(1)
  })

  it('sums Count across every page, not just page 1', async () => {
    const expected = stubPages([3, 4, 5]) // 12 across three pages

    const total = await countAll({ TableName: 'checkins' })

    // The whole point of H5: the total is the sum of all pages (12), never
    // the first page alone (3).
    expect(total).toBe(expected)
    expect(total).toBe(12)
    expect(total).not.toBe(3)
    expect(mocks.sendMock).toHaveBeenCalledTimes(3)
  })

  it('returns 0 for an empty result (single empty page)', async () => {
    stubPages([0])

    const total = await countAll({ TableName: 'businesses' })

    expect(total).toBe(0)
    expect(mocks.sendMock).toHaveBeenCalledTimes(1)
  })

  it('treats a missing per-page Count as 0 while still summing real pages', async () => {
    // A page with no Count field must not poison the running total (NaN).
    mocks.sendMock.mockReset()
    mocks.sendMock
      .mockResolvedValueOnce({ Count: undefined, LastEvaluatedKey: { pk: 'p0' } })
      .mockResolvedValueOnce({ Count: 7, LastEvaluatedKey: undefined })

    const total = await countAll({ TableName: 'rewards' })

    expect(total).toBe(7)
    expect(mocks.sendMock).toHaveBeenCalledTimes(2)
  })

  it('forwards Select=COUNT and threads ExclusiveStartKey between pages', async () => {
    stubPages([2, 6])

    await countAll({ TableName: 'app-data', FilterExpression: 'reviewed = :rev' })

    expect(mocks.sendMock).toHaveBeenCalledTimes(2)

    const firstInput = mocks.sendMock.mock.calls[0]![0].input
    const secondInput = mocks.sendMock.mock.calls[1]![0].input

    // Every page is a COUNT scan.
    expect(firstInput.Select).toBe('COUNT')
    expect(secondInput.Select).toBe('COUNT')

    // Page 1 starts fresh; page 2 continues from page 1's LastEvaluatedKey.
    expect(firstInput.ExclusiveStartKey).toBeUndefined()
    expect(secondInput.ExclusiveStartKey).toEqual({ pk: 'page-0' })

    // Original params are preserved across the loop.
    expect(secondInput.TableName).toBe('app-data')
    expect(secondInput.FilterExpression).toBe('reviewed = :rev')
  })
})
