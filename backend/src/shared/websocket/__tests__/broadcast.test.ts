/**
 * Unit tests for the websocket broadcast fan-out in
 * `shared/websocket/broadcast.ts` (Audit Gap Closure R3, task 3.1).
 *
 * Covers requirement 3.1: `broadcastToRoom` and `broadcastToUser` paginate over
 * `LastEvaluatedKey` so every connection row is read and fanned out to, not just
 * the first query page.
 *
 * Strategy: the AWS SDK `documentClient` is stubbed and duck-types on the
 * command class name so we can drive multi-page Query responses. The
 * ApiGatewayManagementApi client is mocked to capture every connectionId the
 * fan-out posts to. No live AWS.
 */

import fc from 'fast-check'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Hoisted mock state ──────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const state = {
    // Each entry is one Query page: its rows plus whether it carries a cursor.
    pages: [] as Array<{ items: Array<Record<string, unknown>>; last: boolean }>,
    queryCalls: [] as Array<Record<string, unknown>>,
    posted: [] as string[],
    // Per-connectionId post outcome. Absent => success. 'gone' throws a
    // GoneException; 'fail' throws a generic error (non-Gone failure).
    postOutcome: {} as Record<string, 'gone' | 'fail'>,
    logs: [] as string[],
  }

  // Default document-client behaviour: serve state.pages as sequential Query
  // pages. Kept as a named impl so resetState can restore it after any test
  // that overrides it with mockImplementation (order-independence).
  const defaultDocumentSend = async (cmd: unknown) => {
    const name = (cmd as { constructor?: { name?: string } })?.constructor?.name
    const input = ((cmd as { input?: Record<string, unknown> })?.input ?? {}) as Record<string, unknown>

    if (name === 'QueryCommand') {
      state.queryCalls.push(input)
      const index = state.queryCalls.length - 1
      const page = state.pages[index] ?? { items: [], last: true }
      return {
        Items: page.items,
        LastEvaluatedKey: page.last ? undefined : { connectionId: `cursor-${index}` },
      }
    }

    throw new Error(`Unexpected command: ${name}`)
  }

  // Default post behaviour: honour state.postOutcome ('gone' => GoneException,
  // 'fail' => generic error, absent => success). Named so resetState can
  // restore it after the concurrency test swaps in its own implementation.
  const defaultPostSend = async (cmd: unknown) => {
    const input = ((cmd as { input?: Record<string, unknown> })?.input ?? {}) as Record<string, unknown>
    const connectionId = input['ConnectionId'] as string
    const outcome = state.postOutcome[connectionId]
    if (outcome === 'gone') {
      const err = new Error('gone') as Error & { name: string }
      err.name = 'GoneException'
      throw err
    }
    if (outcome === 'fail') {
      throw new Error(`post failed for ${connectionId}`)
    }
    state.posted.push(connectionId)
    return {}
  }

  const documentSend = vi.fn(defaultDocumentSend)
  const postSend = vi.fn(defaultPostSend)

  return { state, documentSend, postSend, defaultDocumentSend, defaultPostSend }
})

vi.mock('../../db/dynamodb.js', () => ({
  documentClient: { send: mocks.documentSend },
}))

vi.mock('@aws-sdk/client-apigatewaymanagementapi', () => ({
  ApiGatewayManagementApiClient: class {
    send = mocks.postSend
  },
  PostToConnectionCommand: class {
    input: Record<string, unknown>
    constructor(input: Record<string, unknown>) {
      this.input = input
    }
  },
}))

process.env['WEBSOCKET_ENDPOINT'] = 'https://ws.example.test'

const { broadcastToRoom, broadcastToUser } = await import('../broadcast.js')

function resetState() {
  mocks.state.pages = []
  mocks.state.queryCalls = []
  mocks.state.posted = []
  mocks.state.postOutcome = {}
  mocks.state.logs = []
  // Clear call history, then restore default implementations so a test that
  // overrode them with mockImplementation (e.g. the concurrency cap test)
  // cannot leak into later tests. mockClear alone clears history but keeps the
  // overriding impl; mockImplementation alone keeps history. We need both.
  mocks.documentSend.mockClear()
  mocks.postSend.mockClear()
  mocks.documentSend.mockImplementation(mocks.defaultDocumentSend)
  mocks.postSend.mockImplementation(mocks.defaultPostSend)
}

beforeEach(() => {
  resetState()
})

describe('broadcastToRoom pagination (R3.1)', () => {
  it('reads every connection across multiple LastEvaluatedKey pages', async () => {
    mocks.state.pages = [
      { items: [{ connectionId: 'a' }, { connectionId: 'b' }], last: false },
      { items: [{ connectionId: 'c' }], last: false },
      { items: [{ connectionId: 'd' }], last: true },
    ]

    const reached = await broadcastToRoom('city:capetown', { type: 't', payload: {} })

    expect(reached).toBe(4)
    expect(mocks.state.posted.sort()).toEqual(['a', 'b', 'c', 'd'])
    // Three Query pages fetched (loop ran until no cursor remained).
    expect(mocks.state.queryCalls).toHaveLength(3)
    // Only the first Query omits ExclusiveStartKey; later pages pass the cursor.
    expect(mocks.state.queryCalls[0]?.['ExclusiveStartKey']).toBeUndefined()
    expect(mocks.state.queryCalls[1]?.['ExclusiveStartKey']).toBeDefined()
    expect(mocks.state.queryCalls[0]?.['IndexName']).toBe('RoomIndex')
  })

  it('returns 0 and posts nothing when the room has no connections', async () => {
    mocks.state.pages = [{ items: [], last: true }]

    const reached = await broadcastToRoom('city:empty', { type: 't', payload: {} })

    expect(reached).toBe(0)
    expect(mocks.state.posted).toEqual([])
    expect(mocks.state.queryCalls).toHaveLength(1)
  })
})

describe('broadcastToUser pagination (R3.1)', () => {
  it('reads every connection across multiple LastEvaluatedKey pages', async () => {
    mocks.state.pages = [
      { items: [{ connectionId: 'u1' }], last: false },
      { items: [{ connectionId: 'u2' }, { connectionId: 'u3' }], last: true },
    ]

    const reached = await broadcastToUser('user-123', { type: 't', payload: {} })

    expect(reached).toBe(3)
    expect(mocks.state.posted.sort()).toEqual(['u1', 'u2', 'u3'])
    expect(mocks.state.queryCalls).toHaveLength(2)
    expect(mocks.state.queryCalls[0]?.['IndexName']).toBe('UserIndex')
    expect(mocks.state.queryCalls[0]?.['ExpressionAttributeValues']).toEqual({ ':userId': 'user-123' })
  })
})

describe('fan-out robustness (R3.2, R3.3, R3.4, R3.5)', () => {
  it('reached-count counts only successful posts, not gone or failed (R3.4, R3.5)', async () => {
    mocks.state.pages = [
      {
        items: [
          { connectionId: 'ok1' },
          { connectionId: 'stale' },
          { connectionId: 'ok2' },
          { connectionId: 'broken' },
        ],
        last: true,
      },
    ]
    mocks.state.postOutcome = { stale: 'gone', broken: 'fail' }

    const reached = await broadcastToRoom('city:capetown', { type: 't', payload: {} })

    // Only the two healthy sockets count toward reached.
    expect(reached).toBe(2)
    expect(mocks.state.posted.sort()).toEqual(['ok1', 'ok2'])
  })

  it('a single bad socket neither rejects the batch nor stops other posts (R3.2, R3.4)', async () => {
    mocks.state.pages = [{ items: [{ connectionId: 'a' }, { connectionId: 'bad' }, { connectionId: 'c' }], last: true }]
    mocks.state.postOutcome = { bad: 'fail' }

    // Does not throw despite the failed post.
    const reached = await broadcastToRoom('city:capetown', { type: 't', payload: {} })

    expect(reached).toBe(2)
    expect(mocks.state.posted.sort()).toEqual(['a', 'c'])
    // Every connection was attempted (3 posts), including after the failure.
    expect(mocks.postSend).toHaveBeenCalledTimes(3)
  })

  it('gone connections are ignored and do not count as reached (R3.3)', async () => {
    mocks.state.pages = [{ items: [{ connectionId: 'g1' }, { connectionId: 'g2' }], last: true }]
    mocks.state.postOutcome = { g1: 'gone', g2: 'gone' }

    const reached = await broadcastToUser('user-9', { type: 't', payload: {} })

    expect(reached).toBe(0)
    expect(mocks.state.posted).toEqual([])
  })

  it('bounds in-flight posts to the concurrency cap for large rooms (R3.2)', async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ connectionId: `c${i}` }))
    mocks.state.pages = [{ items, last: true }]

    let inFlight = 0
    let maxInFlight = 0
    mocks.postSend.mockImplementation(async (cmd: unknown) => {
      const input = ((cmd as { input?: Record<string, unknown> })?.input ?? {}) as Record<string, unknown>
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight--
      mocks.state.posted.push(input['ConnectionId'] as string)
      return {}
    })

    const reached = await broadcastToRoom('city:big', { type: 't', payload: {} })

    expect(reached).toBe(60)
    expect(maxInFlight).toBeLessThanOrEqual(25)
  })
})

describe('fan-out reached-count property (R3.2, R3.5)', () => {
  // A single-page vector of per-connection outcomes. Each entry drives one
  // connection row: 'ok' posts successfully, 'gone' throws GoneException, 'fail'
  // throws a generic error. maxLength spans past FANOUT_CONCURRENCY (25) so the
  // worker pool runs concurrently and the property also exercises counter safety.
  const outcomeVector = fc.array(fc.constantFrom('ok', 'gone', 'fail'), { maxLength: 80 })

  // Feature: room-fanout, Property 1: reached-count equals the number of
  // successful posts for any arbitrary vector of success/failure outcomes,
  // proving fanOut's concurrent counters (broadcastToRoom / broadcastToUser)
  // count only 'posted' results regardless of how gone/failed sockets interleave.
  it('Property 1: broadcastToRoom reached-count equals the number of ok outcomes', async () => {
    await fc.assert(
      fc.asyncProperty(outcomeVector, async (outcomes) => {
        resetState()
        const items = outcomes.map((_, i) => ({ connectionId: `c${i}` }))
        const postOutcome: Record<string, 'gone' | 'fail'> = {}
        for (let i = 0; i < outcomes.length; i++) {
          const o = outcomes[i]!
          if (o !== 'ok') postOutcome[`c${i}`] = o
        }
        mocks.state.pages = [{ items, last: true }]
        mocks.state.postOutcome = postOutcome

        const reached = await broadcastToRoom('city:prop', { type: 't', payload: {} })

        const expected = outcomes.filter((o) => o === 'ok').length
        expect(reached).toBe(expected)
        expect(mocks.state.posted).toHaveLength(expected)
      }),
      { numRuns: 200 },
    )
  })

  // Feature: room-fanout, Property 2: the same invariant holds for
  // broadcastToUser, which shares the fanOut worker pool.
  it('Property 2: broadcastToUser reached-count equals the number of ok outcomes', async () => {
    await fc.assert(
      fc.asyncProperty(outcomeVector, async (outcomes) => {
        resetState()
        const items = outcomes.map((_, i) => ({ connectionId: `u${i}` }))
        const postOutcome: Record<string, 'gone' | 'fail'> = {}
        for (let i = 0; i < outcomes.length; i++) {
          const o = outcomes[i]!
          if (o !== 'ok') postOutcome[`u${i}`] = o
        }
        mocks.state.pages = [{ items, last: true }]
        mocks.state.postOutcome = postOutcome

        const reached = await broadcastToUser('user-prop', { type: 't', payload: {} })

        const expected = outcomes.filter((o) => o === 'ok').length
        expect(reached).toBe(expected)
        expect(mocks.state.posted).toHaveLength(expected)
      }),
      { numRuns: 200 },
    )
  })
})
