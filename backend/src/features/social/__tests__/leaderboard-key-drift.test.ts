/**
 * Regression guard for leaderboard-consolidation (H6, tasks 1.3 and 5).
 *
 * The H6 bug was a silent key drift: the check-in path wrote one DynamoDB
 * partition key while the consumer read queried a different one, so the Ranks
 * tab was permanently empty in production. These tests pin the contract that
 * the incrementer and the read use the SAME canonical key
 * (`LEADERBOARD#{cityId}` / `USER#{userId}`), so the two call sites can never
 * drift apart again without a test failing.
 *
 * Strategy: stub the shared `documentClient` and duck-type on the command
 * constructor name. We capture the UpdateCommand (incrementer) and the
 * QueryCommand(s) (read) and assert their partition keys match for the same
 * cityId. No live AWS.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoisted mock ────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const state = {
    lastUpdateInput: null as Record<string, unknown> | null,
    queryPks: [] as string[],
  }
  const send = vi.fn(async (cmd: unknown) => {
    const name = (cmd as { constructor?: { name?: string } })?.constructor?.name
    const input = ((cmd as { input?: Record<string, unknown> })?.input ?? {}) as Record<string, unknown>
    if (name === 'UpdateCommand') {
      state.lastUpdateInput = input
      return {}
    }
    if (name === 'QueryCommand') {
      const eav = (input['ExpressionAttributeValues'] ?? {}) as Record<string, unknown>
      const pk = eav[':pk']
      if (typeof pk === 'string') state.queryPks.push(pk)
      return { Items: [] }
    }
    return { Items: [] }
  })
  return { state, send }
})

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.send },
  TableNames: {
    appData: 'test-app-data',
    checkins: 'test-checkins',
    users: 'test-users',
    nodes: 'test-nodes',
    presence: 'test-presence',
  },
  isConditionalCheckFailedError: (e: unknown) =>
    (e as { name?: string } | null)?.name === 'ConditionalCheckFailedException',
}))

import { incrementLeaderboard } from '../../check-in/dynamodb-repository.js'
import { getLeaderboardTop50 } from '../repository.js'

beforeEach(() => {
  mocks.state.lastUpdateInput = null
  mocks.state.queryPks = []
  mocks.send.mockClear()
})

describe('leaderboard canonical key (H6 regression guard)', () => {
  it('incrementer writes LEADERBOARD#{cityId} / USER#{userId} with an atomic ADD (task 1.3)', async () => {
    await incrementLeaderboard('johannesburg', 'user-1')

    const input = mocks.state.lastUpdateInput
    expect(input).toBeTruthy()
    expect(input!['Key']).toEqual({ pk: 'LEADERBOARD#johannesburg', sk: 'USER#user-1' })
    // Atomic increment (no read-modify-write) so concurrent check-ins are safe.
    expect(String(input!['UpdateExpression'])).toContain('ADD checkInCount')
    const eav = input!['ExpressionAttributeValues'] as Record<string, unknown>
    expect(eav[':one']).toBe(1)
  })

  it('read queries the SAME partition key the incrementer writes (task 5 key-drift)', async () => {
    const city = 'cape-town'

    await incrementLeaderboard(city, 'user-1')
    const writePk = (mocks.state.lastUpdateInput!['Key'] as { pk: string }).pk

    await getLeaderboardTop50(city)

    expect(mocks.state.queryPks.length).toBeGreaterThan(0)
    // Every leaderboard read must target the exact pk the incrementer wrote —
    // this is the invariant whose violation caused H6.
    for (const pk of mocks.state.queryPks) {
      expect(pk).toBe(writePk)
    }
    expect(writePk).toBe(`LEADERBOARD#${city}`)
  })
})
