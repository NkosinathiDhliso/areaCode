/**
 * Integration tests for the business-handler view-permission gates (item C).
 *
 * Validates: Requirements 3.1, 3.3, 3.5, 6.4
 *
 * Coverage:
 *   1. Every gated business read route (from the design permission table)
 *      returns 200 for an owner session, 200 for a manager session, and 403
 *      with NO data body for a plain-staff session (which lacks the required
 *      permission). This is the allowed-and-forbidden pair required by R6.4.
 *   2. The permission-free `GET /v1/business/staff/leaderboard` regression:
 *      it still returns 200 for a plain-staff session (Task 3.2 keeps it
 *      ungated so the staff-app MyRank widget keeps working).
 *
 * Strategy:
 *   `requireBusinessPermission` (shared/middleware/business-role.ts) short-
 *   circuits entirely in DEV_MODE — role resolution and the permission check
 *   only run when DEV_MODE is false. So this suite runs with DEV_MODE off
 *   (`AREA_CODE_FORCE_LIVE` set, env still `dev` so `requireEnv` keeps its
 *   local defaults and nothing crashes at init). With DEV_MODE off:
 *     - `requireAuth` would verify a real Cognito JWT, so it is mocked to a
 *       simple Bearer-token → session lookup that injects `request.auth`.
 *     - The role-resolution repo (`auth/dynamodb-repository`) is mocked so
 *       `getBusinessById` / `getStaffById` classify each session as owner,
 *       manager, or plain staff.
 *     - The business service and the staff-redemptions repo read are mocked so
 *       an authorised request returns 200 without a live DynamoDB connection.
 *   The forbidden assertion checks both the 403 status and that the handler's
 *   data-producing dependency was never called (fail closed, no data body).
 */

import type { FastifyInstance } from 'fastify'
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

// ─── Sessions keyed by Bearer token ─────────────────────────────────────────
//
// Each session mirrors the shape `verifyToken` puts on `request.auth` in prod:
//   - owner: business pool, userId === businessId.
//   - manager: staff pool, resolved businessId via the staff row (role manager).
//   - staff: staff pool, plain staff (only holds `redeem_codes`).

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

// ─── Auth middleware mock ────────────────────────────────────────────────────
//
// Keep the real `getAuth`/`getOptionalAuth` (they read `request.auth`); replace
// only `requireAuth` with a Bearer-token → session lookup so no JWKS/Cognito
// call happens. Fails closed exactly like prod: unknown token → 401, and a
// token whose role is not in the route's allowed roles → 401.

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

// ─── Role-resolution repo mock ───────────────────────────────────────────────
//
// `requireBusinessPermission` and the leaderboard handler resolve the caller's
// business role through these two reads. Classify by the injected session's
// userId so each token maps to owner / manager / plain-staff.

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

// ─── Business service mock ───────────────────────────────────────────────────
//
// Authorised requests reach the handler body; these stubs return benign data
// so an owner/manager request is a clean 200 without touching DynamoDB. On a
// 403 the handler body never runs, so the matching stub stays uncalled — that
// is the "no data body" assertion.

const svc = {
  getLiveStats: vi.fn(async () => ({ live: true })),
  getAudienceAnalytics: vi.fn(async () => ({ audience: [] })),
  getCheckInDetails: vi.fn(async () => ({ items: [] })),
  getBusinessRewards: vi.fn(async () => ({ items: [] })),
  getRewardsSummary: vi.fn(async () => ({ summary: {} })),
  getRewardMetrics: vi.fn(async () => ({ metrics: {} })),
  getRecentRedemptions: vi.fn(async () => []),
  listStaff: vi.fn(async () => []),
  listStaffInvites: vi.fn(async () => []),
  getQrData: vi.fn(async () => ({ qr: 'token' })),
  getCurrentNodeQr: vi.fn(async () => ({ qr: 'token' })),
  getStaffLeaderboard: vi.fn(async () => ({ items: [] })),
}

vi.mock('../service.js', () => svc)

// The staff/:staffId/redemptions route reads through the rewards repo, not the
// business service; stub that one read too.
const getRedemptionsByStaffId = vi.fn(async () => [])
vi.mock('../../rewards/repository.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, getRedemptionsByStaffId }
})

// ─── Route table (mirrors the design permission table) ───────────────────────

const VALID_UUID = '11111111-1111-4111-8111-111111111111'

interface GatedRoute {
  name: string
  url: string
  permission: string
  /** The data-producing stub that must NOT run when the request is forbidden. */
  guard: ReturnType<typeof vi.fn>
}

const GATED_ROUTES: GatedRoute[] = [
  {
    name: 'me/audience',
    url: '/v1/business/me/audience',
    permission: 'view_audience',
    guard: svc.getAudienceAnalytics,
  },
  { name: 'me/live-stats', url: '/v1/business/me/live-stats', permission: 'view_live', guard: svc.getLiveStats },
  { name: 'check-ins', url: '/v1/business/check-ins', permission: 'view_check_ins', guard: svc.getCheckInDetails },
  { name: 'rewards', url: '/v1/business/rewards', permission: 'view_rewards', guard: svc.getBusinessRewards },
  {
    name: 'rewards/summary',
    url: '/v1/business/rewards/summary',
    permission: 'view_rewards',
    guard: svc.getRewardsSummary,
  },
  {
    name: 'rewards/:rewardId/metrics',
    url: `/v1/business/rewards/${VALID_UUID}/metrics`,
    permission: 'view_metrics',
    guard: svc.getRewardMetrics,
  },
  {
    name: 'me/recent-redemptions',
    url: '/v1/business/me/recent-redemptions',
    permission: 'view_rewards',
    guard: svc.getRecentRedemptions,
  },
  { name: 'staff (list)', url: '/v1/business/staff', permission: 'view_staff', guard: svc.listStaff },
  {
    name: 'staff/invites',
    url: '/v1/business/staff/invites',
    permission: 'view_staff',
    guard: svc.listStaffInvites,
  },
  {
    name: 'staff/:staffId/redemptions',
    url: `/v1/business/staff/${VALID_UUID}/redemptions`,
    permission: 'view_staff',
    guard: getRedemptionsByStaffId,
  },
  {
    name: 'nodes/:nodeId/qr',
    url: `/v1/business/nodes/${VALID_UUID}/qr`,
    permission: 'view_qr',
    guard: svc.getQrData,
  },
  {
    name: 'nodes/current/qr',
    url: '/v1/business/nodes/current/qr',
    permission: 'view_qr',
    guard: svc.getCurrentNodeQr,
  },
]

// ─── Fastify app lifecycle ───────────────────────────────────────────────────

let app: FastifyInstance

beforeAll(async () => {
  // DEV_MODE must be OFF so requireBusinessPermission does real role resolution
  // and permission checks. Env stays `dev` so requireEnv keeps local defaults.
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
  for (const fn of Object.values(svc)) fn.mockClear()
  getRedemptionsByStaffId.mockClear()
  getBusinessById.mockClear()
  getStaffById.mockClear()
})

// ─── Gated reads: allowed (owner, manager) and forbidden (plain staff) ───────

describe('business read routes enforce their view permission (item C)', () => {
  for (const route of GATED_ROUTES) {
    describe(`GET ${route.name} (${route.permission})`, () => {
      it('owner → 200', async () => {
        const response = await app.inject({
          method: 'GET',
          url: route.url,
          headers: { authorization: 'Bearer owner' },
        })
        expect(response.statusCode).toBe(200)
        expect(route.guard).toHaveBeenCalledTimes(1)
      })

      it('manager → 200', async () => {
        const response = await app.inject({
          method: 'GET',
          url: route.url,
          headers: { authorization: 'Bearer manager' },
        })
        expect(response.statusCode).toBe(200)
        expect(route.guard).toHaveBeenCalledTimes(1)
      })

      it('plain staff lacking the permission → 403 with no data body', async () => {
        const response = await app.inject({
          method: 'GET',
          url: route.url,
          headers: { authorization: 'Bearer staff' },
        })
        expect(response.statusCode).toBe(403)

        // Fail closed: the handler body never ran, so no data was produced.
        expect(route.guard).not.toHaveBeenCalled()

        // The body is the typed error shape, never a data payload.
        const body = response.json() as Record<string, unknown>
        expect(body['statusCode']).toBe(403)
        expect(typeof body['error']).toBe('string')
        expect(body).not.toHaveProperty('items')
        expect(body).not.toHaveProperty('audience')
        expect(body).not.toHaveProperty('qr')
      })
    })
  }
})

// ─── Leaderboard regression: permission-free for plain staff (Task 3.2) ──────

describe('GET /v1/business/staff/leaderboard stays permission-free (item C, R3.5)', () => {
  it('plain-staff session → 200 (the staff-app MyRank widget keeps working)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/business/staff/leaderboard',
      headers: { authorization: 'Bearer staff' },
    })
    expect(response.statusCode).toBe(200)
    // Resolved the businessId from the staff row and served the leaderboard.
    expect(svc.getStaffLeaderboard).toHaveBeenCalledTimes(1)
    expect(svc.getStaffLeaderboard).toHaveBeenCalledWith('biz-1', 'week')
  })

  it('owner session → 200', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/business/staff/leaderboard',
      headers: { authorization: 'Bearer owner' },
    })
    expect(response.statusCode).toBe(200)
    expect(svc.getStaffLeaderboard).toHaveBeenCalledWith('owner-biz', 'week')
  })
})
