import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import * as service from './service.js'
import {
  userIdParamsSchema, businessIdParamsSchema,
  adminMessageBodySchema, impersonateBodySchema,
  extendTrialBodySchema, reportActionBodySchema,
  reportIdParamsSchema, abuseFlagIdParamsSchema,
} from './types.js'
import type { AdminRole } from './types.js'
import { z } from 'zod'

function getAdminRole(request: { headers: Record<string, unknown> }): AdminRole {
  // In production, extracted from Cognito custom:role claim
  return (request.headers['x-admin-role'] as AdminRole) ?? 'support_agent'
}

export async function adminRoutes(app: FastifyInstance) {
  const adminAuth = requireAuth('admin')

  // GET /v1/admin/consumers
  app.get(
    '/v1/admin/consumers',
    { preHandler: [adminAuth] },
    async (request) => {
      const role = getAdminRole(request)
      const query = (request.query as Record<string, string>)['q'] ?? ''
      return service.searchConsumers(role, query)
    },
  )

  // POST /v1/admin/consumers/:userId/:action
  app.post(
    '/v1/admin/consumers/:userId/:action',
    { preHandler: [adminAuth, validate({ params: userIdParamsSchema })] },
    async (request) => {
      const auth = getAuth(request)
      const role = getAdminRole(request)
      const params = request.params as z.infer<typeof userIdParamsSchema> & { action: string }
      const body = request.body as { note?: string } | undefined
      return service.consumerAction(auth.userId, role, params.userId, params.action, body?.note)
    },
  )

  // GET /v1/admin/businesses
  app.get(
    '/v1/admin/businesses',
    { preHandler: [adminAuth] },
    async (request) => {
      const role = getAdminRole(request)
      const query = (request.query as Record<string, string>)['q'] ?? ''
      return service.searchBusinesses(role, query)
    },
  )

  // POST /v1/admin/businesses/:businessId/:action
  app.post(
    '/v1/admin/businesses/:businessId/:action',
    { preHandler: [adminAuth, validate({ params: businessIdParamsSchema })] },
    async (request) => {
      const auth = getAuth(request)
      const role = getAdminRole(request)
      const params = request.params as z.infer<typeof businessIdParamsSchema> & { action: string }
      return service.businessAction(auth.userId, role, params.businessId, params.action)
    },
  )

  // GET /v1/admin/consent (list all)
  app.get(
    '/v1/admin/consent',
    { preHandler: [adminAuth] },
    async (request) => {
      const role = getAdminRole(request)
      return service.listConsents(role)
    },
  )

  // GET /v1/admin/consent/export-reconsent
  app.get(
    '/v1/admin/consent/export-reconsent',
    { preHandler: [adminAuth] },
    async (request) => {
      const role = getAdminRole(request)
      return service.getReconsentList(role)
    },
  )

  // GET /v1/admin/erasure-queue
  app.get(
    '/v1/admin/erasure-queue',
    { preHandler: [adminAuth] },
    async (request) => {
      const role = getAdminRole(request)
      return service.getErasureQueue(role)
    },
  )

  // GET /v1/admin/users/:userId
  app.get(
    '/v1/admin/users/:userId',
    { preHandler: [adminAuth, validate({ params: userIdParamsSchema })] },
    async (request) => {
      const role = getAdminRole(request)
      const params = request.params as z.infer<typeof userIdParamsSchema>
      return service.getUser(role, params.userId)
    },
  )

  // GET /v1/admin/users/:userId/check-ins
  app.get(
    '/v1/admin/users/:userId/check-ins',
    { preHandler: [adminAuth, validate({ params: userIdParamsSchema })] },
    async (request) => {
      const role = getAdminRole(request)
      const params = request.params as z.infer<typeof userIdParamsSchema>
      return service.getUserCheckInHistory(role, params.userId)
    },
  )

  // POST /v1/admin/users/:userId/reset-flags
  app.post(
    '/v1/admin/users/:userId/reset-flags',
    { preHandler: [adminAuth, validate({ params: userIdParamsSchema })] },
    async (request) => {
      const auth = getAuth(request)
      const role = getAdminRole(request)
      const params = request.params as z.infer<typeof userIdParamsSchema>
      await service.resetAbuseFlags(auth.userId, role, params.userId)
      return { success: true }
    },
  )

  // POST /v1/admin/users/:userId/message
  app.post(
    '/v1/admin/users/:userId/message',
    {
      preHandler: [
        adminAuth,
        validate({ params: userIdParamsSchema, body: adminMessageBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const role = getAdminRole(request)
      const params = request.params as z.infer<typeof userIdParamsSchema>
      const body = request.body as z.infer<typeof adminMessageBodySchema>
      return service.sendMessage(auth.userId, role, params.userId, body.message)
    },
  )

  // GET /v1/admin/businesses/:businessId
  app.get(
    '/v1/admin/businesses/:businessId',
    { preHandler: [adminAuth, validate({ params: businessIdParamsSchema })] },
    async (request) => {
      const role = getAdminRole(request)
      const params = request.params as z.infer<typeof businessIdParamsSchema>
      return service.getBusiness(role, params.businessId)
    },
  )

  // POST /v1/admin/businesses/:businessId/extend-trial
  app.post(
    '/v1/admin/businesses/:businessId/extend-trial',
    {
      preHandler: [
        adminAuth,
        validate({ params: businessIdParamsSchema, body: extendTrialBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const role = getAdminRole(request)
      const params = request.params as z.infer<typeof businessIdParamsSchema>
      const body = request.body as z.infer<typeof extendTrialBodySchema>
      return service.extendTrial(auth.userId, role, params.businessId, body.days)
    },
  )

  // GET /v1/admin/reports
  app.get(
    '/v1/admin/reports',
    { preHandler: [adminAuth] },
    async (request) => {
      const role = getAdminRole(request)
      return service.getReportQueue(role)
    },
  )

  // POST /v1/admin/reports/:reportId/action
  app.post(
    '/v1/admin/reports/:reportId/action',
    {
      preHandler: [
        adminAuth,
        validate({ params: reportIdParamsSchema, body: reportActionBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const role = getAdminRole(request)
      const params = request.params as z.infer<typeof reportIdParamsSchema>
      const body = request.body as z.infer<typeof reportActionBodySchema>
      return service.actionReport(auth.userId, role, params.reportId, body.action)
    },
  )

  // POST /v1/admin/impersonate
  app.post(
    '/v1/admin/impersonate',
    { preHandler: [adminAuth, validate({ body: impersonateBodySchema })] },
    async (request) => {
      const auth = getAuth(request)
      const role = getAdminRole(request)
      const body = request.body as z.infer<typeof impersonateBodySchema>
      return service.startImpersonation(
        auth.userId, role,
        body.targetUserId, body.targetAccountType, body.note,
      )
    },
  )

  // GET /v1/admin/consent/:userId
  app.get(
    '/v1/admin/consent/:userId',
    { preHandler: [adminAuth, validate({ params: userIdParamsSchema })] },
    async (request) => {
      const role = getAdminRole(request)
      const params = request.params as z.infer<typeof userIdParamsSchema>
      return service.getConsentHistory(role, params.userId)
    },
  )

  // GET /v1/admin/consent/reconsent-list
  app.get(
    '/v1/admin/consent/reconsent-list',
    { preHandler: [adminAuth] },
    async (request) => {
      const role = getAdminRole(request)
      return service.getReconsentList(role)
    },
  )

  // ─── Abuse Flags ─────────────────────────────────────────────────────────

  // GET /v1/admin/abuse-flags
  app.get(
    '/v1/admin/abuse-flags',
    { preHandler: [adminAuth] },
    async (request) => {
      const role = getAdminRole(request)
      return service.getAbuseFlags(role)
    },
  )

  // POST /v1/admin/abuse-flags/:flagId/review
  app.post(
    '/v1/admin/abuse-flags/:flagId/review',
    { preHandler: [adminAuth, validate({ params: abuseFlagIdParamsSchema })] },
    async (request) => {
      const auth = getAuth(request)
      const role = getAdminRole(request)
      const params = request.params as z.infer<typeof abuseFlagIdParamsSchema>
      return service.reviewAbuseFlag(auth.userId, role, params.flagId)
    },
  )

  // ─── Archetype Management ───────────────────────────────────────────────

  // GET /v1/admin/archetypes
  app.get(
    '/v1/admin/archetypes',
    { preHandler: [adminAuth] },
    async () => {
      return service.getArchetypes()
    },
  )

  // POST /v1/admin/archetypes
  app.post(
    '/v1/admin/archetypes',
    { preHandler: [adminAuth] },
    async (request) => {
      const auth = getAuth(request)
      const role = getAdminRole(request)
      return service.createArchetype(auth.userId, role, request.body as Record<string, unknown>)
    },
  )

  // PATCH /v1/admin/archetypes/:id
  app.patch(
    '/v1/admin/archetypes/:id',
    { preHandler: [adminAuth] },
    async (request) => {
      const auth = getAuth(request)
      const role = getAdminRole(request)
      const params = request.params as { id: string }
      return service.updateArchetype(auth.userId, role, params.id, request.body as Record<string, unknown>)
    },
  )

  // POST /v1/admin/archetypes/test
  app.post(
    '/v1/admin/archetypes/test',
    { preHandler: [adminAuth] },
    async (request) => {
      const body = request.body as { genres?: string[] }
      return service.testArchetype(body.genres ?? [])
    },
  )

  // ─── Genre Weight Management ────────────────────────────────────────────

  // GET /v1/admin/genre-weights
  app.get(
    '/v1/admin/genre-weights',
    { preHandler: [adminAuth] },
    async () => {
      return service.getGenreWeights()
    },
  )

  // PATCH /v1/admin/genre-weights
  app.patch(
    '/v1/admin/genre-weights',
    { preHandler: [adminAuth] },
    async (request) => {
      const auth = getAuth(request)
      const role = getAdminRole(request)
      return service.updateGenreWeights(auth.userId, role, request.body as Record<string, unknown>)
    },
  )
}
