import { z } from 'zod'

// ============================================================================
// Signal Type Constants
// ============================================================================

export const MUSIC_GENRES = [
  'amapiano',
  'deep_house',
  'afrobeats',
  'hip_hop',
  'rnb',
  'kwaito',
  'gqom',
  'jazz',
  'rock',
  'pop',
  'gospel',
  'maskandi',
] as const

export const QUEUE_VALUES = ['none', 'short', 'long'] as const

export const SIGNAL_TYPES = ['genre_playing', 'queue_length'] as const

// ============================================================================
// TypeScript Types
// ============================================================================

export type MusicGenre = (typeof MUSIC_GENRES)[number]

export type QueueValue = (typeof QUEUE_VALUES)[number]

export type SignalType = (typeof SIGNAL_TYPES)[number]

export interface SignalRecord {
  signalId: string
  nodeId: string
  userId: string
  type: SignalType
  value: string
  reporterWeight: number
  isProximity: boolean
  isOwner: boolean
  createdAt: string // ISO 8601
}

export interface ConsensusResult {
  consensusValue: string | null
  confidenceScore: number // 0.0 - 1.0
  reportCount: number
  lastUpdatedAt: string
}

export interface SubmitSignalInput {
  userId: string
  nodeId: string
  type: SignalType
  value: string
  lat?: number
  lng?: number
  isOwner: boolean
}

export interface SubmitSignalResult {
  signalId: string
  reputationEarned: number
  isProximityReport: boolean
}

export interface DisputeRecord {
  disputeId: string
  nodeId: string
  signalId: string
  businessId: string
  reason: string
  status: 'pending' | 'upheld' | 'dismissed' | 'expired'
  createdAt: string // ISO 8601
  resolvedAt: string | null
  resolvedBy: string | null
}

// ============================================================================
// Zod Validation Schemas
// ============================================================================

export const musicGenreSchema = z.enum(MUSIC_GENRES)

export const queueValueSchema = z.enum(QUEUE_VALUES)

export const signalTypeSchema = z.enum(SIGNAL_TYPES)

/**
 * Signal submission body schema with cross-validation:
 * - genre_playing type requires a valid MusicGenre value
 * - queue_length type requires a valid QueueValue (none | short | long)
 */
export const submitSignalBodySchema = z
  .object({
    nodeId: z.string().min(1),
    type: signalTypeSchema,
    value: z.string().min(1),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .refine(
    (data) => {
      if (data.type === 'genre_playing') {
        return (MUSIC_GENRES as readonly string[]).includes(data.value)
      }
      if (data.type === 'queue_length') {
        return (QUEUE_VALUES as readonly string[]).includes(data.value)
      }
      return false
    },
    { message: 'Invalid value for the given signal type', path: ['value'] }
  )

export const disputeBodySchema = z.object({
  reason: z.string().min(1).max(500),
  nodeId: z.string().min(1),
})

export const signalIdParamsSchema = z.object({
  signalId: z.string().min(1),
})

export const nodeIdParamsSchema = z.object({
  nodeId: z.string().min(1),
})

// ============================================================================
// Inferred Types from Schemas
// ============================================================================

export type SubmitSignalBody = z.infer<typeof submitSignalBodySchema>
export type DisputeBody = z.infer<typeof disputeBodySchema>
