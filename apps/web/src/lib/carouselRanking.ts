import { TIER_SIZE_MULTIPLIER } from '@area-code/shared/constants'
import type { Node } from '@area-code/shared/types'

import { BROWSE_STEP, INITIAL_BROWSE_COUNT } from './carouselConstants'

/**
 * Pure vibe-first ranking and viewport scoping for the Peek-Carousel.
 *
 * This module is the deterministic logic core behind `Carousel_Order`. It is
 * intentionally free of React and Mapbox so it can be exhaustively property
 * tested. All functions are total: they never throw on valid-shaped input.
 *
 * Ranking is vibe-first with proximity as a pure tiebreaker, per the discovery
 * DNA (`.kiro/steering/discovery-dna-vibe-over-convenience.md`).
 *
 * Design: .kiro/specs/map-discovery-experience/design.md
 *   - Components and Interfaces → "Key interfaces"
 *   - "proximityBiasedRank algorithm" (now `vibeRank`)
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.5
 */

/** Mean Earth radius in metres (spherical approximation). */
const EARTH_RADIUS_M = 6_371_000

export interface RankInput {
  venues: Node[]
  pulseScores: Record<string, number>
  checkInCounts: Record<string, number>
  lastKnownPosition: { lat: number; lng: number } | null
  /** True when `capturedAt` is within the Position_Freshness_Window. */
  positionFresh: boolean
  // --- Taste-match and live-gets signals (vibe-ranked-browse) ---
  /** The consumer's archetype id, or null if unset / unauthenticated. */
  consumerArchetypeId?: string | null
  /** Live archetype overrides per venue (mapStore.archetypeIds). */
  venueArchetypeIds?: Record<string, string>
  /** Friends currently checked in per venue: nodeId -> userId[]. */
  friendsAtVenue?: Record<string, string[]>
  /** Whether a venue has at least one live event/offer get. */
  hasLiveGets?: Record<string, boolean>
}

export interface ViewportBounds {
  west: number
  east: number
  south: number
  north: number
}

/**
 * Great-circle distance between two coordinates in metres using the
 * haversine formula. Total and deterministic for any finite input.
 */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)

  const sinDLat = Math.sin(dLat / 2)
  const sinDLng = Math.sin(dLng / 2)

  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  return EARTH_RADIUS_M * c
}

/**
 * Resolve the effective archetype for a venue using the live-override cascade:
 *   1. Live override from `venueArchetypeIds[node.id]` (real-time map data)
 *   2. Fallback to `node.defaultArchetypeId` (static node config)
 *   3. Final fallback: `'archetype-eclectic'` (no archetype is penalised)
 *
 * Design: .kiro/specs/vibe-ranked-browse/design.md § resolveArchetype
 * Requirements: 2.1
 */
export function resolveArchetype(node: Node, venueArchetypeIds: Record<string, string>): string {
  return venueArchetypeIds[node.id] ?? node.defaultArchetypeId ?? 'archetype-eclectic'
}

/**
 * Compute the taste-match score for a single venue.
 *
 * The score is a simple sum:
 *   - Archetype match: 1 if `consumerArchetypeId` equals `venueArchetypeId`, else 0.
 *     When the consumer has no archetype (null/undefined), match is always 0.
 *   - Friends at venue: the count of mutual friends currently checked in.
 *
 * This produces a numeric score so the lexicographic sort can compare venues at
 * priority 1. A venue with archetype match + 2 friends (score 3) outranks one
 * with only archetype match (score 1).
 *
 * Design: .kiro/specs/vibe-ranked-browse/design.md § tasteMatchScore
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 */
export function tasteMatchScore(
  consumerArchetypeId: string | null | undefined,
  venueArchetypeId: string,
  friendsAtVenueCount: number,
): number {
  const archetypeMatch = consumerArchetypeId && consumerArchetypeId === venueArchetypeId ? 1 : 0
  return archetypeMatch + friendsAtVenueCount
}

/**
 * Filter friend presence entries by expiry, returning only friends whose
 * check-in has NOT expired relative to the given `nowMs` timestamp.
 *
 * This is a defence-in-depth filter: the server already returns only active
 * friends, but the client re-applies the check in case of clock skew or
 * slightly stale rows from the `GET /v1/friends/presence` seed response.
 *
 * Pure function - no internal `Date.now()`; the caller supplies `nowMs`.
 *
 * Design: .kiro/specs/vibe-ranked-browse/design.md § filterActiveFriends
 * Requirements: 2.8, 3.5
 */
export function filterActiveFriends(
  friends: Array<{ nodeId: string; userId: string; expiresAt: string }>,
  nowMs: number,
): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const f of friends) {
    if (Date.parse(f.expiresAt) > nowMs) {
      const arr = result[f.nodeId] ?? (result[f.nodeId] = [])
      arr.push(f.userId)
    }
  }
  return result
}

/**
 * Derive a boolean map indicating which venues have at least one live event or
 * offer get. Only rewards with `lifecycle === 'live'` AND `getCategory` of
 * 'event' or 'offer' produce a `true` entry; all other venues are absent from
 * the map (treated as `false` by the ranking comparator via
 * `hasLiveGets[id] ? 1 : 0`).
 *
 * Used to populate `mapStore.hasLiveGets` when rewards-near-me data arrives.
 *
 * Requirements: 5.3, 5.4, 5.5
 */
export function deriveHasLiveGets(
  rewards: Array<{ nodeId: string; getCategory?: string; lifecycle?: string }>,
): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  for (const r of rewards) {
    if ((r.getCategory === 'event' || r.getCategory === 'offer') && r.lifecycle === 'live') {
      result[r.nodeId] = true
    }
  }
  return result
}

/**
 * Order venues by the full lexicographic ranking - each signal short-circuits
 * before the next is consulted, so a higher-priority signal structurally cannot
 * be overridden by any combination of lower-priority ones. This enforces the
 * Discovery DNA (`.kiro/steering/discovery-dna-vibe-over-convenience.md`):
 * proximity is incapable of outranking taste, vibe, tier, or live gets.
 *
 * The 6-signal order:
 *   1. **Taste-match score** (archetype affinity + friends-at-venue count).
 *      Higher wins. When the consumer has no archetypeId and no friends, this
 *      is 0 for all venues → gracefully degrades to aliveness-first (R7.1).
 *   2. **Aliveness** (pulseScore + checkInCount). Higher wins.
 *   3. **Boost then business tier** — the paid lever among equally-alive venues,
 *      ordered `(boostActive desc, tierWeight desc)`:
 *        3a. **Boost active** (node.boostActive, billing R5.3). A venue inside
 *            its Boost_Window sorts ahead of a non-boosted one. True > false.
 *        3b. **Business tier** (TIER_SIZE_MULTIPLIER[node.businessTier ??
 *            'starter']). Higher multiplier wins when boost state ties.
 *      Because this whole level sits below taste (1) and aliveness (2) and both
 *      short-circuit first, a boost can NEVER outrank taste-match or aliveness,
 *      per `discovery-dna-vibe-over-convenience.md`. Boost only reorders venues
 *      that are already equal on taste and aliveness.
 *   4. **Has live gets** (boolean: at least one live event/offer get). True > false.
 *   5. **Distance** (haversine metres, nearer wins). Only applied when
 *      `positionFresh && lastKnownPosition != null`; otherwise skipped entirely
 *      (not treated as zero distance).
 *   6. **Venue ID ascending** - deterministic tiebreaker ensuring total order.
 *
 * The function is pure: no I/O, no Date.now, clock injected from outside.
 * Deterministic for any valid RankInput (R1.8, R5.3, R5.5).
 *
 * Design: .kiro/specs/vibe-ranked-browse/design.md § vibeRank Comparator
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 5.3, 5.4, 8.1, 8.2, 8.3
 */
export function vibeRank(input: RankInput): Node[] {
  const {
    venues,
    pulseScores,
    checkInCounts,
    lastKnownPosition,
    positionFresh,
    consumerArchetypeId: rawConsumerArchetypeId,
    venueArchetypeIds: rawVenueArchetypeIds,
    friendsAtVenue: rawFriendsAtVenue,
    hasLiveGets: rawHasLiveGets,
  } = input

  // Safe defaults for optional fields (graceful degradation R7.1, R7.2)
  const consumerArchetypeId = rawConsumerArchetypeId ?? null
  const venueArchetypeIds = rawVenueArchetypeIds ?? {}
  const friendsAtVenue = rawFriendsAtVenue ?? {}
  const hasLiveGets = rawHasLiveGets ?? {}

  const useProximity = positionFresh && lastKnownPosition !== null

  return [...venues].sort((a, b) => {
    // 1) Taste-match score (higher wins) - archetype affinity + friends count
    const tasteA = tasteMatchScore(
      consumerArchetypeId,
      resolveArchetype(a, venueArchetypeIds),
      (friendsAtVenue[a.id] ?? []).length,
    )
    const tasteB = tasteMatchScore(
      consumerArchetypeId,
      resolveArchetype(b, venueArchetypeIds),
      (friendsAtVenue[b.id] ?? []).length,
    )
    if (tasteA !== tasteB) return tasteB - tasteA

    // 2) Aliveness (higher wins) - pulse + check-in count
    const aliveA = (pulseScores[a.id] ?? 0) + (checkInCounts[a.id] ?? 0)
    const aliveB = (pulseScores[b.id] ?? 0) + (checkInCounts[b.id] ?? 0)
    if (aliveA !== aliveB) return aliveB - aliveA

    // 3) Paid lever among equally-alive venues, ordered (boostActive desc, tier desc).
    //    Sits below taste (1) and aliveness (2), which short-circuit first, so a
    //    boost can never outrank taste-match or aliveness (billing R5.3,
    //    discovery-dna-vibe-over-convenience).
    // 3a) Boost active (true > false) - a live Boost_Window sorts ahead of none.
    const boostA = a.boostActive ? 1 : 0
    const boostB = b.boostActive ? 1 : 0
    if (boostA !== boostB) return boostB - boostA

    // 3b) Business tier (higher multiplier wins) - tiebreak when boost state is equal.
    const tierA = TIER_SIZE_MULTIPLIER[a.businessTier ?? 'starter']
    const tierB = TIER_SIZE_MULTIPLIER[b.businessTier ?? 'starter']
    if (tierA !== tierB) return tierB - tierA

    // 4) Has live gets (true > false)
    const getsA = hasLiveGets[a.id] ? 1 : 0
    const getsB = hasLiveGets[b.id] ? 1 : 0
    if (getsA !== getsB) return getsB - getsA

    // 5) Distance (nearer wins) - only when position is fresh; skipped otherwise (R1.6)
    if (useProximity) {
      const distA = haversineMeters(lastKnownPosition as { lat: number; lng: number }, { lat: a.lat, lng: a.lng })
      const distB = haversineMeters(lastKnownPosition as { lat: number; lng: number }, { lat: b.lat, lng: b.lng })
      if (distA !== distB) return distA - distB
    }

    // 6) Venue ID ascending - deterministic tiebreaker (R1.7)
    if (a.id < b.id) return -1
    if (a.id > b.id) return 1
    return 0
  })
}

/**
 * Restrict an already-ranked list to venues within the current Map_Canvas
 * bounds while never dropping the Active_Venue (R6.1, R6.2, R6.5).
 *
 * - With non-null `bounds`: returns the ranked venues that fall within the
 *   viewport, preserving their ranked order. If an Active_Venue is set but
 *   would fall outside the viewport, it is re-inserted at the front so it is
 *   never silently dropped mid-selection.
 * - With `null` bounds (e.g. map not yet ready): the viewport is unknown, so
 *   the function returns the Active_Venue alone (or an empty list when none
 *   is set). It always returns the Active_Venue for null bounds.
 */
export function scopeToViewport(ranked: Node[], bounds: ViewportBounds | null, activeVenueId: string | null): Node[] {
  if (bounds === null) {
    if (activeVenueId === null) return []
    const active = ranked.find((v) => v.id === activeVenueId)
    return active ? [active] : []
  }

  const inViewport = ranked.filter((v) => withinBounds(v, bounds))

  if (activeVenueId === null) return inViewport
  if (inViewport.some((v) => v.id === activeVenueId)) return inViewport

  const active = ranked.find((v) => v.id === activeVenueId)
  return active ? [active, ...inViewport] : inViewport
}

// ─── Browse Strip State Machine ──────────────────────────────────────────────

/**
 * Actions that drive the browse strip state transitions.
 *
 *   - `OPEN` / `FILTER_CHANGE` / `DISMISS` -> reset to the initial top-N view
 *     ({@link INITIAL_BROWSE_COUNT})
 *   - `TAP_MORE` -> reveal one more venue ({@link BROWSE_STEP})
 *   - `STEP` -> no expansion change (stepping through venues)
 *
 * Design: .kiro/specs/vibe-ranked-browse/design.md § Browse Strip State Reducer
 * Requirements: 4.3, 4.4
 */
export type BrowseAction =
  | { type: 'OPEN' }
  | { type: 'TAP_MORE' }
  | { type: 'DISMISS' }
  | { type: 'FILTER_CHANGE' }
  | { type: 'STEP' }

/**
 * State of the browse strip expansion.
 *
 * `visibleCount` is how many ranked venues the strip currently reveals. It
 * starts at {@link INITIAL_BROWSE_COUNT} and grows by {@link BROWSE_STEP} with
 * every "Keep exploring" tap - a progressive, one-at-a-time reveal rather than a
 * binary collapsed/expanded flip.
 */
export interface BrowseState {
  visibleCount: number
}

/**
 * Pure state reducer for the browse strip reveal state machine.
 *
 * Transitions:
 *   - `OPEN`, `DISMISS`, `FILTER_CHANGE` → reset to {@link INITIAL_BROWSE_COUNT}
 *     (back to the top 2)
 *   - `TAP_MORE` → reveal one more venue (`visibleCount + BROWSE_STEP`)
 *   - `STEP` → no change (stepping doesn't affect how many are revealed)
 *
 * Each `TAP_MORE` drips in the next-best venue and the strip stays at that depth
 * until `DISMISS` or `FILTER_CHANGE` resets it. The reveal is intentionally
 * unbounded here; {@link deriveBrowseStrip} clamps it to the ranked list length
 * (itself capped at `RECOMMENDED_LIMIT` in the recommended scope), so the strip
 * can never reveal more venues than actually exist.
 *
 * Design: .kiro/specs/vibe-ranked-browse/design.md § Browse Strip State Reducer
 * Requirements: 4.3, 4.4
 */
export function browseReducer(state: BrowseState, action: BrowseAction): BrowseState {
  switch (action.type) {
    case 'OPEN':
    case 'DISMISS':
    case 'FILTER_CHANGE':
      return { visibleCount: INITIAL_BROWSE_COUNT }
    case 'TAP_MORE':
      return { visibleCount: state.visibleCount + BROWSE_STEP }
    case 'STEP':
      return state
  }
}

// ─── Progressive reveal selector ────────────────────────────────────────────

/**
 * Derive the visible venues and "More" affordance for the browse strip from the
 * ranked list and the current `visibleCount`.
 *
 * This is a pure selector kept separate from the reducer so it can be
 * property-tested independently.
 *
 * Rules:
 *   - Show the first `visibleCount` ranked venues (clamped to the list length so
 *     it never over-reads).
 *   - `showMore = true` whenever there are still un-revealed venues
 *     (`visible.length < ranked.length`), so the "Keep exploring" card keeps
 *     appearing until the whole ranked list is shown, then disappears.
 *
 * Design: .kiro/specs/vibe-ranked-browse/design.md § Top N + More Entry Point
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */
export function deriveBrowseStrip(ranked: Node[], visibleCount: number): { visible: Node[]; showMore: boolean } {
  const count = Math.max(0, visibleCount)
  const visible = ranked.slice(0, count)
  return { visible, showMore: visible.length < ranked.length }
}

// ─── Viewport Scoping (unchanged) ──────────────────────────────────────────

/** True when the coordinate lies inside the bounds, handling antimeridian wrap. */
function withinBounds(v: { lat: number; lng: number }, b: ViewportBounds): boolean {
  const latOk = v.lat >= b.south && v.lat <= b.north
  return latOk && lngWithin(v.lng, b.west, b.east)
}

/**
 * Longitude containment that tolerates a viewport crossing the antimeridian,
 * where Mapbox can report `west > east`.
 */
function lngWithin(lng: number, west: number, east: number): boolean {
  if (west <= east) return lng >= west && lng <= east
  return lng >= west || lng <= east
}
