import { z } from 'zod'

export const followParamsSchema = z.object({
  id: z.string().uuid(),
})

export const feedQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(50).default(20),
})

export const leaderboardParamsSchema = z.object({
  citySlug: z.string().min(1),
})

export const nearbyRecentQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusMetres: z.coerce.number().default(1000),
  withinMinutes: z.coerce.number().default(10),
})

export const whoIsHereParamsSchema = z.object({
  id: z.string().uuid(),
})

export const userSearchQuerySchema = z.object({
  q: z.string().min(2, 'Query must be at least 2 characters').max(50),
})
