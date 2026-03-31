import { z } from 'zod'

const VALID_GENRES = [
  'amapiano', 'deep_house', 'afrobeats', 'hip_hop', 'rnb',
  'kwaito', 'gqom', 'jazz', 'rock', 'pop', 'gospel', 'maskandi',
] as const

export const updateGenresBodySchema = z.object({
  musicGenres: z.array(z.enum(VALID_GENRES)).min(1).max(5),
})

export const connectStreamingBodySchema = z.object({
  provider: z.enum(['spotify', 'apple_music']),
  /** Apple Music user token from MusicKit JS — required when provider is apple_music */
  musicUserToken: z.string().min(1).optional(),
})

export const spotifyCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
})

export const crowdVibeParamsSchema = z.object({
  nodeId: z.string().min(1),
})

export type UpdateGenresBody = z.infer<typeof updateGenresBodySchema>
export type ConnectStreamingBody = z.infer<typeof connectStreamingBodySchema>
