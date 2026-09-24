/**
 * `POST` / `DELETE /v1/nodes/:nodeId/going` — the Going toggle
 * (proof-of-demand R9.1, R9.2, R9.9).
 *
 * Exercised through the real preHandler chain (consumer auth, Zod validation,
 * the sliding-window limiter), the real service and the real repository, with
 * only the DynamoDB document client, the venue read and the auth verifier
 * stubbed. So these tests cover what the endpoints actually promise:
 *
 *  - one transaction writes both rows of the pair, the countable venue row and
 *    the `USER#{userId}` mirror row erasure walks, so a counted row is always
 *    erasable and vice versa
 *  - both rows expire on the Monday 06:00 SAST after the digest pass that covers
 *    the night, so nothing sweeps them and the Monday digest can still read them
 *  - marking twice is one row with the first instant kept: idempotent
 *  - deleting a mark that was never made is success, not an error
 *  - consumer session required, rate limited, and nothing is written once the
 *    budget is spent
 *  - the row carries `userId` and the night, never coordinates or device data
 *  - the owner's business room is told the true count on every toggle, including
 *    the one that takes it back to zero, and the payload is aggregate only
 *
 * _Requirements: 9.1, 9.2, 9.5, 9.9_
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  send: vi.fn(),
  kvIncr: vi.fn(async (_key: string, _ttlSeconds?: number) => 1),
  kvTtl: vi.fn(async (_key: string) => 60),
  getNodeById: vi.fn(),
  emitBusinessGoing: vi.fn(async () => 1),
  authRoles: [] as string[][],
  userId: 'user-nomsa',
}))

// DEV_MODE off, so the limiter and the venue-existence check really run.
vi.mock('../../../shared/config/env.js', () => ({
  DEV_MODE: false,
  APP_ENV: 'test',
  IS_PROD: false,
  AWS_REGION: 'af-south-1',
  requireEnv: (_name: string, devDefault?: string) => devDefault ?? 'test-value',
  mediaCdnBaseUrl: () => 'https://cdn.example.test',
  webBaseUrl: () => 'https://areacode.co.za',
}))

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: h.send },
  TableNames: { appData: 'area-code-test-app-data' },
}))

vi.mock('../../../shared/kv/dynamodb-kv.js', () => ({
  kvIncr: h.kvIncr,
  kvTtl: h.kvTtl,
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(),
  kvDel: vi.fn(),
  kvBatchGet: vi.fn(async () => new Map()),
}))

vi.mock('../repository.js', () => ({ getNodeById: h.getNodeById }))

// The owner-facing fan-out. Mocked so nothing opens a websocket transport; the
// assertions are on what the payload is allowed to carry (R9.5).
vi.mock('../../../shared/socket/events.js', () => ({ emitBusinessGoing: h.emitBusinessGoing }))

// The other routes on this handler are not under test; the module only has to
// exist so registration completes.
vi.mock('../service.js', () => ({
  getNodesByCitySlug: vi.fn(),
  getNodeDetail: vi.fn(),
  getNodePublic: vi.fn(),
  getTrendingNodes: vi.fn(),
  searchNodes: vi.fn(),
  getWhoIsHere: vi.fn(),
  createNode: vi.fn(),
  businessCreateNode: vi.fn(),
  updateNode: vi.fn(),
  claimNode: vi.fn(),
  reportNode: vi.fn(),
  createPresignedUpload: vi.fn(),
  getNodeRewards: vi.fn(),
  getNodePresence: vi.fn(),
}))

vi.mock('../../../shared/middleware/auth.js', () => ({
  requireAuth: (...roles: string[]) => {
    h.authRoles.push(roles)
    return async (request: { headers?: Record<string, string>; auth?: unknown }) => {
      const header = request.headers?.['authorization']
      if (!header?.startsWith('Bearer ')) {
        throw Object.assign(new Error('Missing or invalid Authorization header'), { statusCode: 401 })
      }
      request.auth = { userId: h.userId, role: 'consumer' }
    }
  },
  optionalAuth: () => async () => undefined,
  getAuth: (request: { auth?: { userId: string } }) => request.auth,
  getOptionalAuth: (request: { auth?: unknown }) => request.auth ?? null,
}))

import type { FastifyInstance } from 'fastify'

import { goingNightFor, goingRowTtlEpochSeconds, goingUserSk, goingVenuePk, goingVenueSk } from '../going.js'
import { nodeRoutes } from '../handler.js'
import { GOING_RATE_LIMIT } from '../rate-limits.js'

// ─── Harness ─────────────────────────────────────────────────────────────────

type Handler = (request: unknown, reply: unknown) => unknown | Promise<unknown>

interface CapturedRoute {
  method: 'post' | 'delete'
  url: string
  opts: { preHandler: Handler[] }
  handler: Handler
}

/** A Friday night at 21:00 SAST, comfortably clear of the 04:00 rollover. */
const NOW_MS = new Date('2026-03-06T21:00:00.000+02:00').getTime()
const NIGHT = '2026-03-06'
const NODE_ID = '11111111-2222-4333-8444-555555555555'
const BUSINESS_ID = 'biz-ramona'
const IP = '203.0.113.9'

const routes: CapturedRoute[] = []

async function captureRoutes(): Promise<void> {
  routes.length = 0
  const record = (method: 'post' | 'delete') => (url: string, opts: { preHandler: Handler[] }, handler: Handler) => {
    routes.push({ method, url, opts, handler })
  }
  const app = {
    get: () => undefined,
    put: () => undefined,
    post: record('post'),
    delete: record('delete'),
  } as unknown as FastifyInstance
  await nodeRoutes(app)
}

async function call(
  method: 'post' | 'delete',
  opts: { body?: unknown; query?: unknown; authenticated?: boolean } = {},
) {
  await captureRoutes()
  const route = routes.find((r) => r.method === method && r.url === '/v1/nodes/:nodeId/going')
  if (!route) throw new Error(`${method} going route not registered`)
  const req = {
    params: { nodeId: NODE_ID },
    body: opts.body ?? {},
    query: opts.query ?? {},
    ip: IP,
    headers: opts.authenticated === false ? {} : { authorization: 'Bearer token' },
  }
  const reply = {}
  for (const pre of route.opts.preHandler) await pre(req, reply)
  return route.handler(req, reply)
}

interface TransactItem {
  Update?: {
    Key: { pk: string; sk: string }
    UpdateExpression: string
    ExpressionAttributeValues: Record<string, unknown>
  }
  Delete?: { Key: { pk: string; sk: string } }
}

function transactItems(): TransactItem[] {
  const call = h.send.mock.calls.find(([command]) => command?.constructor?.name === 'TransactWriteCommand')
  if (!call) throw new Error('no transaction was sent')
  return (call[0] as { input: { TransactItems: TransactItem[] } }).input.TransactItems
}

/** Stored rows, keyed `pk|sk`, so idempotency can be asserted on the real writes. */
const stored = new Map<string, Record<string, unknown>>()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_MS)
  stored.clear()
  h.authRoles.length = 0
  h.kvIncr.mockReset().mockResolvedValue(1)
  h.kvTtl.mockReset().mockResolvedValue(60)
  h.emitBusinessGoing.mockClear()
  h.getNodeById.mockReset().mockResolvedValue({ id: NODE_ID, name: 'Ramona', businessId: BUSINESS_ID })
  h.send.mockReset().mockImplementation(async (command: { constructor: { name: string }; input: any }) => {
    switch (command.constructor.name) {
      case 'TransactWriteCommand': {
        for (const item of command.input.TransactItems as TransactItem[]) {
          if (item.Update) {
            const id = `${item.Update.Key.pk}|${item.Update.Key.sk}`
            const values = item.Update.ExpressionAttributeValues
            const existing = stored.get(id)
            stored.set(id, {
              markedAt: existing?.['markedAt'] ?? values[':markedAt'],
              ttl: values[':ttl'],
              nodeId: values[':nodeId'],
              date: values[':date'],
              userId: values[':userId'],
            })
          }
          if (item.Delete) stored.delete(`${item.Delete.Key.pk}|${item.Delete.Key.sk}`)
        }
        return {}
      }
      case 'QueryCommand': {
        const pk = command.input.ExpressionAttributeValues[':pk'] as string
        const count = [...stored.keys()].filter((id) => id.startsWith(`${pk}|USER#`)).length
        return { Count: count }
      }
      case 'GetCommand': {
        const { pk, sk } = command.input.Key as { pk: string; sk: string }
        return { Item: stored.get(`${pk}|${sk}`) }
      }
      default:
        return {}
    }
  })
})

// ─── The pair ────────────────────────────────────────────────────────────────

describe('POST /v1/nodes/:nodeId/going — the rows (R9.1)', () => {
  it('writes the countable venue row and the erasure mirror row in one transaction', async () => {
    await call('post')

    const items = transactItems()
    expect(items).toHaveLength(2)
    expect(items[0]!.Update!.Key).toEqual({ pk: goingVenuePk(NODE_ID, NIGHT), sk: goingVenueSk(h.userId) })
    expect(items[1]!.Update!.Key).toEqual({ pk: `USER#${h.userId}`, sk: goingUserSk(NODE_ID, NIGHT) })
  })

  it('expires both rows six hours after the digest pass that covers the night', async () => {
    await call('post')

    // 2026-03-06 is in the week opening Monday 2026-03-02, so the pass that
    // covers it fires Monday 2026-03-09 06:00 SAST; the rows live to 12:00.
    const expected = Math.floor(new Date('2026-03-09T12:00:00.000+02:00').getTime() / 1000)
    expect(goingRowTtlEpochSeconds(NIGHT)).toBe(expected)
    for (const item of transactItems()) {
      expect(item.Update!.ExpressionAttributeValues[':ttl']).toBe(expected)
    }
  })

  it('stores the night, the venue and the consumer, and nothing spatial', async () => {
    await call('post', { body: { date: NIGHT, lat: -26.2041, lng: 28.0473, deviceId: 'abc' } })

    const row = stored.get(`${goingVenuePk(NODE_ID, NIGHT)}|${goingVenueSk(h.userId)}`)
    expect(row).toMatchObject({ nodeId: NODE_ID, date: NIGHT, userId: h.userId })
    expect(Object.keys(row!).sort()).toEqual(['date', 'markedAt', 'nodeId', 'ttl', 'userId'])
    expect(JSON.stringify(row)).not.toContain('26.2')
    expect(JSON.stringify(row)).not.toContain('deviceId')
  })

  it('reports the stored count and the viewer as going', async () => {
    const result = await call('post')

    expect(result).toEqual({ date: NIGHT, goingCount: 1, viewerGoing: true })
  })
})

// ─── Idempotency ─────────────────────────────────────────────────────────────

describe('POST /v1/nodes/:nodeId/going — marking twice is one row (R9.1)', () => {
  it('leaves one row and one count', async () => {
    await call('post')
    const first = stored.get(`${goingVenuePk(NODE_ID, NIGHT)}|${goingVenueSk(h.userId)}`)!['markedAt']

    vi.setSystemTime(NOW_MS + 90_000)
    const result = await call('post')

    expect(result).toMatchObject({ goingCount: 1, viewerGoing: true })
    expect(stored.size).toBe(2) // the pair, not two pairs
    // The first intent keeps its instant: a repeat tap cannot make it look late.
    expect(stored.get(`${goingVenuePk(NODE_ID, NIGHT)}|${goingVenueSk(h.userId)}`)!['markedAt']).toBe(first)
  })
})

// ─── Delete ──────────────────────────────────────────────────────────────────

describe('DELETE /v1/nodes/:nodeId/going — withdrawing intent (R9.1)', () => {
  it('removes both rows of the pair', async () => {
    await call('post')

    const result = await call('delete')

    expect(result).toEqual({ date: NIGHT, goingCount: 0, viewerGoing: false })
    expect(stored.size).toBe(0)
  })

  it('is not an error when there was never a mark', async () => {
    const result = await call('delete')

    expect(result).toEqual({ date: NIGHT, goingCount: 0, viewerGoing: false })
  })

  it('removes a night that has already rolled over when the client names it', async () => {
    await call('post')
    // 05:00 the next morning: the current night is now 2026-03-07.
    vi.setSystemTime(new Date('2026-03-07T05:00:00.000+02:00').getTime())
    expect(goingNightFor()).toBe('2026-03-07')

    const result = await call('delete', { query: { date: NIGHT } })

    expect(result).toMatchObject({ date: NIGHT, goingCount: 0 })
    expect(stored.size).toBe(0)
  })
})

// ─── The night ───────────────────────────────────────────────────────────────

describe('the night a mark belongs to (R9.1)', () => {
  it('accepts a client that names the night the server derived', async () => {
    await expect(call('post', { body: { date: NIGHT } })).resolves.toMatchObject({ date: NIGHT })
  })

  it('rejects a client naming a different night rather than writing the server one', async () => {
    await expect(call('post', { body: { date: '2026-03-07' } })).rejects.toMatchObject({ statusCode: 400 })
    expect(stored.size).toBe(0)
  })

  it('rejects a night that is not a calendar date', async () => {
    await expect(call('post', { body: { date: 'tonight' } })).rejects.toMatchObject({ statusCode: 400 })
    expect(stored.size).toBe(0)
  })

  it('keeps a mark after midnight on the night that is still running', async () => {
    // 01:30 on Saturday belongs to Friday's night (04:00 SAST rollover).
    vi.setSystemTime(new Date('2026-03-07T01:30:00.000+02:00').getTime())

    await expect(call('post')).resolves.toMatchObject({ date: NIGHT })
  })
})

// ─── The owner's line ────────────────────────────────────────────────────────

describe('business:going, the owner-facing count (R9.5)', () => {
  it('tells the owning business the true count, aggregate only', async () => {
    await call('post')

    expect(h.emitBusinessGoing).toHaveBeenCalledTimes(1)
    const [businessId, payload] = h.emitBusinessGoing.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(businessId).toBe(BUSINESS_ID)
    expect(payload).toEqual({ nodeId: NODE_ID, nodeName: 'Ramona', date: NIGHT, goingCount: 1 })
    // No consumer identity travels with intent.
    expect(Object.keys(payload).sort()).toEqual(['date', 'goingCount', 'nodeId', 'nodeName'])
    expect(JSON.stringify(payload)).not.toContain(h.userId)
  })

  it('reports zero honestly when the mark is withdrawn', async () => {
    await call('post')
    h.emitBusinessGoing.mockClear()

    await call('delete')

    expect(h.emitBusinessGoing).toHaveBeenCalledTimes(1)
    expect(h.emitBusinessGoing.mock.calls[0]![1]).toMatchObject({ goingCount: 0 })
  })

  it('awaits the fan-out, so the Lambda cannot freeze before it leaves', async () => {
    let settled = false
    h.emitBusinessGoing.mockImplementation(async () => {
      await Promise.resolve()
      settled = true
      return 1
    })

    await call('post')

    expect(settled).toBe(true)
  })

  it('sends nothing for a venue with no owning business', async () => {
    h.getNodeById.mockResolvedValue({ id: NODE_ID, name: 'Ramona' })

    await call('post')

    expect(h.emitBusinessGoing).not.toHaveBeenCalled()
  })
})

// ─── Boundaries ──────────────────────────────────────────────────────────────

describe('Going boundaries (R9.1)', () => {
  it('requires a consumer session on both routes', async () => {
    await captureRoutes()

    expect(h.authRoles.filter((roles) => roles.length === 1 && roles[0] === 'consumer').length).toBeGreaterThanOrEqual(
      2,
    )
  })

  it('writes nothing for an unauthenticated caller', async () => {
    await expect(call('post', { authenticated: false })).rejects.toMatchObject({ statusCode: 401 })
    expect(stored.size).toBe(0)
  })

  it('refuses a mark for a venue that does not exist', async () => {
    h.getNodeById.mockResolvedValue(null)

    await expect(call('post')).rejects.toMatchObject({ statusCode: 404 })
    expect(stored.size).toBe(0)
  })

  it('rate limits on the going key with the shared sliding window', async () => {
    await call('post')

    expect(h.kvIncr).toHaveBeenCalledWith(`ratelimit:${GOING_RATE_LIMIT.key}:${IP}`, GOING_RATE_LIMIT.windowSeconds)
  })

  it('writes nothing once the budget is spent', async () => {
    h.kvIncr.mockResolvedValue(GOING_RATE_LIMIT.max + 1)

    await expect(call('post')).rejects.toMatchObject({ statusCode: 429 })
    expect(stored.size).toBe(0)
  })

  it('rate limits the delete on the same budget', async () => {
    h.kvIncr.mockResolvedValue(GOING_RATE_LIMIT.max + 1)

    await expect(call('delete')).rejects.toMatchObject({ statusCode: 429 })
  })
})
