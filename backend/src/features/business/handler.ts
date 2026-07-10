import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { getVerifiedEmailBySub } from '../../shared/cognito/client.js'
import { AppError } from '../../shared/errors/AppError.js'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { requireBusinessPermission, getBusinessRole } from '../../shared/middleware/business-role.js'
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit.js'
import { validate } from '../../shared/middleware/validation.js'
import { getRedemptionsByStaffId } from '../rewards/repository.js'

import { MalformedCursorError } from './repository.js'
import * as service from './service.js'
import {
  checkoutBodySchema,
  trialStartBodySchema,
  boostBodySchema,
  staffInviteBodySchema,
  staffInviteTokenParamsSchema,
  staffIdParamsSchema,
  businessSettingsBodySchema,
} from './types.js'

const nodeIdParamsSchema = z.object({ nodeId: z.string().uuid() })
const staffRedemptionParamsSchema = z.object({ staffId: z.string().uuid() })

// Weekly Attribution Digest history pagination (weekly-attribution-digest
// R4.1). `cursor` is an opaque, optional base64 DynamoDB key echoed back from a
// prior page; validated only as a non-empty string here (the repository decodes
// it). No cursor means the first (newest) page.
const digestHistoryQuerySchema = z.object({ cursor: z.string().min(1).optional() })
const checkInQuerySchema = z.object({
  date: z.string().optional(),
  cursor: z.string().optional(),
})

// R6.1–R6.6: operator boost-purchases panel. Path-level `businessId` is
// matched against the JWT's businessId claim (auth.userId for the business
// role) to enforce R6.3. Cursor is optional and validated as an opaque
// string; the repo's MalformedCursorError is caught below and mapped to
// 400 INVALID_CURSOR (R6.4). Limit defaults to 25 and is capped at 100.
const businessIdParamsSchema = z.object({ businessId: z.string().min(1).max(64) })
const boostPurchasesQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
})

// R4.6: the admin floor routes accept `:duration` strictly in {2hr,6hr,24hr};
// any other value is rejected with 400 by the validate middleware before
// reaching the service layer. Mirrors the enum on `BoostDuration` in
// types.ts so a typo here would surface at compile time too.
const boostFloorDurationParamsSchema = z.object({
  duration: z.enum(['2hr', '6hr', '24hr']),
})

// R4.3: floor-update body. `floorCents` must be a positive integer in
// [1, 1_000_000] (0.01–10 000.00 ZAR); `changeReason` is an optional free-text
// field bounded at 280 chars. Anything outside these ranges yields 400 from
// the validate middleware and never touches DynamoDB.
const boostFloorUpdateBodySchema = z.object({
  floorCents: z.number().int().min(1).max(1_000_000),
  changeReason: z.string().min(1).max(280).optional(),
})

// R5.5 / R4.7: the audit-history endpoint paginates with an opaque cursor;
// 25 rows per page is implicit (the service-layer default). We validate only
// that the cursor, when supplied, is a non-empty string.
const boostFloorAuditQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
})

export async function businessRoutes(app: FastifyInstance) {
  // GET /v1/business/me
  app.get('/v1/business/me', { preHandler: [requireAuth('business', 'staff')] }, async (request) => {
    const auth = getAuth(request)
    if (auth.role === 'staff') {
      // Manager accessing business portal — resolve their business via staff record
      const { getStaffById } = await import('../auth/dynamodb-repository.js')
      const staff = await getStaffById(auth.userId)
      if (!staff || staff.role !== 'manager')
        throw (await import('../../shared/errors/AppError.js')).AppError.forbidden('Access denied')
      const { findBusinessById } = await import('./repository.js')
      const biz = await findBusinessById(staff.businessId)
      if (!biz) throw (await import('../../shared/errors/AppError.js')).AppError.notFound('Business not found')
      return biz
    }
    return service.getBusinessProfile(auth.cognitoSub)
  })

  // GET /v1/business/me/onboarding-status
  app.get('/v1/business/me/onboarding-status', { preHandler: [requireAuth('business', 'staff')] }, async (request) => {
    const auth = getAuth(request)
    return service.getOnboardingStatus(auth.userId)
  })

  // GET /v1/business/me/role — returns the current user's role and permissions
  app.get('/v1/business/me/role', { preHandler: [requireAuth('business', 'staff')] }, async (request) => {
    const auth = getAuth(request)
    const { getBusinessById } = await import('../auth/dynamodb-repository.js')
    const { getStaffById } = await import('../auth/dynamodb-repository.js')
    const { ROLE_PERMISSIONS } = await import('./types.js')
    type BusinessMemberRole = import('./types.js').BusinessMemberRole

    let role: BusinessMemberRole = 'owner'
    const business = await getBusinessById(auth.userId)
    if (!business) {
      const staff = await getStaffById(auth.userId)
      if (staff && staff.role === 'manager') {
        role = 'manager'
      } else {
        role = 'staff'
      }
    }

    return { role, permissions: ROLE_PERMISSIONS[role] }
  })

  // GET /v1/business/me/live-stats
  app.get(
    '/v1/business/me/live-stats',
    { preHandler: [requireAuth('business', 'staff'), requireBusinessPermission('view_live')] },
    async (request) => {
      const auth = getAuth(request)
      return service.getLiveStats(auth.userId)
    },
  )

  // GET /v1/business/me/nodes
  app.get('/v1/business/me/nodes', { preHandler: [requireAuth('business', 'staff')] }, async (request) => {
    const auth = getAuth(request)
    return service.getBusinessNodes(auth.userId)
  })

  // GET /v1/business/me/audience
  app.get(
    '/v1/business/me/audience',
    { preHandler: [requireAuth('business', 'staff'), requireBusinessPermission('view_audience')] },
    async (request) => {
      const auth = getAuth(request)
      return service.getAudienceAnalytics(auth.userId)
    },
  )

  // GET /v1/business/me/recent-redemptions
  app.get(
    '/v1/business/me/recent-redemptions',
    { preHandler: [requireAuth('business', 'staff'), requireBusinessPermission('view_rewards')] },
    async (request) => {
      const auth = getAuth(request)
      return service.getRecentRedemptions(auth.userId)
    },
  )

  // GET /v1/business/rewards
  app.get(
    '/v1/business/rewards',
    { preHandler: [requireAuth('business', 'staff'), requireBusinessPermission('view_rewards')] },
    async (request) => {
      const auth = getAuth(request)
      return service.getBusinessRewards(auth.userId)
    },
  )

  // GET /v1/business/nodes/current/qr
  app.get(
    '/v1/business/nodes/current/qr',
    { preHandler: [requireAuth('business', 'staff'), requireBusinessPermission('view_qr')] },
    async (request) => {
      const auth = getAuth(request)
      return service.getCurrentNodeQr(auth.userId)
    },
  )

  // GET /v1/business/plans
  app.get('/v1/business/plans', async () => {
    return service.getPlans()
  })

  // POST /v1/business/checkout
  app.post(
    '/v1/business/checkout',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission('manage_billing'),
        validate({ body: checkoutBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof checkoutBodySchema>
      return service.createCheckoutSession(auth.userId, body.plan, body.interval)
    },
  )

  // POST /v1/business/trial/start
  // Activates a 14-day free trial on the Growth or Pro plan. One trial per
  // business, ever. Paying starts after the trial ends (Yoco checkout from
  // the Plans panel reminder, or via the same /v1/business/checkout route).
  app.post(
    '/v1/business/trial/start',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission('manage_billing'),
        rateLimitMiddleware({ key: 'trial-start', max: 5, windowSeconds: 300 }),
        validate({ body: trialStartBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof trialStartBodySchema>
      return service.startTrial(auth.userId, body.plan)
    },
  )

  // POST /v1/business/boost
  app.post(
    '/v1/business/boost',
    {
      preHandler: [requireAuth('business', 'staff'), validate({ body: boostBodySchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof boostBodySchema>
      return service.purchaseBoost(auth.userId, body.nodeId, body.duration)
    },
  )

  // GET /v1/business/:businessId/boost-purchases
  // Operator-facing recent BoosterPurchase rows for one business, newest-first
  // with cursor pagination (R6.1, R6.2, R6.4). The JWT's businessId claim
  // (resolved by requireAuth into auth.userId) MUST equal the path-level
  // businessId or we return 403 (R6.3). Rows are projected to the operator-
  // safe view in the service layer so tierSnapshot, neighbourhoodIdSnapshot,
  // and floorAtPurchaseCents are not leaked (R6.6).
  app.get(
    '/v1/business/:businessId/boost-purchases',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        validate({ params: businessIdParamsSchema, query: boostPurchasesQuerySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof businessIdParamsSchema>
      const query = request.query as z.infer<typeof boostPurchasesQuerySchema>

      // R6.3: the JWT's businessId claim (auth.userId for business/staff
      // sessions, resolved by requireAuth from custom:businessId or the
      // staff record) must match the path. Mismatches are 403, never a
      // silent empty list, so cross-business probing is impossible.
      if (auth.userId !== params.businessId) {
        throw AppError.forbidden('Access denied')
      }

      const cursor = query.cursor ?? null
      const limit = query.limit ?? 25

      try {
        return await service.listBoosterPurchasesForBusiness(params.businessId, cursor, limit)
      } catch (err) {
        // R6.4: a malformed cursor surfaces from the repo as
        // MalformedCursorError; map to a typed 400 so the operator panel
        // can render an inline error instead of a generic 500.
        if (err instanceof MalformedCursorError) {
          throw new AppError(400, 'INVALID_CURSOR', 'Invalid pagination cursor')
        }
        throw err
      }
    },
  )

  // GET /v1/business/subscription-payments
  // Operator-facing recent Subscription_Payment_Row entries for the caller's
  // own business, newest-first with cursor pagination (R7.5). Mirrors the
  // boost-purchases endpoint above: same `requireAuth('business', 'staff')`
  // gate, same (cursor, limit) query schema, same 400-on-malformed-cursor
  // handling. There is no path-level businessId here — the business scope is
  // resolved from the auth context (auth.userId), the same identifier the
  // boost-purchases route matches against. Rows are projected to the
  // `SubscriptionPaymentView` in the service layer (business identifiers and
  // amounts only, no PII).
  app.get(
    '/v1/business/subscription-payments',
    {
      preHandler: [requireAuth('business', 'staff'), validate({ query: boostPurchasesQuerySchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const query = request.query as z.infer<typeof boostPurchasesQuerySchema>

      const cursor = query.cursor ?? null
      const limit = query.limit ?? 25

      try {
        return await service.listSubscriptionPaymentsForBusiness(auth.userId, cursor, limit)
      } catch (err) {
        // A malformed cursor surfaces from the repo as MalformedCursorError;
        // map to a typed 400 so the panel can render an inline error instead
        // of a generic 500 (R7.5, parity with the boost-purchases route).
        if (err instanceof MalformedCursorError) {
          throw new AppError(400, 'INVALID_CURSOR', 'Invalid pagination cursor')
        }
        throw err
      }
    },
  )

  // POST /v1/webhooks/yoco
  app.post(
    '/v1/webhooks/yoco',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'yoco-webhook', max: 100, windowSeconds: 60, identifierFn: () => 'yoco' }),
      ],
    },
    async (request, reply) => {
      const signature = (request.headers['x-yoco-signature'] as string) ?? ''
      const body = request.body as Record<string, unknown>
      const rawBody = (request as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(body)
      const eventId = (body['id'] as string) ?? ''
      const eventType = (body['type'] as string) ?? ''

      const result = await service.processYocoWebhook(eventId, eventType, body, signature, rawBody)
      return reply.status(200).send({ ok: true, duplicate: result.duplicate })
    },
  )

  // POST /v1/business/staff/invite
  app.post(
    '/v1/business/staff/invite',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission('manage_staff'),
        validate({ body: staffInviteBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as { phone?: string; email?: string; role?: 'manager' | 'staff' }
      const inviteRole = body.role ?? 'staff'
      // Only owners can invite managers
      if (inviteRole === 'manager') {
        const { getBusinessRole } = await import('../../shared/middleware/business-role.js')
        const bizRole = getBusinessRole(request)
        if (bizRole.memberRole !== 'owner') {
          throw (await import('../../shared/errors/AppError.js')).AppError.forbidden(
            'Only the owner can invite managers.',
          )
        }
      }
      return service.inviteStaff(auth.userId, body.phone, body.email, inviteRole)
    },
  )

  // GET /v1/business/staff
  // Returns { items } to match the list-shape convention used by
  // /v1/business/staff/invites and consumed by both SettingsPanel and
  // StaffRedemptionPanel. One shape, everywhere.
  app.get(
    '/v1/business/staff',
    { preHandler: [requireAuth('business', 'staff'), requireBusinessPermission('view_staff')] },
    async (request) => {
      const auth = getAuth(request)
      const items = await service.listStaff(auth.userId)
      return { items }
    },
  )

  // GET /v1/business/staff/invites
  app.get(
    '/v1/business/staff/invites',
    { preHandler: [requireAuth('business', 'staff'), requireBusinessPermission('view_staff')] },
    async (request) => {
      const auth = getAuth(request)
      const invites = await service.listStaffInvites(auth.userId)
      return { items: invites }
    },
  )

  // DELETE /v1/business/staff/invites/:token
  app.delete(
    '/v1/business/staff/invites/:token',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission('manage_staff'),
        validate({ params: staffInviteTokenParamsSchema }),
      ],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof staffInviteTokenParamsSchema>
      await service.revokeStaffInvite(auth.userId, params.token)
      return reply.status(204).send()
    },
  )

  // DELETE /v1/business/staff/:id
  app.delete(
    '/v1/business/staff/:id',
    {
      preHandler: [requireAuth('business', 'staff'), validate({ params: staffIdParamsSchema })],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof staffIdParamsSchema>
      await service.removeStaff(params.id, auth.userId)
      return reply.status(204).send()
    },
  )

  // GET /v1/business/nodes/:nodeId/qr
  app.get(
    '/v1/business/nodes/:nodeId/qr',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission('view_qr'),
        validate({ params: nodeIdParamsSchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof nodeIdParamsSchema>
      return service.getQrData(params.nodeId, auth.userId)
    },
  )

  // GET /v1/business/staff/:staffId/redemptions
  app.get(
    '/v1/business/staff/:staffId/redemptions',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission('view_staff'),
        validate({ params: staffRedemptionParamsSchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof staffRedemptionParamsSchema>
      const items = await getRedemptionsByStaffId(params.staffId, auth.userId)
      return { items }
    },
  )

  // GET /v1/business/staff/leaderboard?period=week|month|all
  app.get('/v1/business/staff/leaderboard', { preHandler: [requireAuth('business', 'staff')] }, async (request) => {
    const auth = getAuth(request)
    const period = ((request.query as Record<string, string>)['period'] ?? 'week') as 'week' | 'month' | 'all'
    if (!['week', 'month', 'all'].includes(period)) {
      throw (await import('../../shared/errors/AppError.js')).AppError.badRequest('Invalid period')
    }

    // Resolve businessId. Owners: auth.userId === businessId. Managers / staff:
    // resolve via staff record. Anyone else gets a 403 — leaderboard is sensitive.
    let businessId = auth.userId
    if (auth.role === 'staff') {
      const { getStaffById } = await import('../auth/dynamodb-repository.js')
      const staff = await getStaffById(auth.userId)
      if (!staff) throw (await import('../../shared/errors/AppError.js')).AppError.forbidden('Access denied')
      businessId = staff.businessId
    }
    return service.getStaffLeaderboard(businessId, period)
  })

  // GET /v1/business/check-ins
  app.get(
    '/v1/business/check-ins',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission('view_check_ins'),
        validate({ query: checkInQuerySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const query = request.query as z.infer<typeof checkInQuerySchema>
      return service.getCheckInDetails(auth.userId, query.date, query.cursor)
    },
  )

  // GET /v1/business/rewards/:rewardId/metrics
  app.get(
    '/v1/business/rewards/:rewardId/metrics',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission('view_metrics'),
        validate({ params: z.object({ rewardId: z.string().uuid() }) }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const params = request.params as { rewardId: string }
      return service.getRewardMetrics(params.rewardId, auth.userId)
    },
  )

  // GET /v1/business/rewards/summary
  app.get(
    '/v1/business/rewards/summary',
    { preHandler: [requireAuth('business', 'staff'), requireBusinessPermission('view_rewards')] },
    async (request) => {
      const auth = getAuth(request)
      return service.getRewardsSummary(auth.userId)
    },
  )

  // POST /v1/business/downgrade
  app.post(
    '/v1/business/downgrade',
    { preHandler: [requireAuth('business', 'staff'), requireBusinessPermission('manage_billing')] },
    async (request) => {
      const auth = getAuth(request)
      return service.downgradeToFree(auth.userId)
    },
  )

  // GET /v1/business/digest/latest
  // Latest Weekly Attribution Digest for the authenticated business
  // (weekly-attribution-digest R4.1). `requireAuth('business')` gates on the
  // business Cognito pool, so `auth.userId` IS the businessId (the same
  // identifier the other business-scoped reads resolve from). Returns the raw
  // Attribution_Metrics plus the rendered copy strings (one source of truth with
  // the Digest_Email, R4.3), or a clean `{ digest: null }` when no digest has
  // been generated yet — an honest empty state, never an error. camelCase JSON,
  // typed errors, fail-closed auth (401 when unauthenticated).
  app.get('/v1/business/digest/latest', { preHandler: [requireAuth('business')] }, async (request) => {
    const auth = getAuth(request)
    return service.getLatestDigestView(auth.userId)
  })

  // GET /v1/business/digest/history?cursor=...
  // Prior Digests for the authenticated business, newest first, with cursor
  // pagination (weekly-attribution-digest R4.1). Same `requireAuth('business')`
  // gate and businessId resolution as the latest route. Each item carries
  // metrics plus copy strings; the opaque cursor is echoed back from a prior
  // page and passed straight through to the reports repository. Returns
  // `{ items, nextCursor }` (nextCursor null on the last page).
  app.get(
    '/v1/business/digest/history',
    { preHandler: [requireAuth('business'), validate({ query: digestHistoryQuerySchema })] },
    async (request) => {
      const auth = getAuth(request)
      const query = request.query as z.infer<typeof digestHistoryQuerySchema>
      return service.getDigestHistoryView(auth.userId, query.cursor)
    },
  )

  // PATCH /v1/business/settings
  // Weekly Attribution Digest opt-out preference (weekly-attribution-digest
  // R4.5). Body `{ digestEmailOptOut: boolean }` is Zod-validated (a non-boolean
  // or missing field is rejected 400 by the validate middleware). Gated by
  // `manage_settings`, an owner-only permission, matching the write-permission
  // convention of the other business routes. The service persists the flag via
  // the shared `updateBusiness` write path; the report generator honours it from
  // the next weekly run. camelCase JSON, typed errors only.
  app.patch(
    '/v1/business/settings',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission('manage_settings'),
        validate({ body: businessSettingsBodySchema }),
      ],
    },
    async (request) => {
      // Use the businessId resolved by requireBusinessPermission, not
      // auth.userId. For a manager (staff pool) auth.userId is the staffId; the
      // real businessId sits on request.businessRole. Passing auth.userId would
      // target the wrong id and (with the old upsert) write a phantom row.
      const { businessId } = getBusinessRole(request)
      const body = request.body as z.infer<typeof businessSettingsBodySchema>
      return service.updateDigestOptOut(businessId, body.digestEmailOptOut)
    },
  )

  // ─── Admin Boost Floor routes (R4, R5) ──────────────────────────────────
  //
  // Per the booster-pricing-floor-and-audit spec (Task 7.2), the admin
  // floor-editor lives in the existing business-handler Lambda alongside the
  // operator boost-purchases route. All three routes below require an admin
  // JWT via `requireAuth('admin')`; non-admin tokens are rejected with 401
  // by the middleware itself (the requested role doesn't match), satisfying
  // R4.5 in practice — for explicit coverage, see the role check used by
  // analogous admin endpoints in features/admin/handler.ts. Audit-write
  // failures inside `service.updateBoostFloor` propagate to the global
  // error handler in app.ts which maps non-AppError throws to 500 (R5.3).

  // GET /v1/admin/boost-floors — return the three BoostFloorView entries
  // (one per duration) including default-fallback rows for un-edited
  // durations (R4.2, R4.8).
  app.get('/v1/admin/boost-floors', { preHandler: [requireAuth('admin')] }, async () => {
    const items = await service.getBoostFloors()
    return { items }
  })

  // PUT /v1/admin/boost-floors/:duration — admin updates one floor. The
  // validate middleware enforces R4.6 (duration enum) and R4.3 (floorCents
  // integer in [1, 1_000_000], changeReason optional 1..280 chars) and
  // returns 400 on parse failure. The service writes the audit row before
  // the floor row; if the audit write fails the thrown error reaches the
  // global error handler as a 500 (R5.3).
  app.put(
    '/v1/admin/boost-floors/:duration',
    {
      preHandler: [
        requireAuth('admin'),
        validate({
          params: boostFloorDurationParamsSchema,
          body: boostFloorUpdateBodySchema,
        }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof boostFloorDurationParamsSchema>
      const body = request.body as z.infer<typeof boostFloorUpdateBodySchema>

      // R5.1: the audit row records `changedBy` (Cognito sub) and
      // `changedByEmail`. The access token usually carries `email` for
      // federated/native admin sessions; if it doesn't, fall back to
      // reading the verified attribute from the admin Cognito pool. As a
      // last resort use a non-routable placeholder so the audit row still
      // satisfies the 3..254-char schema constraint and the change is not
      // silently dropped. The Cognito sub in `changedBy` remains the
      // authoritative identifier.
      let email = auth.email
      if (!email) {
        email = await getVerifiedEmailBySub('admin', auth.cognitoSub)
      }
      if (!email) {
        email = '<admin-no-email>@areacode.co.za'
      }

      return service.updateBoostFloor(params.duration, body.floorCents, body.changeReason ?? null, {
        sub: auth.cognitoSub,
        email,
      })
    },
  )

  // GET /v1/admin/boost-floors/:duration/audit — paginated, newest-first
  // history of floor changes for one duration (R4.7, R5.5). The service
  // layer defaults `limit` to 25, which is the page size required by R5.5.
  app.get(
    '/v1/admin/boost-floors/:duration/audit',
    {
      preHandler: [
        requireAuth('admin'),
        validate({
          params: boostFloorDurationParamsSchema,
          query: boostFloorAuditQuerySchema,
        }),
      ],
    },
    async (request) => {
      const params = request.params as z.infer<typeof boostFloorDurationParamsSchema>
      const query = request.query as z.infer<typeof boostFloorAuditQuerySchema>
      const cursor = query.cursor ?? null

      try {
        return await service.listFloorChangeAudit(params.duration, cursor)
      } catch (err) {
        // A malformed cursor is the only client-facing failure mode beyond
        // those caught by validate(); map it to 400 with the same code the
        // operator panel uses so admins see a consistent error shape.
        if (err instanceof MalformedCursorError) {
          throw new AppError(400, 'INVALID_CURSOR', 'Invalid pagination cursor')
        }
        throw err
      }
    },
  )

  // ─── Admin Boost Purchase Report (R7) ──────────────────────────────────
  //
  // GET /v1/admin/boost-purchases — cross-business booster purchase report
  // for ops, refund, and dispute support (Task 7.3). Two mutually-exclusive
  // query modes:
  //
  //   - Date-range mode (R7.2): when both `from` and `to` are present, query
  //     GSI1 for rows whose `paidAt` falls in the inclusive ISO range. The
  //     service layer validates the range BEFORE any DynamoDB call and
  //     throws `AppError(400, 'INVALID_DATE_RANGE')` if `from > to` or the
  //     span exceeds `ADMIN_BOOST_REPORT_MAX_RANGE_DAYS` (367 days, R7.5).
  //
  //   - Single-payment mode (R7.2): when neither `from` nor `to` is present
  //     but `yocoCheckoutId` is, look up the Idempotency_Marker and follow
  //     it to the BoosterPurchase row. Returns at most one row, or an empty
  //     result if no marker exists, in the same `{ items, nextCursor }`
  //     shape as date-range mode for response-shape parity.
  //
  // R7.4 dispatch rules:
  //   - Both `from` and `to` present  → date-range mode wins; ignore
  //     `yocoCheckoutId`. A malformed range surfaces as 400 from the
  //     service layer without any fallback to single-payment mode, so a
  //     bad query never silently masquerades as a single-payment lookup.
  //   - Only one of `from`/`to` present → 400 INVALID_QUERY (the operator
  //     intended date-range mode but supplied an incomplete range).
  //   - Neither `from`/`to` and `yocoCheckoutId` present → single-payment.
  //   - Neither `from`/`to` nor `yocoCheckoutId` → 400 INVALID_QUERY.
  //
  // Auth: `requireAuth('admin')` — non-admin tokens are rejected by the
  // middleware before the handler runs (R7.3), matching the floor routes
  // above.
  const boostPurchasesAdminQuerySchema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    yocoCheckoutId: z.string().min(1).max(128).optional(),
    cursor: z.string().min(1).optional(),
  })

  app.get(
    '/v1/admin/boost-purchases',
    {
      preHandler: [requireAuth('admin'), validate({ query: boostPurchasesAdminQuerySchema })],
    },
    async (request) => {
      const query = request.query as z.infer<typeof boostPurchasesAdminQuerySchema>
      const { from, to, yocoCheckoutId, cursor } = query

      const hasFrom = typeof from === 'string' && from.length > 0
      const hasTo = typeof to === 'string' && to.length > 0

      try {
        if (hasFrom && hasTo) {
          // R7.4: when both from/to AND yocoCheckoutId are supplied, the
          // date-range path wins and yocoCheckoutId is intentionally
          // ignored. The service layer enforces R7.5 before any DynamoDB
          // call, so a malformed range surfaces as 400 INVALID_DATE_RANGE
          // and never falls back to single-payment mode.
          return await service.listBoosterPurchasesByDateRange(from, to, cursor ?? null, 25)
        }

        if (hasFrom || hasTo) {
          // Asymmetric range — the operator intended date-range mode but
          // supplied only one bound. Reject explicitly rather than silently
          // falling through to single-payment, which would surprise the
          // caller.
          throw new AppError(400, 'INVALID_QUERY', 'Both from and to required for date-range mode')
        }

        if (yocoCheckoutId !== undefined) {
          // Single-payment mode. Returns at most one row; an empty array
          // when no Idempotency_Marker exists for the supplied id. The
          // response shape mirrors date-range mode (`items`/`nextCursor`)
          // so the admin frontend can render either with one path.
          const row = await service.getBoosterPurchaseByYocoCheckoutId(yocoCheckoutId)
          return { items: row ? [row] : [], nextCursor: null as string | null }
        }

        throw new AppError(400, 'INVALID_QUERY', 'Either from+to or yocoCheckoutId is required')
      } catch (err) {
        // Parity with the other admin/operator boost routes: a malformed
        // pagination cursor surfaces from the repo as MalformedCursorError;
        // map it to 400 INVALID_CURSOR. This only fires on the date-range
        // path (single-payment mode is cursor-less).
        if (err instanceof MalformedCursorError) {
          throw new AppError(400, 'INVALID_CURSOR', 'Invalid pagination cursor')
        }
        throw err
      }
    },
  )

  // ─── Admin Subscription Payment Report (R8) ────────────────────────────
  //
  // GET /v1/admin/subscription-payments?from&to — cross-business
  // Subscription_Payment_Row report for ops, refund, and revenue
  // reconciliation (Task 8.3). Mirrors the admin boost report's date-range
  // mode exactly: both `from` and `to` are required, the service layer
  // validates the range BEFORE any DynamoDB call and throws
  // `AppError(400, 'INVALID_DATE_RANGE')` if `from > to` or the span exceeds
  // `ADMIN_BOOST_REPORT_MAX_RANGE_DAYS` (367 days). Rows are projected to the
  // `SubscriptionPaymentView` (business identifiers and amounts only, no
  // consumer PII, R8.2).
  //
  // Auth: `requireAuth('admin')` — non-admin tokens are rejected by the
  // middleware before the handler runs (R8.2), matching the boost report.
  const subscriptionPaymentsAdminQuerySchema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })

  app.get(
    '/v1/admin/subscription-payments',
    {
      preHandler: [requireAuth('admin'), validate({ query: subscriptionPaymentsAdminQuerySchema })],
    },
    async (request) => {
      const query = request.query as z.infer<typeof subscriptionPaymentsAdminQuerySchema>
      const { from, to, cursor } = query
      const limit = query.limit ?? 25

      const hasFrom = typeof from === 'string' && from.length > 0
      const hasTo = typeof to === 'string' && to.length > 0

      // Both `from` and `to` are required for the date-range report. Reject an
      // absent or asymmetric range explicitly rather than querying an
      // undefined window. The service layer enforces the range bounds (R8.1)
      // before any DynamoDB call.
      if (!hasFrom || !hasTo) {
        throw new AppError(400, 'INVALID_QUERY', 'Both from and to are required')
      }

      try {
        return await service.listSubscriptionPaymentsByDateRange(from, to, cursor ?? null, limit)
      } catch (err) {
        // Parity with the admin boost report: a malformed pagination cursor
        // surfaces from the repo as MalformedCursorError; map it to 400
        // INVALID_CURSOR.
        if (err instanceof MalformedCursorError) {
          throw new AppError(400, 'INVALID_CURSOR', 'Invalid pagination cursor')
        }
        throw err
      }
    },
  )
}
