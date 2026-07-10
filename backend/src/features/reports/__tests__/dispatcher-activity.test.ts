/**
 * hasActivityInPeriod window query.
 *
 * The checkins NodeIndex range key is the numeric `timestamp` (epoch ms). The
 * activity probe must constrain the window on that SORT KEY, not a
 * `checkedInAt` FilterExpression under `Limit: 1` — that combination read only
 * the oldest check-in and reported "no activity" for any venue older than the
 * window, silently halting monthly reports after a venue's first month.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.send },
  TableNames: { checkins: 'checkins', businesses: 'businesses', nodes: 'nodes' },
}))

import { hasActivityInPeriod } from '../dispatcher.js'

beforeEach(() => {
  vi.clearAllMocks()
})

const START = '2026-05-01T00:00:00.000Z'
const END = '2026-05-31T23:59:59.999Z'

describe('hasActivityInPeriod', () => {
  it('queries the numeric timestamp sort key with a BETWEEN window and Limit 1', async () => {
    mocks.send.mockResolvedValueOnce({ Items: [{ checkInId: 'c-1' }] })

    const result = await hasActivityInPeriod(['node-1'], START, END)

    expect(result).toBe(true)
    const input = mocks.send.mock.calls[0]![0].input as {
      IndexName: string
      KeyConditionExpression: string
      ExpressionAttributeNames: Record<string, string>
      ExpressionAttributeValues: Record<string, unknown>
      Limit: number
    }
    expect(input.IndexName).toBe('NodeIndex')
    // The window lives on the key condition (sort key), not a FilterExpression.
    expect(input.KeyConditionExpression).toBe('nodeId = :nodeId AND #ts BETWEEN :start AND :end')
    expect(input.ExpressionAttributeNames['#ts']).toBe('timestamp')
    // Bounds are epoch-ms numbers (the sort-key type), not ISO strings.
    expect(input.ExpressionAttributeValues[':start']).toBe(new Date(START).getTime())
    expect(input.ExpressionAttributeValues[':end']).toBe(new Date(END).getTime())
    expect(typeof input.ExpressionAttributeValues[':start']).toBe('number')
    expect(input.Limit).toBe(1)
  })

  it('short-circuits at the first node with activity', async () => {
    mocks.send.mockResolvedValueOnce({ Items: [{ checkInId: 'c-1' }] })

    const result = await hasActivityInPeriod(['node-1', 'node-2', 'node-3'], START, END)

    expect(result).toBe(true)
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })

  it('returns false only after every node reads empty in the window', async () => {
    mocks.send.mockResolvedValue({ Items: [] })

    const result = await hasActivityInPeriod(['node-1', 'node-2'], START, END)

    expect(result).toBe(false)
    expect(mocks.send).toHaveBeenCalledTimes(2)
  })
})
