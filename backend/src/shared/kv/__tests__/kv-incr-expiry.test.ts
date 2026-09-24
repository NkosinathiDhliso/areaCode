/**
 * `kvIncr` absolute expiry: a counter that means "today" cannot outlive the day.
 *
 * **Validates: Requirements 15.2**
 *
 * The TTL is seeded on creation and never extended, so passing "seconds until
 * midnight SAST" makes the row expire at midnight. DynamoDB's TTL sweep is
 * best-effort though, and a lapsed row can sit there for hours. Without
 * `resetWhenExpired` the next increment would continue yesterday's count, which
 * is exactly the bug: pulse and the morning toasts citing last night's number.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    /** Rows keyed by pk, standing in for the app-data KV partition. */
    rows: new Map<string, Record<string, unknown>>(),
  }

  const conditionalFailure = (): Error => {
    const err = new Error('The conditional request failed') as Error & { name: string }
    err.name = 'ConditionalCheckFailedException'
    return err
  }

  /**
   * Only the two update shapes `kvIncr` issues are modelled: the conditional
   * increment and the unconditional reset. The condition is evaluated against
   * the stored `ttl`, which is the behaviour under test.
   */
  const sendMock = vi.fn(async (cmd: { input: Record<string, unknown> }) => {
    const input = cmd.input
    const key = (input['Key'] as { pk: string }).pk
    const values = input['ExpressionAttributeValues'] as Record<string, number>
    const row = state.rows.get(key)
    const condition = input['ConditionExpression'] as string | undefined

    if (condition) {
      const storedTtl = row?.['ttl'] as number | undefined
      if (storedTtl !== undefined && storedTtl <= values[':now']!) throw conditionalFailure()
    }

    if (String(input['UpdateExpression']).includes(':one')) {
      const reset = { pk: key, value: 1, ttl: values[':ttl'] }
      state.rows.set(key, reset)
      return { Attributes: reset }
    }

    const next = {
      pk: key,
      value: Number(row?.['value'] ?? 0) + 1,
      ttl: row?.['ttl'] ?? values[':ttl'],
    }
    state.rows.set(key, next)
    return { Attributes: next }
  })

  return { state, sendMock }
})

vi.mock('../../db/dynamodb.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/dynamodb.js')>()
  return { ...actual, documentClient: { send: h.sendMock } }
})

import { kvIncr } from '../dynamodb-kv.js'

const KEY = 'checkin:today:node-a'
const PK = `KV#${KEY}`

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

beforeEach(() => {
  h.state.rows.clear()
  h.sendMock.mockClear()
})

describe('kvIncr TTL', () => {
  it('seeds the expiry on creation and does not extend it on later increments', async () => {
    await kvIncr(KEY, 3600)
    const seeded = h.state.rows.get(PK)!['ttl'] as number

    await kvIncr(KEY, 3600)

    expect(h.state.rows.get(PK)!['value']).toBe(2)
    expect(h.state.rows.get(PK)!['ttl']).toBe(seeded)
  })

  it('sets the expiry to the deadline the caller asked for', async () => {
    await kvIncr(KEY, 120)

    expect(h.state.rows.get(PK)!['ttl']).toBe(nowSeconds() + 120)
  })
})

describe('kvIncr resetWhenExpired', () => {
  it('restarts the count at 1 when the stored deadline has passed', async () => {
    // Yesterday's counter, expired but not yet swept.
    h.state.rows.set(PK, { pk: PK, value: 47, ttl: nowSeconds() - 60 })

    const count = await kvIncr(KEY, 3600, { resetWhenExpired: true })

    expect(count).toBe(1)
    expect(h.state.rows.get(PK)!['value']).toBe(1)
    expect(h.state.rows.get(PK)!['ttl']).toBe(nowSeconds() + 3600)
  })

  it('keeps counting within the current period', async () => {
    h.state.rows.set(PK, { pk: PK, value: 12, ttl: nowSeconds() + 600 })

    const count = await kvIncr(KEY, 3600, { resetWhenExpired: true })

    expect(count).toBe(13)
    // The original deadline stands: the period did not restart.
    expect(h.state.rows.get(PK)!['ttl']).toBe(nowSeconds() + 600)
  })

  it('creates a fresh counter when no row exists', async () => {
    const count = await kvIncr(KEY, 3600, { resetWhenExpired: true })

    expect(count).toBe(1)
  })

  it('surfaces a non-conditional failure instead of masking it as a reset', async () => {
    h.sendMock.mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'))

    await expect(kvIncr(KEY, 3600, { resetWhenExpired: true })).rejects.toThrow('ProvisionedThroughput')
  })
})
