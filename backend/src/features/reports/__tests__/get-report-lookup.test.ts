/**
 * getReport lookup semantics.
 *
 * Locks the fix for the Limit + FilterExpression false-miss: the lookup must
 * resolve a report through the paginated `queryFirstMatch` (which walks the
 * whole business partition), never a `Limit: 1` filtered query that 404s every
 * report but the first-indexed one once a business has 2+ reports.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { Report } from '../types.js'

const mocks = vi.hoisted(() => ({ queryFirstMatch: vi.fn(), send: vi.fn() }))

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.send },
  TableNames: { appData: 'app-data' },
  isConditionalCheckFailedError: () => false,
  queryFirstMatch: mocks.queryFirstMatch,
}))

import { getReport } from '../repository.js'

beforeEach(() => {
  vi.clearAllMocks()
})

const report = { reportId: 'r-2', businessId: 'biz-1', summary: { totalCheckIns: 5 } } as unknown as Report

describe('getReport', () => {
  it('resolves a report via a paginated filter, not a Limit: 1 query', async () => {
    mocks.queryFirstMatch.mockResolvedValueOnce({ data: JSON.stringify(report) })

    const result = await getReport('biz-1', 'r-2')

    expect(result).toEqual(report)
    const params = mocks.queryFirstMatch.mock.calls[0]![0] as {
      IndexName: string
      KeyConditionExpression: string
      FilterExpression: string
      ExpressionAttributeValues: Record<string, unknown>
      Limit?: number
    }
    expect(params.IndexName).toBe('GSI1')
    expect(params.KeyConditionExpression).toBe('gsi1pk = :gsi1pk')
    expect(params.FilterExpression).toBe('reportId = :reportId')
    expect(params.ExpressionAttributeValues[':gsi1pk']).toBe('REPORTS#biz-1')
    expect(params.ExpressionAttributeValues[':reportId']).toBe('r-2')
    // The false-miss guard: the repository must not cap the filtered read.
    expect(params.Limit).toBeUndefined()
  })

  it('returns null when no report matches', async () => {
    mocks.queryFirstMatch.mockResolvedValueOnce(null)
    expect(await getReport('biz-1', 'missing')).toBeNull()
  })

  it('returns null when the stored blob is unparseable', async () => {
    mocks.queryFirstMatch.mockResolvedValueOnce({ data: '{not json' })
    expect(await getReport('biz-1', 'r-2')).toBeNull()
  })
})
