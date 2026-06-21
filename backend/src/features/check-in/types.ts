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
