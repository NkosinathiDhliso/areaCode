/**
 * Integration tests for the Digest read routes (task 6.1).
 *
 * Validates: Requirements 4.1
 *
 * Coverage:
 *   1. GET /v1/business/digest/latest — an authenticated business resolves its
 *      businessId from the JWT (auth.userId) and gets the service view back,
 *      including the empty state when no digest exists.
 *   2. GET /v1/business/digest/history — same auth; the optional cursor is
 *      passed straight through to the service and { items, nextCursor } is
 *      returned.
 *   3. Fail-closed auth — an unauthenticated request is 401 and the service
 *      never runs; a staff-pool token is rejected (routes gate on the business
 *      pool only, per the design).
 *
 * Strategy mirrors settings-digest-optout.test.ts: requireAuth is mocked to a
 * Bearer-token → session lookup and the business service is mocked so routing
 * and auth are exercised without a live DynamoDB.
 */

import type { FastifyInstance } from 'fastify'
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

interface Session {
  userId: string
  role: 'consumer' | 'business' | 'staff' | 'admin'
  cognitoSub: string
  businessId?: string
}

const SESSIONS: Record<string, Session> = {
  owner: { userId: 'owner-biz', role: 'business', cognitoSub: 'sub-owner' },
  staff: { userId: 'staff-1', role: 'staff', cognitoSub: 'sub-staff', businessId: 'biz-1' },
}

vi.mock('../../../shared/middleware/auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/middleware/auth.js')>()
  const { AppError } = await import('../../../shared/errors/AppError.js')
  return {
    ...actual,
    requireAuth:
      (...roles: string[]) =>
      async (request: { headers: Record<string, unknown>; auth?: Session }) => {
        const header = request.headers['authorization']
        const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : ''
        const session = SESSIONS[token]
        if (!session) throw AppError.unauthorized('Invalid or expired token')
        if (!roles.includes(session.role)) throw AppError.unauthorized('Invalid or expired token')
        request.auth = session
      },
  }
})

const LATEST_VIEW = {
  digest: {
    weekStart: '2026-07-06',
    metrics: {
      visits: 23,
      uniqueVisitors: 18,
      firstTimeVisitors: 7,
      returningVisitors: 11,
      redemptions: 6,
      firstGetIssued: 9,
      firstGetConversions: 4,
      busiestDay: 'Friday',
      busiestHour: 20,
    },
    deltas: null,
    suppressed: [],
    tierAtBuild: 'growth',
    copy: ['23 visits recorded through Area Code this week.'],
    createdAt: '2026-07-06T20:00:00.000Z',
  },
}

const svc = {
  getLatestDigestView: vi.fn(async (_businessId: string) => LATEST_VIEW),
  getDigestHistoryView: vi.fn(async (_businessId: string, _cursor?: string) => ({
    items: [LATEST_VIEW.digest],
    nextCursor: 'next-cursor',
  })),
}

vi.mock('../service.js', () => svc)

let app: FastifyInstance

beforeAll(async () => {
  process.env['AREA_CODE_ENV'] = 'dev'
  process.env['AREA_CODE_FORCE_LIVE'] = '1'
  const { buildApp } = await import('../../../app')
  app = await buildApp()
  await app.ready()
}, 120_000)

afterAll(async () => {
  await app.close()
  delete process.env['AREA_CODE_FORCE_LIVE']
})

beforeEach(() => {
  svc.getLatestDigestView.mockClear()
  svc.getDigestHistoryView.mockClear()
})

describe('GET /v1/business/digest/latest (R4.1)', () => {
  it('returns the latest digest view, resolving businessId from the JWT', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/business/digest/latest',
      headers: { authorization: 'Bearer owner' },
    })
    expect(response.statusCode).toBe(200)
    expect(svc.getLatestDigestView).toHaveBeenCalledTimes(1)
    expect(svc.getLatestDigestView).toHaveBeenCalledWith('owner-biz')
    const body = response.json() as typeof LATEST_VIEW
    expect(body.digest?.metrics.visits).toBe(23)
    expect(body.digest?.copy.length).toBeGreaterThan(0)
  })

  it('passes through the empty state (digest null) when none exists', async () => {
    svc.getLatestDigestView.mockResolvedValueOnce({ digest: null } as unknown as typeof LATEST_VIEW)
    const response = await app.inject({
      method: 'GET',
      url: '/v1/business/digest/latest',
      headers: { authorization: 'Bearer owner' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ digest: null })
  })

  it('rejects an unauthenticated request with 401 and never runs the service', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/business/digest/latest' })
    expect(response.statusCode).toBe(401)
    expect(svc.getLatestDigestView).not.toHaveBeenCalled()
  })

  it('rejects a staff-pool token (routes gate on the business pool only)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/business/digest/latest',
      headers: { authorization: 'Bearer staff' },
    })
    expect(response.statusCode).toBe(401)
    expect(svc.getLatestDigestView).not.toHaveBeenCalled()
  })
})

describe('GET /v1/business/digest/history (R4.1)', () => {
  it('returns items and nextCursor, passing the cursor through', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/business/digest/history?cursor=page-2-cursor',
      headers: { authorization: 'Bearer owner' },
    })
    expect(response.statusCode).toBe(200)
    expect(svc.getDigestHistoryView).toHaveBeenCalledWith('owner-biz', 'page-2-cursor')
    const body = response.json() as { items: unknown[]; nextCursor: string | null }
    expect(body.items).toHaveLength(1)
    expect(body.nextCursor).toBe('next-cursor')
  })

  it('works with no cursor (first page)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/business/digest/history',
      headers: { authorization: 'Bearer owner' },
    })
    expect(response.statusCode).toBe(200)
    expect(svc.getDigestHistoryView).toHaveBeenCalledWith('owner-biz', undefined)
  })

  it('rejects an unauthenticated request with 401 and never runs the service', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/business/digest/history' })
    expect(response.statusCode).toBe(401)
    expect(svc.getDigestHistoryView).not.toHaveBeenCalled()
  })
})
