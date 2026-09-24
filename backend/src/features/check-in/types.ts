import { OPEN_SOURCES, type FoundVia } from '@area-code/shared/constants/attribution'
import { z } from 'zod'

export const checkInBodySchema = z.object({
  nodeId: z.string().min(1),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  /** Device-reported GPS accuracy in metres (1-sigma). Drives accuracy-aware proximity. */
  accuracy: z.number().min(0).optional(),
  qrToken: z.string().optional(),
  type: z.enum(['reward', 'presence']),
  fingerprintHash: z.string().optional(),
  // Optional original capture time for a replayed (offline outbox) check-in
  // (cross-portal-lifecycle-alignment R5). Present only when the client is
  // draining a queued attempt; a live check-in omits it. The server accepts it
  // only within the Replay_Window and never backdates presence.
  capturedAt: z.string().datetime().optional(),
})

export type CheckInInput = z.infer<typeof checkInBodySchema>

export interface CheckInResponse {
  success: boolean
  cooldownUntil: string
}

// ============================================================================
// Venue_Open (proof-of-demand R2.1)
// ============================================================================

export const venueOpenParamsSchema = z.object({
  nodeId: z.string().min(1),
})

/**
 * `POST /v1/nodes/:nodeId/open` body.
 *
 * `source` is where the open came from; `walk_in` is deliberately not accepted,
 * it is an outcome the server derives, never something a client declares.
 * `away` is the only spatial fact that leaves the device: `true` when the
 * consumer was further than `AWAY_DISTANCE_METRES` from the venue, `false` when
 * they were closer, `null` when no fresh position was available. The position
 * itself is never sent (R2.2, R11.1).
 *
 * Not `.strict()`: Zod strips unknown keys, so an extra field from an older
 * client is dropped rather than rejected.
 */
export const venueOpenBodySchema = z.object({
  source: z.enum(OPEN_SOURCES),
  away: z.boolean().nullable(),
})

export type VenueOpenBody = z.infer<typeof venueOpenBodySchema>

// ============================================================================
// DynamoDB Entity Type
// ============================================================================

export interface CheckIn {
  checkInId: string
  userId: string
  nodeId: string
  neighbourhoodId?: string
  type: string
  checkedInAt: string
  /**
   * How the consumer found the venue, derived server-side by the Away_Gate
   * (proof-of-demand R3.1, R3.5). Required, so no check-in can be written
   * without an answer; `walk_in` is the honest default. Never read from the
   * request body. An enum and nothing else: no share token, no referrer, no
   * campaign id (R11.2). Check-ins written before this spec carry no attribute
   * and read back as `walk_in`.
   */
  foundVia: FoundVia
}
