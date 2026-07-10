/**
 * Admin consent audit reads target the correct partition.
 *
 * Consent is written at pk: USER#{id}, sk: CONSENT#{id} (auth insertConsentRecord).
 * The admin reads previously queried pk: CONSENT#{id} — a partition nothing
 * writes — so consent history and the audit list were always empty and
 * getUsersNeedingReconsent flagged every user (100% false positives). These
 * tests lock the corrected key shape and the removal of the Limit-before-Filter
 * false positive in the re-consent probe.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.send },
  TableNames: { appData: 'app-data', users: 'users' },
}))

import { getUserConsentHistory, listConsents, getUsersNeedingReconsent } from '../repository.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getUserConsentHistory', () => {
  it('queries the USER# partition for CONSENT# sort keys', async () => {
    mocks.send.mockResolvedValueOnce({ Items: [{ pk: 'USER#u1', sk: 'CONSENT#c1', consentVersion: '2.0' }] })

    const rows = await getUserConsentHistory('u1')

    expect(rows).toHaveLength(1)
    const input = mocks.send.mock.calls[0]![0].input as {
      KeyConditionExpression: string
      ExpressionAttributeValues: Record<string, unknown>
    }
    expect(input.KeyConditionExpression).toBe('pk = :pk AND begins_with(sk, :skPrefix)')
    expect(input.ExpressionAttributeValues[':pk']).toBe('USER#u1')
    expect(input.ExpressionAttributeValues[':skPrefix']).toBe('CONSENT#')
  })
})

describe('listConsents', () => {
  it('scans by the CONSENT# sort-key prefix and extracts userId from the USER# pk', async () => {
    mocks.send.mockResolvedValueOnce({
      Items: [
        { pk: 'USER#u1', sk: 'CONSENT#c1', consentVersion: '2.0' },
        { pk: 'USER#u2', sk: 'CONSENT#c2', consentVersion: '2.0' },
      ],
    })

    const rows = await listConsents()

    const input = mocks.send.mock.calls[0]![0].input as {
      FilterExpression: string
      ExpressionAttributeValues: Record<string, unknown>
    }
    expect(input.FilterExpression).toBe('begins_with(sk, :prefix)')
    expect(input.ExpressionAttributeValues[':prefix']).toBe('CONSENT#')
    expect(rows.map((r) => r.userId)).toEqual(['u1', 'u2'])
  })
})

describe('getUsersNeedingReconsent', () => {
  it('flags only users lacking a current-version consent row, without a Limit false positive', async () => {
    // 1st send: scan users. Then one consent query per user.
    mocks.send
      .mockResolvedValueOnce({
        Items: [
          { userId: 'u1', username: 'a' },
          { userId: 'u2', username: 'b' },
        ],
      })
      .mockResolvedValueOnce({ Items: [{ consentVersion: '2.0' }] }) // u1 has current consent
      .mockResolvedValueOnce({ Items: [] }) // u2 has none

    const result = await getUsersNeedingReconsent('2.0')

    expect(result).toEqual([{ id: 'u2', username: 'b', email: undefined }])

    // The per-user consent probe must hit the USER# partition and NOT use Limit,
    // or a matching row past the first read would be missed (false positive).
    const consentInput = mocks.send.mock.calls[1]![0].input as {
      KeyConditionExpression: string
      FilterExpression: string
      ExpressionAttributeValues: Record<string, unknown>
      Limit?: number
    }
    expect(consentInput.KeyConditionExpression).toBe('pk = :pk AND begins_with(sk, :skPrefix)')
    expect(consentInput.ExpressionAttributeValues[':pk']).toBe('USER#u1')
    expect(consentInput.FilterExpression).toBe('consentVersion = :ver')
    expect(consentInput.Limit).toBeUndefined()
  })
})
