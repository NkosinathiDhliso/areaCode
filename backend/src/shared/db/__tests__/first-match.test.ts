/**
 * Paginated first-match helpers (queryFirstMatch / scanFirstMatch).
 *
 * These lock the DynamoDB "Limit-before-Filter" fix shared by getReport,
 * getCampaignById and findUserByUsername: a filtered lookup must NOT cap the
 * page at 1 (that returns a false miss for data that exists) and must follow
 * LastEvaluatedKey until a filtered match is found or the source is exhausted.
 *
 * The AWS SDK is mocked so the real helper logic in dynamodb.ts runs against a
 * controllable `send` — the command classes are passthrough wrappers that
 * capture their input so the paginated ExclusiveStartKey can be asserted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mocks.send }) },
  QueryCommand: class {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  },
  ScanCommand: class {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  },
}))

import { queryFirstMatch, scanFirstMatch } from '../dynamodb.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('queryFirstMatch', () => {
  it('returns the first filtered item on the first page without further reads', async () => {
    mocks.send.mockResolvedValueOnce({ Items: [{ id: 'a' }] })

    const item = await queryFirstMatch({ TableName: 't', FilterExpression: 'x = :x' })

    expect(item).toEqual({ id: 'a' })
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it('follows LastEvaluatedKey to find a match not on the first page', async () => {
    // Page 1 is filtered empty but has more to read; page 2 holds the match.
    mocks.send
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { pk: 'cursor-1' } })
      .mockResolvedValueOnce({ Items: [{ id: 'found' }] })

    const item = await queryFirstMatch({ TableName: 't', FilterExpression: 'x = :x' })

    expect(item).toEqual({ id: 'found' })
    expect(mocks.send).toHaveBeenCalledTimes(2)
    // The second read must resume from the first page's cursor.
    const secondInput = mocks.send.mock.calls[1]![0].input as { ExclusiveStartKey?: unknown }
    expect(secondInput.ExclusiveStartKey).toEqual({ pk: 'cursor-1' })
  })

  it('returns null when every page is exhausted with no match', async () => {
    mocks.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined })

    const item = await queryFirstMatch({ TableName: 't', FilterExpression: 'x = :x' })

    expect(item).toBeNull()
  })

  it('never sends Limit: 1 on the caller-supplied params', async () => {
    mocks.send.mockResolvedValueOnce({ Items: [{ id: 'a' }] })

    await queryFirstMatch({ TableName: 't', FilterExpression: 'x = :x' })

    const input = mocks.send.mock.calls[0]![0].input as { Limit?: number }
    expect(input.Limit).toBeUndefined()
  })
})

describe('scanFirstMatch', () => {
  it('scans across pages until a filtered match is found', async () => {
    mocks.send
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { userId: 'cursor' } })
      .mockResolvedValueOnce({ Items: [{ userId: 'u-9', username: 'taken' }] })

    const item = await scanFirstMatch({
      TableName: 'users',
      FilterExpression: 'username = :u',
      ExpressionAttributeValues: { ':u': 'taken' },
    })

    expect(item).toEqual({ userId: 'u-9', username: 'taken' })
    expect(mocks.send).toHaveBeenCalledTimes(2)
    const secondInput = mocks.send.mock.calls[1]![0].input as { ExclusiveStartKey?: unknown }
    expect(secondInput.ExclusiveStartKey).toEqual({ userId: 'cursor' })
  })

  it('returns null when the whole table is scanned with no match', async () => {
    mocks.send.mockResolvedValueOnce({ Items: [] })

    const item = await scanFirstMatch({ TableName: 'users', FilterExpression: 'username = :u' })

    expect(item).toBeNull()
  })
})
