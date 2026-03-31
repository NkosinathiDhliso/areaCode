import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth, optionalAuth, getOptionalAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit.js'
import * as service from './service.js'
import {
  citySlugParamsSchema, nodeIdParamsSchema, nodeSlugParamsSchema,
  searchQuerySchema, createNodeBodySchema, updateNodeBodySchema,
  claimNodeBodySchema, reportNodeBodySchema, whoIsHereQuerySchema,
  presignedUploadBodySchema, registerImageBodySchema,
} from './types.js'
import { z } from 'zod'

export async function nodeRoutes(app: FastifyInstance) {
  // GET /v1/nodes/:citySlug
  app.get(
    '/v1/nodes/:citySlug',
    { preHandler: [validate({ params: citySlugParamsSchema })] },
    async (request) => {
      const params = request.params as z.infer<typeof citySlugParamsSchema>
      return service.getNodesByCitySlug(params.citySlug)
    },
  )

  // GET /v1/nodes/:nodeId/detail
  app.get(
    '/v1/nodes/:nodeId/detail',
    {
      preHandler: [
        optionalAuth('consumer', 'business'),
        validate({ params: nodeIdParamsSchema }),
      ],
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
      return service.getWhoIsHere(params.nodeId, query.limit, query.cursor)
    },
  )

  // GET /v1/nodes/search
  app.get(
    '/v1/nodes/search',
    { preHandler: [validate({ query: searchQuerySchema })] },
    async (request) => {
      const query = request.query as z.infer<typeof searchQuerySchema>
      return service.searchNodes(query.q, query.lat, query.lng)
    },
  )

  // POST /v1/nodes
  app.post(
    '/v1/nodes',
    {
      preHandler: [
        requireAuth('business'),
        validate({ body: createNodeBodySchema }),
      ],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof createNodeBodySchema>
      const node = await service.createNode(auth.userId, body)
      return reply.status(201).send(node)
    },
  )

  // PUT /v1/nodes/:nodeId
  app.put(
    '/v1/nodes/:nodeId',
    {
      preHandler: [
        requireAuth('business'),
        validate({ params: nodeIdParamsSchema, body: updateNodeBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof nodeIdParamsSchema>
      const body = request.body as z.infer<typeof updateNodeBodySchema>
      await service.updateNode(params.nodeId, auth.userId, body)
      return { success: true }
    },
  )

  // POST /v1/nodes/:nodeId/claim
  app.post(
    '/v1/nodes/:nodeId/claim',
    {
      preHandler: [
        requireAuth('business'),
        validate({ params: nodeIdParamsSchema, body: claimNodeBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof nodeIdParamsSchema>
      const body = request.body as z.infer<typeof claimNodeBodySchema>
      return service.claimNode(params.nodeId, auth.userId, body.registrationNumber)
    },
  )

  // POST /v1/nodes/:nodeId/report
  app.post(
    '/v1/nodes/:nodeId/report',
    {
      preHandler: [
        requireAuth('consumer'),
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
      preHandler: [
        requireAuth('business', 'consumer'),
        validate({ body: presignedUploadBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof presignedUploadBodySchema>
      return service.createPresignedUpload(auth.userId, body.fileType, body.contentType)
    },
  )

  // POST /v1/nodes/:nodeId/images
  app.post(
    '/v1/nodes/:nodeId/images',
    {
      preHandler: [
        requireAuth('business'),
        validate({ params: nodeIdParamsSchema, body: registerImageBodySchema }),
      ],
    },
    async (request, reply) => {
      const auth = getAuth(request)
      const params = request.params as z.infer<typeof nodeIdParamsSchema>
      const body = request.body as z.infer<typeof registerImageBodySchema>
      const image = await service.registerNodeImage(
        params.nodeId, auth.userId, body.s3Key, body.displayOrder,
      )
      return reply.status(201).send(image)
    },
  )
}
