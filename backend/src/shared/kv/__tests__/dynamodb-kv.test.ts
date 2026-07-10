/**
 * Unit tests for the KV batch-get helper (`kvBatchGet`), the batched pulse read
 * behind City_Nodes_Read (audit-gap-closure R2.2).
 *
 * Verifies:
 *  - keys are chunked at the DynamoDB BatchGetItem 100-key hard limit
 *  - UnprocessedKeys (throttled subset) are retried until drained, never dropped
 *  - expired-but-unswept rows are filtered out exactly as `kvGet` does
 *  - duplicate keys are deduplicated (BatchGetItem rejects duplicate keys)
 *  - a missing key is genuinely absent from the returned map (honest-presence)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ sendMock: vi.fn() }))

vi.mock('../../db/dynamodb.js', () => ({
  documentClient: { send: mocks.sendMock },
  TableNames: { appData: 'app-data' },
}))

import { kvBatchGet } from '../dynamodb-kv.js'

beforeEach(() => {
  mocks.sendMock.mockReset()
})

function itemFor(key: string, value: string, ttl?: number) {
  return { pk: `KV#${key}`, sk: 'VALUE', value, ...(ttl ? { ttl } : {}) }
}

describe('kvBatchGet', () => {
  it('returns an empty map without a request for zero keys', async () => {
    const result = await kvBatchGet([])
    expect(result.size).toBe(0)
    expect(mocks.sendMock).not.toHaveBeenCalled()
  })

  it('maps each key to its value in one request under the 100-key limit', async () => {
    mocks.sendMock.mockResolvedValueOnce({
      Responses: { 'app-data': [itemFor('pulse:c:n1', '42'), itemFor('pulse:c:n2', '7')] },
    })

    const result = await kvBatchGet(['pulse:c:n1', 'pulse:c:n2'])

    expect(mocks.sendMock).toHaveBeenCalledTimes(1)
    expect(result.get('pulse:c:n1')).toBe('42')
    expect(result.get('pulse:c:n2')).toBe('7')
  })

  it('omits keys with no row (missing = genuinely absent, not an error)', async () => {
    mocks.sendMock.mockResolvedValueOnce({ Responses: { 'app-data': [itemFor('pulse:c:n1', '42')] } })

    const result = await kvBatchGet(['pulse:c:n1', 'pulse:c:n2'])

    expect(result.get('pulse:c:n1')).toBe('42')
    expect(result.has('pulse:c:n2')).toBe(false)
  })

  it('filters out expired-but-unswept rows', async () => {
    const past = Math.floor(Date.now() / 1000) - 10
    mocks.sendMock.mockResolvedValueOnce({
      Responses: { 'app-data': [itemFor('pulse:c:live', '9'), itemFor('pulse:c:dead', '5', past)] },
    })

    const result = await kvBatchGet(['pulse:c:live', 'pulse:c:dead'])

    expect(result.get('pulse:c:live')).toBe('9')
    expect(result.has('pulse:c:dead')).toBe(false)
  })

  it('chunks keys at the 100-key BatchGetItem hard limit', async () => {
    const keys = Array.from({ length: 250 }, (_, i) => `pulse:c:n${i}`)
    mocks.sendMock.mockImplementation(async (cmd: { input: Record<string, unknown> }) => {
      const requested = (cmd.input['RequestItems'] as Record<string, { Keys: Array<{ pk: string }> }>)['app-data'].Keys
      expect(requested.length).toBeLessThanOrEqual(100)
      return {
        Responses: { 'app-data': requested.map((k) => itemFor(k.pk.slice('KV#'.length), '1')) },
      }
    })

    const result = await kvBatchGet(keys)

    // 250 keys -> 3 requests (100 + 100 + 50), every key present.
    expect(mocks.sendMock).toHaveBeenCalledTimes(3)
    expect(result.size).toBe(250)
  })

  it('deduplicates repeated keys into a single requested key', async () => {
    mocks.sendMock.mockImplementation(async (cmd: { input: Record<string, unknown> }) => {
      const requested = (cmd.input['RequestItems'] as Record<string, { Keys: Array<{ pk: string }> }>)['app-data'].Keys
      expect(requested).toHaveLength(1)
      return { Responses: { 'app-data': requested.map((k) => itemFor(k.pk.slice('KV#'.length), '3')) } }
    })

    const result = await kvBatchGet(['pulse:c:dup', 'pulse:c:dup', 'pulse:c:dup'])

    expect(mocks.sendMock).toHaveBeenCalledTimes(1)
    expect(result.get('pulse:c:dup')).toBe('3')
  })

  it('retries UnprocessedKeys until drained so no key is dropped', async () => {
    mocks.sendMock
      .mockResolvedValueOnce({
        Responses: { 'app-data': [itemFor('pulse:c:n1', '1')] },
        UnprocessedKeys: { 'app-data': { Keys: [{ pk: 'KV#pulse:c:n2', sk: 'VALUE' }] } },
      })
      .mockResolvedValueOnce({ Responses: { 'app-data': [itemFor('pulse:c:n2', '2')] } })

    const result = await kvBatchGet(['pulse:c:n1', 'pulse:c:n2'])

    expect(mocks.sendMock).toHaveBeenCalledTimes(2)
    expect(result.get('pulse:c:n1')).toBe('1')
    expect(result.get('pulse:c:n2')).toBe('2')
  })

  it('throws when UnprocessedKeys never drain, rather than silently dropping keys', async () => {
    mocks.sendMock.mockResolvedValue({
      Responses: { 'app-data': [] },
      UnprocessedKeys: { 'app-data': { Keys: [{ pk: 'KV#pulse:c:stuck', sk: 'VALUE' }] } },
    })

    await expect(kvBatchGet(['pulse:c:stuck'])).rejects.toThrow(/unprocessed/i)
  })
})
