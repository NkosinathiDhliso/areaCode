import { z } from 'zod'

export const checkInBodySchema = z.object({
  nodeId: z.string().min(1),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  qrToken: z.string().optional(),
  type: z.enum(['reward', 'presence']),
  fingerprintHash: z.string().optional(),
})

export type CheckInInput = z.infer<typeof checkInBodySchema>

export interface CheckInResponse {
  success: boolean
  cooldownUntil: string
}
