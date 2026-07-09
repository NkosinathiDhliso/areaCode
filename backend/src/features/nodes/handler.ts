import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { requireAuth, getAuth, optionalAuth } from '../../shared/middleware/auth.js'
import { requireBusinessPermission, getBusinessRole } from '../../shared/middleware/business-role.js'
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit.js'
import { validate } from '../../shared/middleware/validation.js'

import * as service from './service.js'
import {
  citySlugParamsSchema,
  nodeIdParamsSchema,
  nodeSlugParamsSchema,
  searchQuerySchema,
  createNodeBodySchema,
  businessCreateNodeBodySchema,
  updateNodeBodySchema,
  claimNodeBodySchema,
  reportNodeBodySchema,
  whoIsHereQuerySchema,
  presignedUploadBodySchema,
} from './types.js'

export async function nodeRoutes(app: FastifyInstance) {
  // GET /v1/nodes/trending — must be registered before /:citySlug to avoid param collision
  app.get(
    '/v1/nodes/trending',
    {
      preHandler: [rateLimitMiddleware({ key: 'trending', max: 30, windowSeconds: 60 })],
    },
    async (request) => {
      const query = request.query as { limit?: string }
      const limit = query.limit ? Math.min(parseInt(query.limit, 10), 20) : 10
      return service.getTrendingNodes(limit)
    },
  )

  // GET /v1/nodes/search — also before /:citySlug
  app.get('/v1/nodes/search', { preHandler: [validate({ query: searchQuerySchema })] }, async (request) => {
    const query = request.query as z.infer<typeof searchQuerySchema>
    return service.searchNodes(query.q, query.lat, query.lng)
  })

  // GET /v1/nodes/:citySlug
  app.get('/v1/nodes/:citySlug', { preHandler: [validate({ params: citySlugParamsSchema })] }, async (request) => {
    const params = request.params as z.infer<typeof citySlugParamsSchema>
    return service.getNodesByCitySlug(params.citySlug)
  })

  // GET /v1/nodes/:nodeId/detail
  app.get(
    '/v1/nodes/:nodeId/detail',
    {
      preHandler: [optionalAuth('consumer', 'business'), validate({ params: nodeIdParamsSchema })],
    },
    async (request) => {
      const params = request.params as z.infer<typeof nodeIdParamsSchema>
      return service.getNodeDetail(params.nodeId)
    },
  )

  // GET /v1/nodes/:nodeSlug/public
  app.get(
    '/v1/nodes/:nodeSlug/public',
    { preHandler: [validate({ params: nodeSlugParamsSchema })] },
    async (request) => {
      const params = request.params as z.infer<typeof nodeSlugParamsSchema>
      return service.getNodePublic(params.nodeSlug)
    },
  )

  // GET /v1/nodes/:nodeId/who-is-here
  app.get(
    '/v1/nodes/:nodeId/who-is-here',
    {
      preHandler: [
        requireAuth('consumer'),
        validate({ params: nodeIdParamsSchema, query: whoIsHereQuerySchema }),
        rateLimitMiddleware({ key: 'who-is-here', max: 20, windowSeconds: 600 }),
      ],
    },
    async (request) => {
      const params = request.params as z.infer<typeof nodeIdParamsSchema>
      const query = request.query as z.infer<typeof whoIsHereQuerySchema>
      return service.getWhoIsHere(params.nodeId, query.limit)
    },
  )

  // POST /v1/nodes — owners and managers (manage_nodes)
  app.post(
    '/v1/nodes',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission('manage_nodes'),
        validate({ body: createNodeBodySchema }),
      ],
    },
    async (request, reply) => {
      const businessId = getBusinessRole(request).businessId
      const body = request.body as z.infer<typeof createNodeBodySchema>
      const node = await service.createNode(businessId, body)
      return reply.status(201).send(node)
    },
  )

  // POST /v1/nodes/business-create - simpler flow: enter address, no CIPC required
  app.post(
    '/v1/nodes/business-create',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission('manage_nodes'),
        validate({ body: businessCreateNodeBodySchema }),
      ],
    },
    async (request, reply) => {
      const businessId = getBusinessRole(request).businessId
      const body = request.body as z.infer<typeof businessCreateNodeBodySchema>
      const node = await service.businessCreateNode(businessId, body)
      return reply.status(201).send(node)
    },
  )

  // PUT /v1/nodes/:nodeId — owners and managers (manage_nodes)
  app.put(
    '/v1/nodes/:nodeId',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission('manage_nodes'),
        validate({ params: nodeIdParamsSchema, body: updateNodeBodySchema }),
      ],
    },
    async (request) => {
      const businessId = getBusinessRole(request).businessId
      const params = request.params as z.infer<typeof nodeIdParamsSchema>
      const body = request.body as z.infer<typeof updateNodeBodySchema>
      await service.updateNode(params.nodeId, businessId, body)
      return { success: true }
    },
  )

  // POST /v1/nodes/:nodeId/claim — owners and managers (manage_nodes)
  app.post(
    '/v1/nodes/:nodeId/claim',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission('manage_nodes'),
        validate({ params: nodeIdParamsSchema, body: claimNodeBodySchema }),
      ],
    },
    async (request) => {
      const businessId = getBusinessRole(request).businessId
      const params = request.params as z.infer<typeof nodeIdParamsSchema>
      const body = request.body as z.infer<typeof claimNodeBodySchema>
      return service.claimNode(params.nodeId, businessId, body.registrationNumber)
    },
  )

  // POST /v1/nodes/:nodeId/report
  app.post(
    '/v1/nodes/:nodeId/report',
    {
      preHandler: [
        requireAuth('consumer'),
        rateLimitMiddleware({ key: 'node-report', max: 5, windowSeconds: 300 }),
        validate({ params: nodeIdParamsSchema, body: reportNodeBodySchema }),
      ],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof nodeIdParamsSchema>
      const body = request.body as z.infer<typeof reportNodeBodySchema>
      await service.reportNode(auth.userId, params.nodeId, body.type, body.detail)
      return reply.status(201).send({ success: true })
    },
  )

  // POST /v1/upload/presigned
  app.post(
    '/v1/upload/presigned',
    {
      preHandler: [requireAuth('business', 'consumer'), validate({ body: presignedUploadBodySchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof presignedUploadBodySchema>
      return service.createPresignedUpload(auth.userId, body.fileType, body.contentType)
    },
  )

  // GET /v1/nodes/:nodeId/rewards
  app.get('/v1/nodes/:nodeId/rewards', { preHandler: [validate({ params: nodeIdParamsSchema })] }, async (request) => {
    const params = request.params as z.infer<typeof nodeIdParamsSchema>
    return service.getNodeRewards(params.nodeId)
  })

  // GET /v1/nodes/:nodeId/presence — honest Live_Presence_Count (public read)
  app.get('/v1/nodes/:nodeId/presence', { preHandler: [validate({ params: nodeIdParamsSchema })] }, async (request) => {
    const params = request.params as z.infer<typeof nodeIdParamsSchema>
    return service.getNodePresence(params.nodeId)
  })
}
