/**
 * Away_Gate and Found_Via resolution (proof-of-demand R2.3, R2.4, R3.7).
 *
 * One question, answered in one place: did this consumer find the venue on
 * Area Code before they walked in, or were they already in the room? The answer
 * is stamped on every check-in as `foundVia` and is the only number allowed next
 * to the word "found" on an owner surface, so it has to be defensible to a
 * sceptical owner.
 *
 * Pure: no clock, no I/O, no globals. The caller passes the Venue_Open row it
 * read from the KV and the check-in instant (`capturedAt` for an offline replay,
 * else now), so the whole rule is testable without a database.
 *
 * The rule, in the order it is applied:
 *
 * 1. No row → `walk_in`. A QR scan at the till with no earlier open is a
 *    Walk_In by construction.
 * 2. Unreadable row or instant, or an `openedAt` after the check-in → `walk_in`.
 *    We cannot verify the gate, so we do not claim the credit.
 * 3. Row older than the Attribution_Window → `walk_in`. The KV TTL normally
 *    removes the row first; this check is the defensive twin of that TTL, and it
 *    is what catches an offline replay whose row expired while the phone was
 *    dark.
 * 4. `away === true` → the row's source. The consumer was outside the check-in
 *    radius when they looked.
 * 5. Age at least `AWAY_GATE_MIN_MINUTES` → the row's source. `away === null`
 *    (position unknown) relies on this time arm alone.
 * 6. Otherwise → `walk_in`. Someone who opened the app in the room minutes
 *    before checking in is not demand we created.
 *
 * Every branch that cannot be verified resolves to `walk_in`: the gate errs
 * toward under-claiming, never toward selling a walk-in as demand
 * (`honest-presence.md`). Thresholds come from
 * `@area-code/shared/constants/attribution`; this file defines none of its own
 * (R3.7).
 */

import {
  ATTRIBUTION_WINDOW_HOURS,
  AWAY_GATE_MIN_MINUTES,
  OPEN_SOURCES,
  type FoundVia,
  type OpenSource,
} from '@area-code/shared/constants/attribution'

/** The honest default outcome. */
const WALK_IN: FoundVia = 'walk_in'

const MINUTE_MS = 60_000

/** Maximum age of a Venue_Open row that can still be credited. */
const ATTRIBUTION_WINDOW_MS = ATTRIBUTION_WINDOW_HOURS * 60 * MINUTE_MS

/** Away_Gate time arm, in milliseconds. */
const AWAY_GATE_MIN_MS = AWAY_GATE_MIN_MINUTES * MINUTE_MS

/**
 * The `open:{userId}:{nodeId}` KV row, as stored by the Venue_Open service.
 * No coordinates, no device data, no display name (R11.1): `away` is the only
 * spatial fact and it is a boolean.
 */
export interface VenueOpenRow {
  /** Where the earliest open inside the window came from. */
  source: OpenSource
  /** ISO instant of the earliest open inside the window. */
  openedAt: string
  /** Was the consumer outside the check-in radius when they opened? */
  away: boolean | null
}

/**
 * Resolve the `foundVia` for one check-in.
 *
 * @param open The Venue_Open row for this consumer and venue, or `null` when
 *   none exists (absent or already expired by TTL).
 * @param checkInInstantIso The instant the check-in happened: `capturedAt` for
 *   an offline replay, otherwise now.
 * @returns The row's `source` when the Away_Gate passes inside the
 *   Attribution_Window, otherwise `walk_in`.
 */
export function resolveFoundVia(open: VenueOpenRow | null, checkInInstantIso: string): FoundVia {
  if (!open || !isOpenSource(open.source)) return WALK_IN

  const openedAt = epochMs(open.openedAt)
  const checkInAt = epochMs(checkInInstantIso)
  if (openedAt === null || checkInAt === null) return WALK_IN

  const age = checkInAt - openedAt
  // Negative age means a clock skew or a row from the future; both unverifiable.
  if (age < 0 || age > ATTRIBUTION_WINDOW_MS) return WALK_IN

  if (open.away === true) return open.source
  if (age >= AWAY_GATE_MIN_MS) return open.source
  return WALK_IN
}

/** Epoch milliseconds, or null when the value is not a readable instant. */
function epochMs(iso: string): number | null {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

/**
 * A KV row is untyped JSON at read time, so a source that is not one of the
 * accepted Open_Sources is treated as no row at all rather than trusted.
 * `walk_in` is never a source, only an outcome, so it fails this check too.
 */
function isOpenSource(value: string): value is OpenSource {
  return (OPEN_SOURCES as readonly string[]).includes(value)
}
