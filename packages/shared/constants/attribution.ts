// The one home for the attribution thresholds (proof-of-demand R3.7). The
// check-in service, the Venue_Open service, every read model (Receipt, digest,
// live stats, boost scoreboard) and the consumer client import from here, so no
// surface can redefine a threshold. Values are fixed by
// `docs/decisions/proof-of-demand.md`; changing one changes what every owner-
// facing number means, so edit the decision first. Pure data, no runtime
// dependencies, so the backend can import it without pulling in browser code.

/**
 * Maximum hours between a Venue_Open and a check-in at the same venue for the
 * check-in to be eligible as Found_You. Also the TTL of the
 * `open:{userId}:{nodeId}` KV row, so the row expires on its own.
 * Decision 1.
 */
export const ATTRIBUTION_WINDOW_HOURS = 6

/**
 * Away_Gate time arm: a Venue_Open counts only if it happened at least this
 * many minutes before the check-in. Longer than any "open the app at the bar,
 * then check in" sequence, so a person already in the room is never sold as
 * demand Area Code created. Decision 2.
 */
export const AWAY_GATE_MIN_MINUTES = 20

/**
 * Away_Gate distance arm: the client sets `away = distance > this` from a fresh
 * position. 500 m is the maximum check-in radius, so an unknown or borderline
 * position errs toward `walk_in`. The position itself is never sent (R2.2).
 * Decision 2.
 */
export const AWAY_DISTANCE_METRES = 500

/**
 * Consumers see a Going count only at this many or more, and only when a
 * Tonight exists. Below it, one or two marks read as empty rather than as
 * momentum. Owner-facing surfaces show the true count, including zero.
 * Decision 3.
 */
export const GOING_PUBLIC_THRESHOLD = 3

/**
 * Phase 1 deploy boundary: the instant from which `foundVia` is stamped on
 * check-ins. Check-ins before it have no `foundVia` and read as `walk_in`, so
 * any Receipt window starting earlier carries a "measured from {date}" line and
 * a partial week never reads as zero demand (R4.8). Set to Monday
 * 2026-09-28 00:00 SAST, a digest-week boundary, so no reported week is split
 * by it. Also bounds the dual read of pre-deploy UTC-keyed check-in detail rows
 * (R15.8).
 */
export const RECEIPT_MEASURED_FROM_ISO = '2026-09-27T22:00:00.000Z'

/**
 * Accepted `source` values on `POST /v1/nodes/:nodeId/open`: where a Venue_Open
 * came from. `walk_in` is deliberately absent, it is never a source, only an
 * outcome.
 */
export const OPEN_SOURCES = ['map', 'share', 'search', 'push'] as const

export type OpenSource = (typeof OPEN_SOURCES)[number]

/**
 * How each Open_Source reads in owner-facing copy. One home, so the Receipt
 * sentence ("6 from the map, 2 from a shared link") and the source badge on a
 * live check-in row can never describe the same source two ways. Descriptive
 * only, never causal: Area Code recorded where the consumer came from, it did
 * not bring them.
 */
export const OPEN_SOURCE_PHRASE: Record<OpenSource, string> = {
  map: 'from the map',
  share: 'from a shared link',
  search: 'from search',
  push: 'from a notification',
}

/**
 * The server-derived source stamped on every new check-in. `walk_in` is the
 * honest default: no Venue_Open row, an expired row, or a row that fails the
 * Away_Gate all resolve to it.
 *
 * Built from `OPEN_SOURCES` so the two lists cannot drift, and kept a literal
 * tuple (not a filtered array) so both work directly with `z.enum`.
 */
export const FOUND_VIA = [...OPEN_SOURCES, 'walk_in'] as const

export type FoundVia = (typeof FOUND_VIA)[number]

/**
 * A stored or received value is only a Found_Via if it is on the enum. The one
 * guard for every reader (the check-in row mapper, the business check-in cache
 * row, the live panel badge), so an absent or unrecognised value resolves to
 * `walk_in` the same way everywhere instead of once per call site.
 */
export function isFoundVia(value: unknown): value is FoundVia {
  return typeof value === 'string' && (FOUND_VIA as readonly string[]).includes(value)
}
