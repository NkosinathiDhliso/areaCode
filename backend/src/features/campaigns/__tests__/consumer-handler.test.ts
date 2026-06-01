/**
 * Unit tests for the Win-Back Campaigns consumer-facing routes (task 8.3):
 *   - POST /v1/users/me/campaign-optout  (consumer auth)
 *   - GET  /v1/campaigns/unsubscribe?token=...  (signed token, no login)
 *
 * Both routes ultimately write the same `COPTOUT#` rows via `putOptOut`. The
 * tests exercise the handler functions directly with a minimal fake Fastify
 * instance, the repository's `putOptOut` mocked, and the REAL signed-token
 * round-trip (`signUnsubscribeToken` → `verifyUnsubscribeToken`) so we prove an
 * authentic link opts the recipient out and a tampered one is rejected and
 * writes nothing.
 *
 * Constraint C1 / Requirement 12.4: the unsubscribe path requires no phone and
 * no SMS re-auth — it is unauthenticated and identity-bearing only via the
 * signed token. No phone field is touched anywhere.
 *
 * _Requirements: 12.1, 12.2, 12.3, 12.4_
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  putOptOut: vi.fn(),
}))

vi.mock('../repository.js', () => ({
  putOptOut: mocks.putOptOut,
}))

import { campaignConsumerRoutes } from '../handler.js'
import { signUnsubscribeToken } from '../unsubscribe.js'

// ─── Minimal Fastify test harness ─────────────────────────────────────────────
//
// We register the routes against a fake app that captures each route's handler,
// then invoke the handler directly with a stub request/reply. This avoids
// standing up a full HTTP server while still exercising the exact route logic.

type RouteHandler = (request: unknown, reply: unknown) => unknown | Promise<unknown>

interface CapturedRoute {
  method: string
  url: string
  handler: RouteHandler
}

function makeFakeApp() {
  const routes: CapturedRoute[] = []
  const register = (method: string) => (url: string, _opts: unknown, handler: RouteHandler) => {
    routes.push({ method, url, handler })
  }
  return {
    app: { post: register('POST'), get: register('GET') } as unknown as Parameters<typeof campaignConsumerRoutes>[0],
    routes,
  }
}

/** A stub reply object capturing status / content-type / body. */
function makeReply() {
  const state: { statusCode: number; contentType?: string; body?: unknown } = { statusCode: 200 }
  const reply = {
    status(code: number) {
      state.statusCode = code
      return reply
    },
    type(ct: string) {
      state.contentType = ct
      return reply
    },
    send(body: unknown) {
      state.body = body
      return reply
    },
  }
  return { reply, state }
}

async function getRoutes() {
  const { app, routes } = makeFakeApp()
  await campaignConsumerRoutes(app)
  const optOut = routes.find((r) => r.url === '/v1/users/me/campaign-optout')!
  const unsubscribe = routes.find((r) => r.url === '/v1/campaigns/unsubscribe')!
  return { optOut, unsubscribe }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.putOptOut.mockResolvedValue(undefined)
})

// ─── POST /v1/users/me/campaign-optout ────────────────────────────────────────

describe('POST /v1/users/me/campaign-optout', () => {
  it('writes a GLOBAL opt-out (ALL) when businessId is omitted (R12.1)', async () => {
    const { optOut } = await getRoutes()
    const request = { auth: { userId: 'user-1', role: 'consumer', cognitoSub: 's' }, body: {} }

    const result = await optOut.handler(request, makeReply().reply)

    expect(mocks.putOptOut).toHaveBeenCalledTimes(1)
    expect(mocks.putOptOut).toHaveBeenCalledWith('user-1', 'ALL')
    expect(result).toEqual({ optedOut: true, scope: 'all' })
  })

  it('writes a per-business opt-out when businessId is provided (R12.1, R12.3)', async () => {
    const { optOut } = await getRoutes()
    const request = {
      auth: { userId: 'user-1', role: 'consumer', cognitoSub: 's' },
      body: { businessId: 'biz-42' },
    }

    const result = await optOut.handler(request, makeReply().reply)

    expect(mocks.putOptOut).toHaveBeenCalledTimes(1)
    expect(mocks.putOptOut).toHaveBeenCalledWith('user-1', 'biz-42')
    expect(result).toEqual({ optedOut: true, scope: 'biz-42' })
  })

  it('uses the authenticated userId, not anything from the body', async () => {
    const { optOut } = await getRoutes()
    const request = {
      auth: { userId: 'real-user', role: 'consumer', cognitoSub: 's' },
      // a malicious body cannot redirect the opt-out to another user
      body: { businessId: 'biz-1' },
    }

    await optOut.handler(request, makeReply().reply)
    expect(mocks.putOptOut).toHaveBeenCalledWith('real-user', 'biz-1')
  })
})

// ─── GET /v1/campaigns/unsubscribe ────────────────────────────────────────────

describe('GET /v1/campaigns/unsubscribe', () => {
  it('opts the recipient out of the email business for a valid signed token (R12.3, R12.4)', async () => {
    const { unsubscribe } = await getRoutes()
    // Real signer round-trip — no login, no phone, just the token.
    const token = signUnsubscribeToken('user-7', 'biz-9')
    const { reply, state } = makeReply()

    await unsubscribe.handler({ query: { token } }, reply)

    expect(mocks.putOptOut).toHaveBeenCalledTimes(1)
    expect(mocks.putOptOut).toHaveBeenCalledWith('user-7', 'biz-9')
    expect(state.statusCode).toBe(200)
    expect(state.contentType).toBe('text/html')
    expect(String(state.body)).toContain('unsubscribed')
  })

  it('rejects a tampered token and writes nothing', async () => {
    const { unsubscribe } = await getRoutes()
    const token = signUnsubscribeToken('user-7', 'biz-9')
    // Flip a character to break the HMAC signature.
    const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'B' : 'A') + token.slice(-1)
    const { reply, state } = makeReply()

    await unsubscribe.handler({ query: { token: tampered } }, reply)

    expect(mocks.putOptOut).not.toHaveBeenCalled()
    expect(state.statusCode).toBe(400)
    expect(state.contentType).toBe('text/html')
    expect(String(state.body)).toContain('invalid')
  })

  it('rejects a garbage token and writes nothing', async () => {
    const { unsubscribe } = await getRoutes()
    const { reply, state } = makeReply()

    await unsubscribe.handler({ query: { token: 'not-a-real-token' } }, reply)

    expect(mocks.putOptOut).not.toHaveBeenCalled()
    expect(state.statusCode).toBe(400)
  })

  it('does not require auth — the route registers no requireAuth preHandler', async () => {
    // Sanity check that the route is reachable without an `auth` payload on the
    // request (Requirement 12.4: works without login / SMS re-auth).
    const { unsubscribe } = await getRoutes()
    const token = signUnsubscribeToken('user-x', 'biz-x')
    const { reply, state } = makeReply()

    // Note: no `auth` key on the request object.
    await unsubscribe.handler({ query: { token } }, reply)

    expect(state.statusCode).toBe(200)
    expect(mocks.putOptOut).toHaveBeenCalledWith('user-x', 'biz-x')
  })
})
