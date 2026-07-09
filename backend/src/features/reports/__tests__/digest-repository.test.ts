/**
 * Digest_Row repository writes and reads (Weekly Attribution Digest, task 3.1).
 *
 * Locks the R3.1 idempotency guarantee and the two read access patterns:
 *   1. `putDigestRow` writes with `attribute_not_exists(pk)` and reports
 *      `written` on the first pass, `duplicate` on a ConditionalCheckFailed
 *      replay (the designed no-op), and rethrows every other error.
 *   2. `getLatestDigest` queries the partition newest-first, limit 1.
 *   3. `queryDigestHistory` queries newest-first with cursor pagination.
 *
 * The real shared `isConditionalCheckFailedError` detector is mirrored in the
 * mock so the branch decision is exercised against the genuine error name.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { DigestRow } from '../types.js'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.send },
  isConditionalCheckFailedError: (err: unknown) =>
    (err as { name?: string } | null)?.name === 'ConditionalCheckFailedException',
  TableNames: { appData: 'app-data' },
}))

import { putDigestRow, getLatestDigest, queryDigestHistory } from '../repository.js'

beforeEach(() => {
  vi.clearAllMocks()
})

const row: DigestRow = {
  businessId: 'biz-1',
  weekStart: '2026-07-06',
  metrics: {
    visits: 23,
    uniqueVisitors: 18,
    firstTimeVisitors: 7,
    returningVisitors: 11,
    redemptions: 4,
    firstGetIssued: 9,
    firstGetConversions: 3,
    busiestDay: 'Friday',
    busiestHour: 21,
  },
  deltas: { visits: 5, uniqueVisitors: 2 },
  suppressed: ['firstGetConversions'],
  tierAtBuild: 'starter',
  emailSent: false,
  createdAt: '2026-07-13T22:05:00.000Z',
}

// The persisted item a read returns: domain fields plus the storage keys.
const storedItem = {
  pk: 'DIGEST#biz-1',
  sk: 'WEEK#2026-07-06',
  ...row,
}

describe('putDigestRow', () => {
  it('writes with attribute_not_exists(pk) and returns written on first pass', async () => {
    mocks.send.mockResolvedValueOnce({})

    const result = await putDigestRow(row)

    expect(result).toBe('written')
    const input = mocks.send.mock.calls[0]![0].input as {
      TableName: string
      Item: Record<string, unknown>
      ConditionExpression: string
    }
    expect(input.TableName).toBe('app-data')
    expect(input.Item['pk']).toBe('DIGEST#biz-1')
    expect(input.Item['sk']).toBe('WEEK#2026-07-06')
    expect(input.Item['metrics']).toEqual(row.metrics)
    expect(input.ConditionExpression).toBe('attribute_not_exists(pk)')
  })

  it('returns duplicate on a ConditionalCheckFailed replay (idempotent no-op)', async () => {
    mocks.send.mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' })

    const result = await putDigestRow(row)

    expect(result).toBe('duplicate')
  })

  it('rethrows any non-conditional failure', async () => {
    mocks.send.mockRejectedValueOnce({ name: 'ProvisionedThroughputExceededException' })

    await expect(putDigestRow(row)).rejects.toMatchObject({
      name: 'ProvisionedThroughputExceededException',
    })
  })
})

describe('getLatestDigest', () => {
  it('queries the partition newest-first with limit 1 and returns the parsed row', async () => {
    mocks.send.mockResolvedValueOnce({ Items: [storedItem] })

    const result = await getLatestDigest('biz-1')

    expect(result).toEqual(row)
    const input = mocks.send.mock.calls[0]![0].input as {
      KeyConditionExpression: string
      ExpressionAttributeValues: Record<string, unknown>
      ScanIndexForward: boolean
      Limit: number
    }
    expect(input.KeyConditionExpression).toBe('pk = :pk')
    expect(input.ExpressionAttributeValues[':pk']).toBe('DIGEST#biz-1')
    expect(input.ScanIndexForward).toBe(false)
    expect(input.Limit).toBe(1)
  })

  it('returns null when the partition has no rows', async () => {
    mocks.send.mockResolvedValueOnce({ Items: [] })

    expect(await getLatestDigest('biz-1')).toBeNull()
  })
})

describe('queryDigestHistory', () => {
  it('queries newest-first and returns items plus a cursor', async () => {
    mocks.send.mockResolvedValueOnce({
      Items: [storedItem],
      LastEvaluatedKey: { pk: 'DIGEST#biz-1', sk: 'WEEK#2026-07-06' },
    })

    const result = await queryDigestHistory('biz-1')

    expect(result.items).toEqual([row])
    expect(result.nextCursor).toBeTypeOf('string')
    const input = mocks.send.mock.calls[0]![0].input as { ScanIndexForward: boolean }
    expect(input.ScanIndexForward).toBe(false)
  })

  it('decodes the cursor into an ExclusiveStartKey', async () => {
    const startKey = { pk: 'DIGEST#biz-1', sk: 'WEEK#2026-07-13' }
    const cursor = Buffer.from(JSON.stringify(startKey)).toString('base64')
    mocks.send.mockResolvedValueOnce({ Items: [] })

    const result = await queryDigestHistory('biz-1', cursor)

    expect(result.items).toEqual([])
    expect(result.nextCursor).toBeUndefined()
    const input = mocks.send.mock.calls[0]![0].input as {
      ExclusiveStartKey: Record<string, unknown>
    }
    expect(input.ExclusiveStartKey).toEqual(startKey)
  })
})
