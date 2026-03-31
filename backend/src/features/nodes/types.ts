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

export const updateNodeBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  category: z.enum(['food', 'coffee', 'nightlife', 'retail', 'fitness', 'arts']).optional(),
  nodeColour: z.string().optional(),
  nodeIcon: z.string().optional(),
  qrCheckinEnabled: z.boolean().optional(),
})

export const claimNodeBodySchema = z.object({
  registrationNumber: z.string().regex(
    /^\d{4}\/\d{6}\/\d{2}$/,
    'CIPC format: YYYY/NNNNNN/NN',
  ),
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

export const registerImageBodySchema = z.object({
  s3Key: z.string().min(1),
  displayOrder: z.number().int().min(0).default(0),
})
