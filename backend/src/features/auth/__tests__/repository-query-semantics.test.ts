/**
 * Auth repository DynamoDB query semantics.
 *
 * Two production breakers locked here:
 *   1. findUserByUsername must scan the whole users table (paginated), never
 *      with `Limit: 1` — a Limit-1 filtered scan examines one arbitrary row, so
 *      the signup uniqueness check let duplicate usernames through.
 *   2. updateBusiness must guard with `attribute_exists(businessId)` so a
 *      missing business fails the write (surfaced as null → 404) instead of
 *      upserting a phantom business row.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ send: vi.fn(), scanFirstMatch: vi.fn() }))

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.send },
  TableNames: { users: 'users', businesses: 'businesses', appData: 'app-data', checkins: 'checkins', nodes: 'nodes' },
  isConditionalCheckFailedError: (e: unknown) =>
    (e as { name?: string } | null)?.name === 'ConditionalCheckFailedException',
  scanFirstMatch: mocks.scanFirstMatch,
}))

import { findUserByUsername } from '../repository.js'
import { updateBusiness } from '../dynamodb-repository.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('findUserByUsername', () => {
  it('resolves via a paginated scan filter, never Limit: 1', async () => {
    mocks.scanFirstMatch.mockResolvedValueOnce({ userId: 'u1', username: 'taken' })

    const result = await findUserByUsername('taken')

    expect(result).toEqual({ userId: 'u1', username: 'taken' })
    const params = mocks.scanFirstMatch.mock.calls[0]![0] as {
      TableName: string
      FilterExpression: string
      ExpressionAttributeValues: Record<string, unknown>
      Limit?: number
    }
    expect(params.TableName).toBe('users')
    expect(params.FilterExpression).toBe('username = :username')
    expect(params.ExpressionAttributeValues[':username']).toBe('taken')
    expect(params.Limit).toBeUndefined()
  })

  it('returns null for an unused username', async () => {
    mocks.scanFirstMatch.mockResolvedValueOnce(null)
    expect(await findUserByUsername('free')).toBeNull()
  })

  it('short-circuits an empty username without touching the table', async () => {
    expect(await findUserByUsername('')).toBeNull()
    expect(mocks.scanFirstMatch).not.toHaveBeenCalled()
  })
})

describe('updateBusiness', () => {
  it('guards the write with attribute_exists(businessId) and returns the updated row', async () => {
    mocks.send.mockResolvedValueOnce({ Attributes: { businessId: 'b1', businessName: 'New' } })

    const result = await updateBusiness('b1', { businessName: 'New' })

    expect(result).toMatchObject({ businessId: 'b1', businessName: 'New' })
    const input = mocks.send.mock.calls[0]![0].input as { ConditionExpression: string }
    expect(input.ConditionExpression).toBe('attribute_exists(businessId)')
  })

  it('returns null when the business does not exist (no phantom upsert)', async () => {
    mocks.send.mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' })

    const result = await updateBusiness('missing', { businessName: 'New' })

    expect(result).toBeNull()
  })

  it('rethrows a non-conditional write error', async () => {
    mocks.send.mockRejectedValueOnce(new Error('boom'))

    await expect(updateBusiness('b1', { businessName: 'New' })).rejects.toThrow('boom')
  })
})
