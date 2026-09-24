/**
 * Share_Preview route — `GET /v1/share/node/:slug`
 * (proof-of-demand R1.2, R12.2, R12.3).
 *
 * The consumer app's Amplify config rewrites `/node/<*>` here with status 200
 * (task 1.4), so a shared venue link resolves to this document on the consumer
 * domain: crawlers read the Open Graph tags, browsers are redirected into
 * `/map?venue={slug}&src=share`.
 *
 * Public by design — it is the link forwarded in a group chat, so it must work
 * with no token. It carries no consumer data: the payload is the venue name,
 * the aggregate live snapshot line and the venue's own photo. Rate limited on
 * the shared public-venue-read key (R12.2), and the slug is validated against
 * the slug shape before it is interpolated into HTML.
 *
 * No new Lambda: one route on the existing API app (R12.1).
 */

import { randomBytes } from 'node:crypto'

import type { FastifyInstance } from 'fastify'
import type { z } from 'zod'

import { rateLimitMiddleware } from '../../shared/middleware/rate-limit.js'
import { validate } from '../../shared/middleware/validation.js'

import { PUBLIC_NODE_RATE_LIMIT } from './rate-limits.js'
import * as service from './service.js'
import { renderSharePreview, sharePreviewCsp, SHARE_PREVIEW_CACHE_CONTROL } from './share-preview.js'
import { shareSlugParamsSchema } from './types.js'

export async function nodeShareRoutes(app: FastifyInstance) {
  app.get(
    '/v1/share/node/:slug',
    {
      preHandler: [validate({ params: shareSlugParamsSchema }), rateLimitMiddleware(PUBLIC_NODE_RATE_LIMIT)],
    },
    async (request, reply) => {
      const params = request.params as z.infer<typeof shareSlugParamsSchema>
      const view = await service.getNodeSharePreview(params.slug)

      // Per-response nonce so the inline redirect runs under a strict document
      // CSP (no 'unsafe-inline'). Set here rather than in the global onSend
      // hook, which only applies its JSON-API lockdown policy when a route has
      // not already set one.
      const nonce = randomBytes(16).toString('base64')

      return reply
        .type('text/html; charset=utf-8')
        .header('Cache-Control', SHARE_PREVIEW_CACHE_CONTROL)
        .header('Content-Security-Policy', sharePreviewCsp(nonce))
        .send(renderSharePreview(view, nonce))
    },
  )
}
