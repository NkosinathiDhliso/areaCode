import { z } from 'zod'

export const citySlugParamsSchema = z.object({
  citySlug: z.string().min(1),
})

export const nodeIdParamsSchema = z.object({
  nodeId: z.string().uuid(),
})

export const nodeSlugParamsSchema = z.object({
  nodeSlug: z.string().min(1),
})

export const searchQuerySchema = z.object({
  q: z.string().min(2, 'Query must be at least 2 characters'),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
})

export const createNodeBodySchema = z.object({
  name: z.string().min(1).max(100),
  category: z.enum(['food', 'coffee', 'nightlife', 'retail', 'fitness', 'arts']),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  citySlug: z.string().min(1),
})

export const businessCreateNodeBodySchema = z.object({
  name: z.string().min(1).max(100),
  category: z.enum(['food', 'coffee', 'nightlife', 'retail', 'fitness', 'arts']),
  address: z.string().min(5).max(200),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
})

export const updateNodeBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  category: z.enum(['food', 'coffee', 'nightlife', 'retail', 'fitness', 'arts']).optional(),
  nodeColour: z.string().optional(),
  nodeIcon: z.string().optional(),
  qrCheckinEnabled: z.boolean().optional(),
  address: z.string().min(5).max(200).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
})

export const claimNodeBodySchema = z.object({
  registrationNumber: z.string().regex(/^\d{4}\/\d{6}\/\d{2}$/, 'CIPC format: YYYY/NNNNNN/NN'),
})

export const reportNodeBodySchema = z.object({
  type: z.enum(['wrong_location', 'permanently_closed', 'fake_rewards', 'offensive_content', 'other']),
  detail: z.string().max(200).optional(),
})

export const whoIsHereQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
})

export const presignedUploadBodySchema = z.object({
  fileType: z.enum(['node_image', 'avatar']),
  contentType: z.enum(['image/jpeg', 'image/webp', 'image/png']),
})

// ============================================================================
// DynamoDB Entity Types
// ============================================================================

export interface Node {
  nodeId: string
  name: string
  slug: string
  category: string
  lat: number
  lng: number
  cityId?: string
  businessId?: string
  submittedBy?: string
  claimStatus: string
  claimCipcStatus?: string
  nodeColour: string
  nodeIcon?: string
  qrCheckinEnabled: boolean
  isVerified: boolean
  isActive: boolean
  /** S3 object key of the venue header image, served to clients via VITE_CDN_URL. */
  headerImageKey?: string | null
  /**
   * Fallback Archetype id used by taste-match ranking (and the Live_Archetype
   * resolver) when no live archetype is currently emitted. Absent/unknown ids
   * fall through to `archetype-eclectic`.
   */
  defaultArchetypeId?: string | null
  /** Last Live_Archetype id emitted for this venue, when one is active. */
  currentArchetypeId?: string | null
  /**
   * End of the paid Boost_Window as an ISO 8601 ms UTC instant. Set on boost
   * payment success to `max(existing, paidAt + duration)`. A node is
   * Boost_Active while `boostUntil > now`, computed at read time (no worker).
   * Absent/null means no boost has ever been purchased.
   */
  boostUntil?: string | null
  createdAt: string
  updatedAt: string
}
