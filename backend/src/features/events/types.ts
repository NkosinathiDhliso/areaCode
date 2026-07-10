import { SA_CITIES, type CitySlug } from '@area-code/shared/constants/sa-cities'
import { USAGE_EVENT_NAMES } from '@area-code/shared/constants/usage-events'
import { z } from 'zod'

// Batch cap (design.md R4): a consented beacon flushes at most 20 buffered
// events per request. The server rejects anything larger so a misbehaving or
// malicious client cannot amplify a single request into unbounded metric writes.
export const MAX_EVENTS_PER_BATCH = 20

// City slugs derived from the single SA_CITIES source of truth (dry-reuse). The
// cast to a non-empty tuple is what `z.enum` needs; it stays in sync because it
// reads straight from SA_CITIES.
const CITY_SLUGS = SA_CITIES.map((c) => c.slug) as [CitySlug, ...CitySlug[]]

/**
 * Coarse, non-identifying event properties (R4.3, POPIA). A closed, `.strict()`
 * object so a client can never smuggle free-text, coordinates, a userId, or any
 * key that could reconstruct a movement trail. Mirrors the client
 * `UsageEventProps` (`packages/shared/lib/usageEvents.ts`): city-level context
 * only and the signup method, nothing else.
 */
export const usageEventPropsSchema = z
  .object({
    city: z.enum(CITY_SLUGS).optional(),
    method: z.enum(['email', 'google']).optional(),
  })
  .strict()

/**
 * A single buffered event. `name` is validated against the shared allowlist via
 * `z.enum(USAGE_EVENT_NAMES)`, so an unknown name rejects the whole batch with a
 * typed 400 (R4.5, strict allowlist) and never reaches the metric emitter.
 * `.strict()` rejects any extra top-level field (e.g. a coordinate or userId).
 */
export const usageEventSchema = z
  .object({
    name: z.enum(USAGE_EVENT_NAMES),
    sessionId: z.string().min(1).max(64),
    ts: z.number().int().nonnegative(),
    props: usageEventPropsSchema.optional(),
  })
  .strict()

/** The POST /v1/events request body: a bounded batch of events. */
export const eventBatchBodySchema = z
  .object({
    events: z.array(usageEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
  })
  .strict()

export type UsageEventInput = z.infer<typeof usageEventSchema>
export type EventBatchBody = z.infer<typeof eventBatchBodySchema>
