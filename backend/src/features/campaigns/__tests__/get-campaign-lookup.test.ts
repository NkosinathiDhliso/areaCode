/**
 * getCampaignById lookup semantics.
 *
 * Locks the fix for the Limit + FilterExpression false-miss that broke win-back
 * sends once a business had 2+ campaigns: the lookup resolves through the
 * paginated `queryFirstMatch`, never a `Limit: 1` filtered query.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { Campaign } from '../types.js'

const mocks = vi.hoisted(() => ({ queryFirstMatch: vi.fn(), send: vi.fn() }))

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.send },
  TableNames: { appData: 'app-data' },
  queryFirstMatch: mocks.queryFirstMatch,
}))

import { getCampaignById } from '../repository.js'

beforeEach(() => {
  vi.clearAllMocks()
})

const campaign = { campaignId: 'camp-2', businessId: 'biz-1', status: 'draft' } as unknown as Campaign

describe('getCampaignById', () => {
  it('resolves a campaign via a paginated filter, not a Limit: 1 query', async () => {
    mocks.queryFirstMatch.mockResolvedValueOnce({ data: JSON.stringify(campaign) })

    const result = await getCampaignById('biz-1', 'camp-2')

    expect(result).toEqual(campaign)
    const params = mocks.queryFirstMatch.mock.calls[0]![0] as {
      IndexName: string
      FilterExpression: string
      ExpressionAttributeValues: Record<string, unknown>
      Limit?: number
    }
    expect(params.IndexName).toBe('GSI1')
    expect(params.FilterExpression).toBe('campaignId = :campaignId')
    expect(params.ExpressionAttributeValues[':gsi1pk']).toBe('CAMPAIGNS#biz-1')
    expect(params.ExpressionAttributeValues[':campaignId']).toBe('camp-2')
    expect(params.Limit).toBeUndefined()
  })

  it('returns null when no campaign matches', async () => {
    mocks.queryFirstMatch.mockResolvedValueOnce(null)
    expect(await getCampaignById('biz-1', 'missing')).toBeNull()
  })
})
