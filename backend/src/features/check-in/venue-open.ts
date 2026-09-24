/**
 * Venue_Open: the `open:{userId}:{nodeId}` row that makes "found you" a
 * measurement (proof-of-demand R2.1, R2.3, R2.4, R2.5, R11.1).
 *
 * One home for the row, shared by both sides of the receipt: the writer is
 * `POST /v1/nodes/:nodeId/open` (a consumer opened the venue's detail, or
 * arrived on it from a share or push link), the reader is the check-in service,
 * which resolves it through `resolveFoundVia` and consumes it. The row shape
 * itself is declared once, in `./found-via.ts`, so the gate and the storage can
 * never disagree about what is stored.
 *
 * What is stored, and nothing else: `{ source, openedAt, away }`. No
 * coordinates, no device data, no display name (R2.4, R11.1). `away` is a
 * boolean the client computes from a fresh position it never sends, so the only
 * spatial fact that leaves the device is "was I further than the maximum
 * check-in radius".
 *
 * Why it needs no sweeper: the TTL is the Attribution_Window, so an
 * uncredited row expires on its own and the KV holds at most one row per
 * consumer per venue for six hours (R12.1, no new infrastructure).
 *
 * Merge, not overwrite (R2.3): the first open inside the window is the one that
 * earns the credit, so a repeat open keeps the earliest `openedAt` and its
 * `source`. It still ORs `away` (an earlier away open is never discarded) and
 * still resets the TTL, so a second look never shortens the window.
 */

import { ATTRIBUTION_WINDOW_HOURS, OPEN_SOURCES, type OpenSource } from '@area-code/shared/constants/attribution'
import { z } from 'zod'

import { kvDel, kvGet, kvSet } from '../../shared/kv/dynamodb-kv.js'

import type { VenueOpenRow } from './found-via.js'

/**
 * TTL of the row, in seconds. The same Attribution_Window the Away_Gate uses, so
 * a row that is too old to credit is normally gone rather than merely ignored.
 */
export const ATTRIBUTION_WINDOW_SECONDS = ATTRIBUTION_WINDOW_HOURS * 60 * 60

/** The one KV key for a consumer's open at a venue. */
export function venueOpenKey(userId: string, nodeId: string): string {
  return `open:${userId}:${nodeId}`
}

/**
 * The row as it comes back off the KV: untyped JSON until proven otherwise. A
 * row that does not match is treated as no row at all, which resolves to
 * `walk_in` — the honest direction.
 */
const venueOpenRowSchema = z.object({
  source: z.enum(OPEN_SOURCES),
  openedAt: z.string().datetime(),
  away: z.boolean().nullable(),
})

/** What the endpoint accepts and the service turns into a row. */
export interface VenueOpenInput {
  source: OpenSource
  away: boolean | null
}

// ─── Merge (pure) ───────────────────────────────────────────────────────────

/**
 * Fold a new open into the row already held for this consumer and venue.
 *
 * Earliest wins: the returned `openedAt` and `source` are the earlier open's,
 * so the time arm of the Away_Gate measures from the first look and a consumer
 * cannot refresh their way out of a Walk_In. `away` is a three-valued OR, so a
 * single away open survives any number of at-the-venue opens, and the result
 * does not depend on the order the opens arrived in:
 *
 *   any `true` → `true`; else any `false` → `false`; else `null` (unknown).
 *
 * Pure: the caller supplies both rows and persists the result, so the whole
 * rule is testable without a database.
 */
export function mergeVenueOpen(existing: VenueOpenRow | null, incoming: VenueOpenRow): VenueOpenRow {
  if (!existing) return incoming
  const earliest = Date.parse(existing.openedAt) <= Date.parse(incoming.openedAt) ? existing : incoming
  return {
    source: earliest.source,
    openedAt: earliest.openedAt,
    away: orAway(existing.away, incoming.away),
  }
}

function orAway(a: boolean | null, b: boolean | null): boolean | null {
  if (a === true || b === true) return true
  if (a === false || b === false) return false
  return null
}

// ─── Storage ────────────────────────────────────────────────────────────────

/**
 * Read the row for this consumer and venue, or `null` when there is none.
 *
 * A row that is present but unreadable (corrupt JSON, a source outside
 * `OPEN_SOURCES`, a missing field) is logged at error level and reported as
 * absent: we cannot verify the gate, so we do not claim the credit. The log is
 * loud on purpose, and carries the venue only — never the consumer.
 */
export async function readVenueOpen(userId: string, nodeId: string): Promise<VenueOpenRow | null> {
  const raw = await kvGet(venueOpenKey(userId, nodeId))
  if (raw === null) return null

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    console.error(`[venue-open] unparseable row for node ${nodeId}; reading as no open`)
    return null
  }

  const parsed = venueOpenRowSchema.safeParse(json)
  if (!parsed.success) {
    console.error(`[venue-open] row for node ${nodeId} failed validation; reading as no open`)
    return null
  }
  return parsed.data
}

/** Persist the row with a fresh Attribution_Window TTL. */
export async function writeVenueOpen(userId: string, nodeId: string, row: VenueOpenRow): Promise<void> {
  await kvSet(venueOpenKey(userId, nodeId), JSON.stringify(row), ATTRIBUTION_WINDOW_SECONDS)
}

/** Consume the row. Called once the check-in that used it has been written (R3.3). */
export async function deleteVenueOpen(userId: string, nodeId: string): Promise<void> {
  await kvDel(venueOpenKey(userId, nodeId))
}

// ─── Service ────────────────────────────────────────────────────────────────

/**
 * Record one Venue_Open, merging into any unexpired row (R2.3).
 *
 * Read-then-write rather than a conditional update: the only writer for a given
 * key is one consumer's own app, so there is no contention worth a transaction,
 * and the merge is idempotent in the fields that matter (earliest open, ORed
 * away) if a duplicate ever does land.
 */
export async function recordVenueOpen(userId: string, nodeId: string, input: VenueOpenInput): Promise<void> {
  const incoming: VenueOpenRow = {
    source: input.source,
    openedAt: new Date().toISOString(),
    away: input.away,
  }
  const existing = await readVenueOpen(userId, nodeId)
  await writeVenueOpen(userId, nodeId, mergeVenueOpen(existing, incoming))
}
