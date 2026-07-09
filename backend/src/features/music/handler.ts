import { ScheduleValidationError, validateMusicSchedule } from '@area-code/shared/lib/schedule-validator'
import type { MusicSchedule } from '@area-code/shared/types'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { AppError } from '../../shared/errors/AppError.js'
import { requireAuth, getAuth } from '../../shared/middleware/auth.js'
import { requireBusinessPermission, getBusinessRole } from '../../shared/middleware/business-role.js'
import { validate } from '../../shared/middleware/validation.js'

import { deleteScheduleSlot, getSchedule, upsertSchedule } from './schedule-repository.js'
import * as service from './service.js'
import {
  updateGenresBodySchema,
  connectStreamingBodySchema,
  spotifyCallbackQuerySchema,
  crowdVibeParamsSchema,
} from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Music_Schedule route helpers
//
// The schedule-crud routes (R3.1, R4.5) use a 1:1 convention between business
// and schedule so the route surface only ever exposes one schedule per
// venue. The on-disk model still supports multiple schedules per business
// (R3.2) — this is just the public API shape.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_SCHEDULE_ID = 'default'

const businessPathParamsSchema = z.object({
  businessId: z.string().min(1).max(64),
})

const scheduleSlotPathParamsSchema = z.object({
  businessId: z.string().min(1).max(64),
  slotId: z.string().min(1).max(128),
})

/**
 * Authorise access to a venue's Music_Schedule, BEFORE any DynamoDB I/O.
 *
 * One helper, one rule set, fail CLOSED (deny by default) — the schedule is a
 * single source of truth shared by the business operator and that venue's
 * staff:
 *   - role `business`: allowed iff `auth.userId === pathBusinessId` (the
 *     existing owner rule, unchanged — R4.11/R4.12).
 *   - role `staff`: allowed iff the staff member's resolved venue matches the
 *     path (`auth.businessId === pathBusinessId`). The staff session carries
 *     its `businessId` from `verifyToken` (the `custom:businessId` claim, else
 *     the staff row) — see `shared/middleware/auth.ts`.
 *   - anything else / missing businessId: 403 (deny by default).
 *
 * The check runs BEFORE any MusicSchedules I/O. `requireAuth` has already set
 * `auth` from the verified token, so this comparison never touches the
 * schedules table itself.
 *
 * Throws `AppError.forbidden` so the existing global error handler maps it to a
 * 403 response.
 */
function authoriseScheduleAccess(request: FastifyRequest, pathBusinessId: string): void {
  const auth = getAuth(request)

  if (auth.role === 'business' && auth.userId === pathBusinessId) return
  if (auth.role === 'staff' && auth.businessId !== undefined && auth.businessId === pathBusinessId) return

  throw AppError.forbidden('You do not have access to this venue.')
}

/**
 * Send a 400 response carrying the structured field-level error returned
 * by `validateMusicSchedule` (`{ code, field, message, slotId? }`). The
 * Schedule_Editor renders these inline against the offending field
 * (R4.5).
 */
function sendValidationError(reply: FastifyReply, err: ScheduleValidationError): FastifyReply {
  const body: Record<string, unknown> = {
    error: 'validation_error',
    message: err.message,
    statusCode: 400,
    code: err.code,
    field: err.field,
  }
  if (err.slotId !== undefined) body['slotId'] = err.slotId
  return reply.status(400).send(body)
}

/**
 * Coerce the request body into the canonical `(businessId, scheduleId)`
 * pair from the path. Anything the editor sent in those fields is
 * overridden so a misbehaving client can never write a schedule under a
 * different businessId (defence-in-depth on top of R4.11).
 */
function canonicaliseScheduleBody(rawBody: unknown, pathBusinessId: string): unknown {
  if (rawBody === null || typeof rawBody !== 'object') {
    return rawBody
  }
  return {
    ...(rawBody as Record<string, unknown>),
    businessId: pathBusinessId,
    scheduleId: DEFAULT_SCHEDULE_ID,
  }
}

export async function musicRoutes(app: FastifyInstance) {
  // PATCH /v1/users/me/genres
  app.patch(
    '/v1/users/me/genres',
    {
      preHandler: [requireAuth('consumer'), validate({ body: updateGenresBodySchema })],
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
      preHandler: [requireAuth('consumer'), validate({ body: connectStreamingBodySchema })],
    },
    async (request) => {
      const auth = getAuth(request)
      const body = request.body as z.infer<typeof connectStreamingBodySchema>
      return service.connectStreaming(auth.userId, body.provider, body.musicUserToken, body.frontendOrigin)
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
  app.delete('/v1/users/me/streaming/disconnect', { preHandler: [requireAuth('consumer')] }, async (request, reply) => {
    const auth = getAuth(request)
    await service.disconnectStreaming(auth.userId)
    return reply.status(204).send()
  })

  // GET /v1/nodes/:nodeId/crowd-vibe
  app.get(
    '/v1/nodes/:nodeId/crowd-vibe',
    { preHandler: [validate({ params: crowdVibeParamsSchema })] },
    async (request) => {
      const params = request.params as z.infer<typeof crowdVibeParamsSchema>
      return service.getCrowdVibe(params.nodeId)
    },
  )

  // GET /v1/business/me/audience/music — owners and managers (view_audience)
  app.get(
    '/v1/business/me/audience/music',
    { preHandler: [requireAuth('business', 'staff'), requireBusinessPermission('view_audience')] },
    async (request) => {
      const businessId = getBusinessRole(request).businessId
      return service.getBusinessAudienceMusic(businessId)
    },
  )

  // ───────────────────────────────────────────────────────────────────────────
  // Music_Schedule routes (R3.1, R3.5, R3.7, R3.9, R3.11, R3.12, R4.5, R4.7,
  // R4.11, R4.12, R4.13)
  //
  // The Music_Schedule is a single source of truth shared by the business
  // operator and that venue's staff. GET, POST, and DELETE accept either a
  // verified business-pool JWT or a verified staff-pool JWT; a Manager
  // authenticates through the staff pool, so delete parity with create lets a
  // role that can add a slot also remove one for the same venue.
  //
  // All routes:
  //   1. Require a verified JWT for an allowed role (`requireAuth(...)`).
  //   2. Reject with 403 via `authoriseScheduleAccess` when the session's
  //      resolved venue does not match the path `businessId`, BEFORE any
  //      MusicSchedules I/O (fail closed, deny by default).
  //   3. Run `validateMusicSchedule` server-side on every write regardless
  //      of what the editor sends — never trust the client.
  //   4. Persist Cross_Midnight_Pair as the two same-day slots the editor
  //      already split on save (R3.12 / R4.13). The handler does not split
  //      cross-midnight slots itself; the validator rejects single
  //      wrap-around slots so the on-disk shape always matches R3.12.
  // ───────────────────────────────────────────────────────────────────────────

  // GET /v1/business/{businessId}/music-schedule
  app.get(
    '/v1/business/:businessId/music-schedule',
    {
      preHandler: [requireAuth('business', 'staff'), validate({ params: businessPathParamsSchema })],
    },
    async (request, reply) => {
      const params = request.params as z.infer<typeof businessPathParamsSchema>
      authoriseScheduleAccess(request, params.businessId)

      const schedule = await getSchedule(params.businessId, DEFAULT_SCHEDULE_ID)
      if (!schedule) {
        throw AppError.notFound('Music schedule not found')
      }
      return reply.status(200).send(schedule)
    },
  )

  // POST /v1/business/{businessId}/music-schedule
  // Upsert. Body is the full MusicSchedule. Returns the canonicalised
  // schedule on success; 400 with `{ code, field, message, slotId? }` on
  // validation failure (R4.5).
  app.post(
    '/v1/business/:businessId/music-schedule',
    {
      preHandler: [requireAuth('business', 'staff'), validate({ params: businessPathParamsSchema })],
    },
    async (request, reply) => {
      const params = request.params as z.infer<typeof businessPathParamsSchema>
      authoriseScheduleAccess(request, params.businessId)

      // Override the (businessId, scheduleId) fields from the path so a
      // misbehaving client cannot write under a different businessId.
      const candidate = canonicaliseScheduleBody(request.body, params.businessId)

      const validation = validateMusicSchedule(candidate)
      if (!validation.ok) {
        return sendValidationError(reply, validation.error)
      }

      const persisted: MusicSchedule = await upsertSchedule(validation.value)
      return reply.status(200).send(persisted)
    },
  )

  // DELETE /v1/business/{businessId}/music-schedule/{slotId}
  app.delete(
    '/v1/business/:businessId/music-schedule/:slotId',
    {
      preHandler: [requireAuth('business', 'staff'), validate({ params: scheduleSlotPathParamsSchema })],
    },
    async (request, reply) => {
      const params = request.params as z.infer<typeof scheduleSlotPathParamsSchema>
      authoriseScheduleAccess(request, params.businessId)

      try {
        const updated = await deleteScheduleSlot(params.businessId, DEFAULT_SCHEDULE_ID, params.slotId)
        return reply.status(200).send(updated)
      } catch (err) {
        // Translate the repository's tagged not-found errors to 404.
        if (err instanceof ScheduleValidationError && err.code === 'schema_shape') {
          if (err.field === 'scheduleId') {
            throw AppError.notFound('Music schedule not found')
          }
          if (err.field === 'slotId') {
            throw AppError.notFound(`Schedule slot not found: ${params.slotId}`)
          }
        }
        // Any other validation failure surfaces as a structured 400 — the
        // repository re-runs `validateMusicSchedule` on the post-delete
        // schedule, so a 400 here means the remaining slots somehow
        // regressed (defensive).
        if (err instanceof ScheduleValidationError) {
          return sendValidationError(reply, err)
        }
        throw err
      }
    },
  )
}
