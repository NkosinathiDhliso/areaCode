// Admin core routes — consumers, businesses, moderation, dashboard
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import * as service from './service.js'
import {
  userIdParamsSchema,
  businessIdParamsSchema,
  adminMessageBodySchema,
  impersonateBodySchema,
  extendTrialBodySchema,
  setTierBodySchema,
  reportActionBodySchema,
  reportIdParamsSchema,
  abuseFlagIdParamsSchema,
} from './types.js'
import type { AdminRole } from './types.js'
import { z } from 'zod'
import * as cognito from '../../shared/cognito/client.js'

export async function getAdminRole(request: FastifyRequest): Promise<AdminRole> {
  const auth = getAuth(request)
  const attrs = await cognito.getCognitoUserAttrsBySub('admin', auth.cognitoSub)
  return (attrs?.['custom:admin_role'] as AdminRole) ?? 'support_agent'
}

export async function registerAdminCoreRoutes(app: FastifyInstance) {
  const adminAuth = requireAuth('admin')

  app.get('/v1/admin/consumers', { preHandler: [adminAuth] }, async (request) => {
    const role = await getAdminRole(request)
    const query = (request.query as Record<string, string>)['q'] ?? ''
    return service.searchConsumers(role, query)
  })

  app.post(
    '/v1/admin/consumers/:userId/:action',
    { preHandler: [adminAuth, validate({ params: userIdParamsSchema })] },
    async (request) => {
      const auth = getAuth(request)
      const role = await getAdminRole(request)
      const params = request.params as z.infer<typeof userIdParamsSchema> & { action: string }
      const body = request.body as { note?: string } | undefined
      return service.consumerAction(auth.userId, role, params.userId, params.action, body?.note)
    },
  )

  app.get('/v1/admin/businesses', { preHandler: [adminAuth] }, async (request) => {
    const role = await getAdminRole(request)
    const query = (request.query as Record<string, string>)['q'] ?? ''
    return service.searchBusinesses(role, query)
  })

  app.post(
    '/v1/admin/businesses/:businessId/:action',
    { preHandler: [adminAuth, validate({ params: businessIdParamsSchema })] },
    async (request) => {
      const auth = getAuth(request)
      const role = await getAdminRole(request)
      const params = request.params as z.infer<typeof businessIdParamsSchema> & { action: string }
      return service.businessAction(auth.userId, role, params.businessId, params.action)
    },
  )

  app.get('/v1/admin/consent', { preHandler: [adminAuth] }, async (request) => {
    const role = await getAdminRole(request)
    return service.listConsents(role)
  })

  app.get('/v1/admin/consent/export-reconsent', { preHandler: [adminAuth] }, async (request) => {
    const role = await getAdminRole(request)
    return service.getReconsentList(role)
  })

  app.get('/v1/admin/erasure-queue', { preHandler: [adminAuth] }, async (request) => {
    const role = await getAdminRole(request)
    return service.getErasureQueue(role)
  })

  app.get(
    '/v1/admin/users/:userId',
    { preHandler: [adminAuth, validate({ params: userIdParamsSchema })] },
    async (request) => {
      const role = await getAdminRole(request)
      const params = request.params as z.infer<typeof userIdParamsSchema>
      return service.getUser(role, params.userId)
    },
  )

  app.get(
    '/v1/admin/users/:userId/check-ins',
    { preHandler: [adminAuth, validate({ params: userIdParamsSchema })] },
    async (request) => {
      const role = await getAdminRole(request)
      const params = request.params as z.infer<typeof userIdParamsSchema>
      return service.getUserCheckInHistory(role, params.userId)
    },
  )

  app.post(
    '/v1/admin/users/:userId/reset-flags',
    { preHandler: [adminAuth, validate({ params: userIdParamsSchema })] },
    async (request) => {
      const auth = getAuth(request)
      const role = await getAdminRole(request)
      const params = request.params as z.infer<typeof userIdParamsSchema>
      await service.resetAbuseFlags(auth.userId, role, params.userId)
      return { success: true }
    },
  )

  app.post(
    '/v1/admin/users/:userId/message',
    { preHandler: [adminAuth, validate({ params: userIdParamsSchema, body: adminMessageBodySchema })] },
    async (request) => {
      const auth = getAuth(request)
      const role = await getAdminRole(request)
      const params = request.params as z.infer<typeof userIdParamsSchema>
      const body = request.body as z.infer<typeof adminMessageBodySchema>
      return service.sendMessage(auth.userId, role, params.userId, body.message)
    },
  )

  app.get(
    '/v1/admin/businesses/:businessId',
    { preHandler: [adminAuth, validate({ params: businessIdParamsSchema })] },
    async (request) => {
      const role = await getAdminRole(request)
      const params = request.params as z.infer<typeof businessIdParamsSchema>
      return service.getBusiness(role, params.businessId)
    },
  )

  app.post(
    '/v1/admin/businesses/:businessId/extend-trial',
    { preHandler: [adminAuth, validate({ params: businessIdParamsSchema, body: extendTrialBodySchema })] },
    async (request) => {
      const auth = getAuth(request)
      const role = await getAdminRole(request)
      const params = request.params as z.infer<typeof businessIdParamsSchema>
      const body = request.body as z.infer<typeof extendTrialBodySchema>
      return service.extendTrial(auth.userId, role, params.businessId, body.days)
    },
  )

  app.post(
    '/v1/admin/businesses/:businessId/set-tier',
    { preHandler: [adminAuth, validate({ params: businessIdParamsSchema, body: setTierBodySchema })] },
    async (request) => {
      const auth = getAuth(request)
      const role = await getAdminRole(request)
      const params = request.params as z.infer<typeof businessIdParamsSchema>
      const body = request.body as z.infer<typeof setTierBodySchema>
      return service.setBusinessTier(auth.userId, role, params.businessId, body.tier, body.reason, body.trialEndsAt)
    },
  )

  app.get(
    '/v1/admin/businesses/:businessId/staff',
    { preHandler: [adminAuth, validate({ params: businessIdParamsSchema })] },
    async (request) => {
      const role = await getAdminRole(request)
      const params = request.params as z.infer<typeof businessIdParamsSchema>
      return service.getBusinessStaff(role, params.businessId)
    },
  )

  app.post(
    '/v1/admin/businesses/:businessId/staff/:staffId/revoke',
    { preHandler: [adminAuth, validate({ params: businessIdParamsSchema })] },
    async (request) => {
      const auth = getAuth(request)
      const role = await getAdminRole(request)
      const params = request.params as z.infer<typeof businessIdParamsSchema> & { staffId: string }
      return service.revokeStaffAccess(auth.userId, role, params.businessId, params.staffId)
    },
  )

  app.get('/v1/admin/reports', { preHandler: [adminAuth] }, async (request) => {
    const role = await getAdminRole(request)
    return service.getReportQueue(role)
  })

  app.post(
    '/v1/admin/reports/:reportId/action',
    { preHandler: [adminAuth, validate({ params: reportIdParamsSchema, body: reportActionBodySchema })] },
    async (request) => {
      const auth = getAuth(request)
      const role = await getAdminRole(request)
      const params = request.params as z.infer<typeof reportIdParamsSchema>
      const body = request.body as z.infer<typeof reportActionBodySchema>
      return service.actionReport(auth.userId, role, params.reportId, body.action)
    },
  )

  app.post(
    '/v1/admin/impersonate',
    { preHandler: [adminAuth, validate({ body: impersonateBodySchema })] },
    async (request) => {
      const auth = getAuth(request)
      const role = await getAdminRole(request)
      const body = request.body as z.infer<typeof impersonateBodySchema>
      return service.startImpersonation(auth.userId, role, body.targetUserId, body.targetAccountType, body.note)
    },
  )

  app.get(
    '/v1/admin/consent/:userId',
    { preHandler: [adminAuth, validate({ params: userIdParamsSchema })] },
    async (request) => {
      const role = await getAdminRole(request)
      const params = request.params as z.infer<typeof userIdParamsSchema>
      return service.getConsentHistory(role, params.userId)
    },
  )

  app.get('/v1/admin/consent/reconsent-list', { preHandler: [adminAuth] }, async (request) => {
    const role = await getAdminRole(request)
    return service.getReconsentList(role)
  })

  // Dashboard, audit, abuse flags, disable
  app.get('/v1/admin/dashboard', { preHandler: [adminAuth] }, async (request) => {
    const role = await getAdminRole(request)
    return service.getDashboardMetrics(role)
  })

  app.get('/v1/admin/audit-logs', { preHandler: [adminAuth] }, async (request) => {
    const role = await getAdminRole(request)
    const query = request.query as Record<string, string>
    return service.getAuditLogs(role, {
      cursor: query['cursor'],
      adminId: query['adminId'],
      action: query['action'],
      startDate: query['startDate'],
      endDate: query['endDate'],
    })
  })

  app.post(
    '/v1/admin/abuse-flags/:flagId/action',
    { preHandler: [adminAuth, validate({ params: abuseFlagIdParamsSchema })] },
    async (request) => {
      const auth = getAuth(request)
      const role = await getAdminRole(request)
      const params = request.params as z.infer<typeof abuseFlagIdParamsSchema>
      const body = request.body as { action: string }
      return service.actionAbuseFlag(auth.userId, role, params.flagId, body.action)
    },
  )

  app.get('/v1/admin/abuse-flags', { preHandler: [adminAuth] }, async (request) => {
    const role = await getAdminRole(request)
    return service.getAbuseFlags(role)
  })

  app.post(
    '/v1/admin/abuse-flags/:flagId/review',
    { preHandler: [adminAuth, validate({ params: abuseFlagIdParamsSchema })] },
    async (request) => {
      const auth = getAuth(request)
      const role = await getAdminRole(request)
      const params = request.params as z.infer<typeof abuseFlagIdParamsSchema>
      return service.reviewAbuseFlag(auth.userId, role, params.flagId)
    },
  )

  app.post(
    '/v1/admin/users/:userId/disable',
    { preHandler: [adminAuth, validate({ params: userIdParamsSchema })] },
    async (request) => {
      const auth = getAuth(request)
      const role = await getAdminRole(request)
      const params = request.params as z.infer<typeof userIdParamsSchema>
      return service.disableUser(auth.userId, role, params.userId)
    },
  )

  app.post(
    '/v1/admin/businesses/:businessId/disable',
    { preHandler: [adminAuth, validate({ params: businessIdParamsSchema })] },
    async (request) => {
      const auth = getAuth(request)
      const role = await getAdminRole(request)
      const params = request.params as z.infer<typeof businessIdParamsSchema>
      return service.disableBusiness(auth.userId, role, params.businessId)
    },
  )
}
