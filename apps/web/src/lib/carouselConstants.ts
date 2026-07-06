/**
 * Carousel constants and Venue_Card view-model derivation.
 *
 * Foundations for the Map Discovery / Peek-Carousel experience. This module is
 * intentionally **pure** - it imports no React, no Mapbox, and no stores - so it
 * can be consumed by both the render shells and the fast-check property tests
 * against the pure logic cores (design § Testing Strategy).
 *
 * Feature: map-discovery-experience
 */

import type { Node, NodeState, VenueMomentum } from '@area-code/shared/types'

import { getNodeState } from './mapHelpers'

// ─── Tunable carousel constants ──────────────────────────────────────────────

/**
 * Dominant-axis margin (in pixels) used by `classifyDrag` to decide whether a
 * drag is a horizontal Carousel_Swipe or a vertical sheet gesture. A drag is
 * only classified once one axis leads the other by more than this margin.
 */
export const DRAG_AXIS_THRESHOLD = 8

/**
 * Window (in ms) within which a Last_Known_Position is considered fresh enough
 * to recenter the map or bias the ranking. Mirrors the existing freshness gate
 * in `useMapInit`'s `recenterUser`.
 */
export const POSITION_FRESHNESS_WINDOW = 60_000

// ─── Shared map-presentation constants ───────────────────────────────────────
//
// These mirror the values currently inlined in `useMapMarkers` and the
// `sheetFocusOffset()` helper in `MapScreen`. They live here as the single
// shared home so the carousel, camera, and marker layers all agree on the same
// thresholds. Later marker/camera tasks (13.x, 8.x) import them from here.

/**
 * Zoom at or above which markers render the detailed archetype glyph
 * (Glyph_Zoom). Below it markers collapse to a category dot.
 */
export const GLYPH_ZOOM_THRESHOLD = 12.5

/**
 * Zoom below which the Marker_Layer renders Constellation beams instead of
 * dots/glyphs. Former Globe_Zoom "hidden" tier - see constellation-mode.md.
 */
export const MIN_MARKER_ZOOM = 8

/** Map minZoom; beams do not render below this. */
export const CONSTELLATION_MIN_ZOOM = 4

/** Below this zoom, dormant venues are omitted from the Constellation cap. */
export const CONSTELLATION_DORMANT_CUTOFF_ZOOM = 6

/** Tap target width for Constellation beams (px). */
export const BEAM_HIT_WIDTH_PX = 48

/**
 * Per-Pulse_State marker/beam animation. Aliveness is encoded as TEMPO within a
 * deliberately calm band - a true lub-dub heartbeat (see the `heartbeat`
 * keyframe in `packages/shared/tokens.css`), never a strobe. Every state uses
 * the same double-thump curve; a busier venue simply beats a little faster. The
 * fastest state (popping) completes a full beat-and-rest cycle in 1.6s, and the
 * rest phase between thumps means it never reads as flashing. The rest of the
 * aliveness signal is carried by beam height and opacity (see `markerBeam`
 * BEAM_HEIGHT / BEAM_OPACITY) so motion can stay calm without weakening the
 * "this venue is alive" read - aliveness still leads (discovery-DNA), just
 * calmly (constellation-mode "calm by default").
 *
 * Single source of truth: imported by both the Constellation beam layer
 * (`markerBeam.ts`) and the glyph/dot marker layer (`useMapMarkers.ts`) so the
 * two surfaces never drift apart.
 */
export const PULSE_TEMPO: Record<NodeState, { animation: string; speed: string }> = {
  dormant: { animation: 'heartbeat', speed: '5s' },
  quiet: { animation: 'heartbeat', speed: '4s' },
  active: { animation: 'heartbeat', speed: '3s' },
  buzzing: { animation: 'heartbeat', speed: '2.2s' },
  popping: { animation: 'heartbeat', speed: '1.6s' },
}

/**
 * Zoom the camera flies to on the first cold-open move, when the map is still
 * sitting on the country-wide overview (below {@link MIN_MARKER_ZOOM}, where
 * markers are hidden). Landing here means the consumer opens straight onto a
 * city where the alive, taste-matched venue is visible as a glyph - "the city
 * is alive, now you can see it" - instead of an empty country map they have to
 * pinch-zoom into. Chosen just above {@link GLYPH_ZOOM_THRESHOLD} so the hero
 * venue and its neighbours render as detailed glyphs on arrival.
 */
export const MAP_ARRIVAL_ZOOM = 13

/**
 * Fallback fraction of the viewport height used as the vertical fly-to offset
 * (Sheet_Focus_Offset) when the live Peek_Carousel sheet cannot be measured
 * (SSR / tests / sheet not yet mounted). When the sheet is mounted,
 * `sheetFocusOffset` measures it directly and frames the venue in the band
 * above it instead of using this fixed ratio.
 */
export const SHEET_FOCUS_OFFSET_RATIO = 0.3

/**
 * Max number of venues surfaced in the citywide "recommended" browse scope
 * (the default carousel state). The list is the full `vibeRank` order capped to
 * this many so the strip leads with the strongest taste/aliveness magnets
 * without unbounded growth. The Active_Venue is always retained even if it
 * falls past the cap. The "area" scope (after the user pans/zooms) is bounded
 * by the viewport instead, so this cap does not apply there.
 */
export const RECOMMENDED_LIMIT = 20

/**
 * Number of venues the Browse strip reveals before any "Keep exploring" tap -
 * the strongest two magnets only, so the consumer is not flooded with choice on
 * open (vibe-first, not a long list to scroll). See
 * `.kiro/steering/discovery-dna-vibe-over-convenience.md`.
 */
export const INITIAL_BROWSE_COUNT = 2

/**
 * Number of extra venues revealed per "Keep exploring" tap. Progressive,
 * one-at-a-time disclosure: each tap drips in the next-best venue rather than
 * dumping the whole ranked list. This keeps the lead on the most alive,
 * taste-matched venues while letting curiosity pull the consumer deeper - the
 * reveal never exceeds the ranked list, which is itself capped at
 * {@link RECOMMENDED_LIMIT} in the citywide recommended scope.
 */
export const BROWSE_STEP = 1

// ─── 3D fly-through (dramatic venue-switch camera) ───────────────────────────
//
// When the map is tilted (3D) and the user steps between venues, the camera
// arcs - rising up off the rooftops, sweeping across the city, then descending
// onto the next venue - instead of a flat pan. The arc peak (`minZoom` on the
// fly-to) forces this "lift off and fly over" read even for venues that are
// close together, while the destination zoom stays the user's current zoom so
// the map-carousel "preserve the user's zoom" contract holds. In flat (2D) mode
// or under Reduced_Motion the arc is skipped and the move stays a direct glide.

/**
 * Minimum camera pitch (degrees) for the dramatic fly-through arc to engage.
 * Flat mode holds pitch 0; 3D mode holds >= 62 (see `pitchRamp.PITCH_3D`), so
 * this threshold cleanly separates the two without reading any 3D toggle state.
 */
export const FLY_THROUGH_MIN_PITCH = 10

/**
 * How many zoom levels the camera pulls back to at the peak of the fly-through
 * arc. Larger = the camera rises higher and the sweep across the city reads as
 * more cinematic. The destination zoom is unchanged; this only shapes the path.
 */
export const FLY_THROUGH_ZOOM_DIP = 2.2

/**
 * Floor for the fly-through arc peak zoom. Kept above {@link MIN_MARKER_ZOOM}
 * so venues stay legible (as dots/glyphs, never Constellation beams) through
 * the sweep, and so a step between two street-zoom venues never yanks the
 * camera out to the country overview.
 */
export const FLY_THROUGH_PEAK_ZOOM_FLOOR = 9

/**
 * Minimum map-center movement (metres) before a user pan/zoom flips the browse
 * scope from `recommended` to `area`. Filters out accidental micro-drags and
 * control-induced jitter so stepping through citywide recommendations does not
 * collapse the strip to the current viewport.
 */
export const AREA_SCOPE_MIN_MOVE_M = 400

/**
 * Minimum zoom-level change before a user zoom flips the browse scope from
 * `recommended` to `area`. Paired with {@link AREA_SCOPE_MIN_MOVE_M}.
 */
export const AREA_SCOPE_MIN_ZOOM_DELTA = 0.35

// ─── Spotlight mode ──────────────────────────────────────────────────────────

/**
 * Zoom the camera dives to when spotlight is entered from a Venue_Card hold
 * (the "take me there" gesture): a street-level close-up of the single
 * isolated venue, well past {@link GLYPH_ZOOM_THRESHOLD}. The dive never zooms
 * OUT: when the user is already closer than this, their zoom is preserved and
 * the move is pan-only. The glyph-hold trigger does not dive at all (the node
 * is already under the user's finger at their chosen zoom).
 */
export const SPOTLIGHT_DIVE_ZOOM = 16

/**
 * Zoom-out distance (in zoom levels) below the zoom recorded at spotlight entry
 * that ends spotlight. Zooming out this far reads as the consumer stepping back
 * from a single venue to compare the wider scene, so spotlight releases.
 */
export const SPOTLIGHT_EXIT_ZOOM_DELTA = 1.5

/**
 * Pure decision for whether spotlight should exit given the zoom at entry and
 * the current zoom. Two exit conditions, either one is enough:
 *
 * 1. Zoom-out delta: the user has zoomed out by at least `delta` levels from
 *    `entryZoom` (stepping back to compare venues).
 * 2. Constellation floor: `currentZoom` has crossed below {@link MIN_MARKER_ZOOM},
 *    where markers give way to Constellation beams, so a single-venue spotlight
 *    no longer applies.
 *
 * Kept pure (no React, Mapbox, or store access) so it can be property-tested
 * directly against the acceptance criteria.
 */
export function shouldExitSpotlight(
  entryZoom: number,
  currentZoom: number,
  delta: number = SPOTLIGHT_EXIT_ZOOM_DELTA,
): boolean {
  return currentZoom < MIN_MARKER_ZOOM || entryZoom - currentZoom >= delta
}

/**
 * Live_Archetype id used when no live value has arrived for a node and the node
 * carries no `defaultArchetypeId`. Mirrors R7.8's eclectic-fallback rule so the
 * Venue_Card glyph is never blank.
 */
export const DEFAULT_ARCHETYPE_ID = 'archetype-eclectic'

// ─── Venue_Card view model ───────────────────────────────────────────────────

/**
 * Derived (not stored) presentation model for a single Venue_Card.
 * See design § Data Models, "Venue_Card view model".
 */
export interface VenueCardVM {
  id: string
  name: string
  /** Raw "how many people are here right now" count from `mapStore.checkInCounts`. */
  liveCheckInCount: number
  /** Pulse_State derived from the venue's Pulse_Score via `getNodeState`. */
  pulseState: NodeState
  /** Resolved archetype id: live → node default → eclectic fallback. */
  archetypeId: string
  /** True when the live count is zero → render the "be the first in" affordance. */
  isFirstIn: boolean
  /**
   * Honest presence momentum from `mapStore.momentum`. Only `filling_up` /
   * `winding_down` surface a label; `steady` (the default when there is no
   * trend) renders nothing.
   */
  momentum: VenueMomentum
}

/**
 * Pure derivation of a {@link VenueCardVM} from a venue node and the live store
 * maps. Total over valid-shaped input: missing entries fall back to a zero count
 * (→ dormant Pulse_State, "be the first in" affordance) and the eclectic
 * archetype, so the helper never throws and never renders a blank card.
 *
 * Validates: Requirements 4.1, 4.6, 12.1, 12.2, 12.3
 */
export function toVenueCardVM(
  node: Node,
  checkInCounts: Record<string, number>,
  pulseScores: Record<string, number>,
  archetypeIds: Record<string, string>,
  momentumByNode: Record<string, VenueMomentum> = {},
): VenueCardVM {
  const liveCheckInCount = checkInCounts[node.id] ?? 0
  const pulseState = getNodeState(pulseScores[node.id] ?? 0)
  const archetypeId = archetypeIds[node.id] ?? node.defaultArchetypeId ?? DEFAULT_ARCHETYPE_ID

  return {
    id: node.id,
    name: node.name,
    liveCheckInCount,
    pulseState,
    archetypeId,
    isFirstIn: liveCheckInCount === 0,
    momentum: momentumByNode[node.id] ?? 'steady',
  }
}
