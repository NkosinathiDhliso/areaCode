import type { FastifyInstance } from 'fastify'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { validate } from '../../shared/middleware/validation.js'
import * as service from './service.js'
import {
  updateGenresBodySchema,
  connectStreamingBodySchema,
  spotifyCallbackQuerySchema,
  crowdVibeParamsSchema,
} from './types.js'
import { z } from 'zod'

export async function musicRoutes(app: FastifyInstance) {
  // PATCH /v1/users/me/genres
  app.patch(
    '/v1/users/me/genres',
    {
      preHandler: [
        requireAuth('consumer'),
        validate({ body: updateGenresBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof updateGenresBodySchema>
      return service.updateGenres(auth.userId, body.musicGenres)
    },
  )

  // POST /v1/users/me/streaming/connect
  // For Spotify: returns { redirectUrl } for the frontend to open
  // For Apple Music: accepts musicUserToken in body, fetches genres server-side
  app.post(
    '/v1/users/me/streaming/connect',
    {
      preHandler: [
        requireAuth('consumer'),
        validate({ body: connectStreamingBodySchema }),
      ],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof connectStreamingBodySchema>
      return service.connectStreaming(auth.userId, body.provider, body.musicUserToken)
    },
  )

  // GET /v1/streaming/spotify/callback
  // Spotify redirects here after user authorizes. Exchanges code for token, fetches genres.
  app.get(
    '/v1/streaming/spotify/callback',
    { preHandler: [validate({ query: spotifyCallbackQuerySchema })] },
    async (request, reply) => {
      const query = request.query as z.infer<typeof spotifyCallbackQuerySchema>
      const frontendUrl = await service.handleSpotifyCallback(query.code, query.state)
      return reply.redirect(frontendUrl)
    },
  )

  // DELETE /v1/users/me/streaming/disconnect
  app.delete(
    '/v1/users/me/streaming/disconnect',
    { preHandler: [requireAuth('consumer')] },
    async (request, reply) => {
      const auth = getAuth(request)
      await service.disconnectStreaming(auth.userId)
      return reply.status(204).send()
    },
  )

  // GET /v1/nodes/:nodeId/crowd-vibe
  app.get(
    '/v1/nodes/:nodeId/crowd-vibe',
    { preHandler: [validate({ params: crowdVibeParamsSchema })] },
    async (request) => {
      const params = request.params as z.infer<typeof crowdVibeParamsSchema>
      return service.getCrowdVibe(params.nodeId)
    },
  )

  // GET /v1/business/me/audience/music
  app.get(
    '/v1/business/me/audience/music',
    { preHandler: [requireAuth('business')] },
    async (request) => {
      const auth = getAuth(request)
      return service.getBusinessAudienceMusic(auth.userId)
    },
  )
}
