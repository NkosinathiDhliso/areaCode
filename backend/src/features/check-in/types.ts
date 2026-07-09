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
// DynamoDB Entity Type
// ============================================================================

export interface CheckIn {
  checkInId: string
  userId: string
  nodeId: string
  neighbourhoodId?: string
  type: string
  checkedInAt: string
}
