/**
 * Integration tests for the Digest_Optout settings route (task 5.2).
 *
 * Validates: Requirements 4.5
 *
 * Coverage:
 *   1. PATCH /v1/business/settings body validation — a non-boolean or missing
 *      `digestEmailOptOut` is rejected 400 before the service runs.
 *   2. Business auth + permission gate — an owner (business pool) persists the
 *      flag; a plain-staff session is 403 (lacks manage_settings); an
 *      unauthenticated request is 401. Fail closed: the service never runs on a
 *      denied request.
 *   3. Persistence — an owner PATCH calls the service with the resolved
 *      businessId and the boolean, and returns the saved value.
 *   4. GET /v1/business/me surfaces `digestEmailOptOut` so the SettingsPanel can
 *      render the current state.
 *
 * Strategy mirrors handler.test.ts: DEV_MODE is OFF (`AREA_CODE_FORCE_LIVE`)
 * so `requireBusinessPermission` does real role resolution; `requireAuth` is
 * mocked to a Bearer-token → session lookup, the auth repo is mocked so each
 * token classifies as owner / manager / plain-staff, and the business service
 * is mocked so authorised requests return 200 without a live DynamoDB.
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
  manager: { userId: 'mgr-1', role: 'staff', cognitoSub: 'sub-mgr', businessId: 'biz-1' },
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

// Role resolution: owner-biz resolves to an owner; mgr-1 to a manager; staff-1
// to a plain staff (only holds redeem_codes, so no manage_settings).
const getBusinessById = vi.fn(async (id: string) => (id === 'owner-biz' ? { businessId: 'owner-biz' } : null))
const getStaffById = vi.fn(async (id: string) => {
  if (id === 'mgr-1') return { staffId: 'mgr-1', businessId: 'biz-1', role: 'manager' }
  if (id === 'staff-1') return { staffId: 'staff-1', businessId: 'biz-1', role: 'staff' }
  return null
})

vi.mock('../../auth/dynamodb-repository.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, getBusinessById, getStaffById }
})

const svc = {
  updateDigestOptOut: vi.fn(async (_businessId: string, optOut: boolean) => ({ digestEmailOptOut: optOut })),
  getBusinessProfile: vi.fn(async () => ({
    id: 'owner-biz',
    businessName: 'Venue One',
    email: 'owner@venue.co.za',
    tier: 'growth',
    digestEmailOptOut: true,
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
  svc.updateDigestOptOut.mockClear()
  svc.getBusinessProfile.mockClear()
  getBusinessById.mockClear()
  getStaffById.mockClear()
})

describe('PATCH /v1/business/settings validates the body (R4.5)', () => {
  it('rejects a non-boolean digestEmailOptOut with 400 and never calls the service', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/business/settings',
      headers: { authorization: 'Bearer owner' },
      payload: { digestEmailOptOut: 'yes' },
    })
    expect(response.statusCode).toBe(400)
    expect(svc.updateDigestOptOut).not.toHaveBeenCalled()
  })

  it('rejects a missing digestEmailOptOut with 400', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/business/settings',
      headers: { authorization: 'Bearer owner' },
      payload: {},
    })
    expect(response.statusCode).toBe(400)
    expect(svc.updateDigestOptOut).not.toHaveBeenCalled()
  })
})

describe('PATCH /v1/business/settings requires business auth (R4.5)', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/business/settings',
      payload: { digestEmailOptOut: true },
    })
    expect(response.statusCode).toBe(401)
    expect(svc.updateDigestOptOut).not.toHaveBeenCalled()
  })

  it('rejects a plain-staff session lacking manage_settings with 403', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/business/settings',
      headers: { authorization: 'Bearer staff' },
      payload: { digestEmailOptOut: true },
    })
    expect(response.statusCode).toBe(403)
    // Fail closed: the handler body never ran.
    expect(svc.updateDigestOptOut).not.toHaveBeenCalled()
  })
})

describe('PATCH /v1/business/settings persists digestEmailOptOut for an owner (R4.5)', () => {
  it('opting out calls the service with the businessId and true, returns the saved value', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/business/settings',
      headers: { authorization: 'Bearer owner' },
      payload: { digestEmailOptOut: true },
    })
    expect(response.statusCode).toBe(200)
    expect(svc.updateDigestOptOut).toHaveBeenCalledTimes(1)
    expect(svc.updateDigestOptOut).toHaveBeenCalledWith('owner-biz', true)
    expect(response.json()).toEqual({ digestEmailOptOut: true })
  })

  it('opting back in persists false', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/business/settings',
      headers: { authorization: 'Bearer owner' },
      payload: { digestEmailOptOut: false },
    })
    expect(response.statusCode).toBe(200)
    expect(svc.updateDigestOptOut).toHaveBeenCalledWith('owner-biz', false)
    expect(response.json()).toEqual({ digestEmailOptOut: false })
  })
})

describe('GET /v1/business/me surfaces digestEmailOptOut (R4.5)', () => {
  it('includes the field so the SettingsPanel can render the current state', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/business/me',
      headers: { authorization: 'Bearer owner' },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json() as Record<string, unknown>
    expect(body).toHaveProperty('digestEmailOptOut', true)
  })
})
