import { normaliseSocialLinks } from '@area-code/shared/constants/social-platforms'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { requireAuth } from '../../shared/middleware/auth.js'
import { requireBusinessPermission, getBusinessRole } from '../../shared/middleware/business-role.js'
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit.js'
import { validate } from '../../shared/middleware/validation.js'
import { recordNodeShare } from '../reports/share-repository.js'

import * as nodeService from './service.js'

// Accept a loose map of platform -> handle (or null to clear). The values are
// normalised server-side by `normaliseSocialLinks`, which drops unknown
// platforms and invalid/empty handles, so the stored map only ever holds
// valid, known-platform entries. This is the single source of truth for the
// supported platform set and per-platform handle rules.
const socialBodySchema = z.object({
  socialLinks: z.record(z.string(), z.string().nullable()),
})

const nodeIdParamsSchema = z.object({
  nodeId: z.string().min(1),
})

export async function nodeSocialRoutes(app: FastifyInstance) {
  /**
   * PUT /v1/business/nodes/:nodeId/social
   * Replaces the venue's social handles with the supplied (normalised) map.
   * Handles are stored without a leading @.
   */
  app.put(
    '/v1/business/nodes/:nodeId/social',
    {
      preHandler: [
        requireAuth('business', 'staff'),
        requireBusinessPermission('manage_nodes'),
        validate({ params: nodeIdParamsSchema, body: socialBodySchema }),
      ],
    },
    async (request, reply) => {
      const businessId = getBusinessRole(request).businessId
      const { nodeId } = request.params as z.infer<typeof nodeIdParamsSchema>
      const body = request.body as z.infer<typeof socialBodySchema>

      const socialLinks = normaliseSocialLinks(body.socialLinks)
      await nodeService.updateNodeSocialLinks(nodeId, businessId, socialLinks)

      return reply.send({ success: true, socialLinks })
    },
  )

  /**
   * POST /v1/nodes/:nodeId/share
   * Public beacon: records one completed share of a venue so the Weekly
   * Attribution Digest can show the business an honest "shares recorded" count.
   * No auth (a consumer may be anonymous) and no consumer identity is stored,
   * only a per-node weekly tally. Rate limited per IP so the vanity count
   * cannot be trivially inflated. Fire-and-forget: always returns 200.
   */
  app.post(
    '/v1/nodes/:nodeId/share',
    {
      preHandler: [
        rateLimitMiddleware({ key: 'node-share', max: 30, windowSeconds: 60 }),
        validate({ params: nodeIdParamsSchema }),
      ],
    },
    async (request, reply) => {
      const { nodeId } = request.params as z.infer<typeof nodeIdParamsSchema>
      await recordNodeShare(nodeId)
      return reply.send({ success: true })
    },
  )
}
