/**
 * Gets feed ranking — pure, taste-first ordering for the consumer "near me"
 * Get_Feed.
 *
 * This is the single source of truth for how gets are ORDERED once the
 * proximity query + lifecycle filter have selected them. It deliberately
 * mirrors the venue ranking in `apps/web/src/lib/carouselRanking.ts`
 * (`vibeRank`) signal-for-signal, so a get's position in the feed agrees with
 * its venue's position on the map. Bound by the product law:
 *
 *   `.kiro/steering/discovery-dna-vibe-over-convenience.md`
 *
 * The order is LEXICOGRAPHIC, strongest signal first — each signal short-circuits
 * before the next is consulted, so a higher-priority signal structurally cannot
 * be overridden by any combination of lower-priority ones:
 *
 *   1. Taste match — archetype affinity + friends-at-venue count between the
 *                    venue's crowd and the viewer. The lead signal: a get the
 *                    viewer is more likely to love ranks first. Degrades to 0
 *                    for every get when the viewer has no archetype and no
 *                    friends present, so the feed falls back to aliveness-first.
 *   2. Aliveness  — how buzzing the get's venue is RIGHT NOW.
 *                   `aliveness = pulseScore + liveCount` (honest current
 *                   presence + decaying pulse). Higher wins.
 *   3. Business tier — `tierMultiplier` from the venue's effective billing tier.
 *                    The paid lever among equally-on-taste, equally-alive gets.
 *                    Higher multiplier wins. (See MONETIZATION NOTE below.)
 *   4. Has live gets — true when the venue is running at least one live
 *                    event/offer get. True > false.
 *   5. Proximity  — nearer first; a tiebreaker only, never inverts a taste /
 *                    vibe / tier / live-gets winner.
 *   6. Id ascending — final deterministic tiebreak so the order is total and two
 *                     computations on identical input agree.
 *
 * MONETIZATION NOTE: business tier participates in this ordering at priority 3
 * (founder-approved override of the earlier "tier is absent from the feed" rule).
 * Tier is deliberately BELOW taste and aliveness, so a paid get still has to be
 * on-taste and alive to lead — payment only breaks ties between gets a viewer
 * would otherwise weigh equally. This matches `vibeRank` on the map exactly.
 *
 * Every function here is observably pure: no clock, no I/O, no globals — so the
 * ordering is deterministic and unit/property testable.
 */

/**
 * Business tier → ranking multiplier. Kept in lockstep with
 * `packages/shared/constants/tier-size.ts` (TIER_SIZE_MULTIPLIER) so the gets
 * feed and the map carousel weight tier identically. An unknown / absent tier
 * falls back to the neutral `starter` weight (1.0).
 */
export const TIER_MULTIPLIER: Record<string, number> = {
  free: 1.0,
  starter: 1.0,
  payg: 1.0,
  growth: 1.3,
  pro: 1.6,
}

/** Resolve a tier string to its ranking multiplier (neutral 1.0 fallback). */
export function tierMultiplierFor(tier: string | null | undefined): number {
  if (!tier) return 1.0
  return TIER_MULTIPLIER[tier] ?? 1.0
}

export interface GetRankSignals {
  /** Stable get id — final deterministic tiebreak. */
  id: string
  /**
   * Taste affinity between the venue's crowd and the viewer: archetype match
   * (0 or 1) + count of the viewer's friends currently present. Higher ranks
   * first. Pass 0 when the taste signal is unavailable (neutral, never invented).
   */
  tasteMatch: number
  /**
   * Honest aliveness of the get's venue right now: `pulseScore + liveCount`.
   * Higher ranks first.
   */
  aliveness: number
  /**
   * Ranking multiplier from the venue's effective business tier (see
   * TIER_MULTIPLIER). Defaults to 1.0 (neutral) when unknown.
   */
  tierMultiplier: number
  /** Whether the venue has at least one live event/offer get. True ranks first. */
  hasLiveGets: boolean
  /** Distance from the viewer in metres. Proximity is a tiebreaker ONLY. */
  distanceMeters: number
}

/**
 * Order gets vibe-first (taste → aliveness → tier → live gets → proximity → id),
 * returning a new array. The input is never mutated.
 */
export function rankGetsByVibe<T extends GetRankSignals>(gets: readonly T[]): T[] {
  return [...gets].sort((a, b) => {
    // 1) Taste match — the lead signal. A better match always wins.
    const tasteDelta = b.tasteMatch - a.tasteMatch
    if (tasteDelta !== 0) return tasteDelta
    // 2) Aliveness — more-alive venue's get wins among equally-on-taste gets.
    const alivenessDelta = b.aliveness - a.aliveness
    if (alivenessDelta !== 0) return alivenessDelta
    // 3) Business tier — paid lever among equally on-taste, equally-alive gets.
    const tierDelta = b.tierMultiplier - a.tierMultiplier
    if (tierDelta !== 0) return tierDelta
    // 4) Has live gets — a venue running a live event/offer wins (true > false).
    const getsA = a.hasLiveGets ? 1 : 0
    const getsB = b.hasLiveGets ? 1 : 0
    if (getsA !== getsB) return getsB - getsA
    // 5) Proximity — pure tiebreaker only (nearer first); never outranks above.
    const distDelta = a.distanceMeters - b.distanceMeters
    if (distDelta !== 0) return distDelta
    // 6) Deterministic id tiebreak.
    if (a.id < b.id) return -1
    if (a.id > b.id) return 1
    return 0
  })
}

/**
 * Compute the taste-match score for a single get's venue. Mirrors
 * `tasteMatchScore` in `apps/web/src/lib/carouselRanking.ts`:
 *   archetype match (1 when the viewer's archetype equals the venue's, else 0)
 *   + the number of the viewer's friends currently present at the venue.
 *
 * When the viewer has no archetype the archetype term is 0; with no friends the
 * friend term is 0, so the score degrades cleanly to 0 (aliveness-first feed).
 */
export function getTasteMatch(
  viewerArchetypeId: string | null | undefined,
  venueArchetypeId: string,
  friendsAtVenueCount: number,
): number {
  const archetypeMatch = viewerArchetypeId && viewerArchetypeId === venueArchetypeId ? 1 : 0
  return archetypeMatch + friendsAtVenueCount
}

/** Pulse_State thresholds — kept in lockstep with the nodes service. */
const STATE_THRESHOLDS = [
  { min: 61, state: 'popping' as const },
  { min: 31, state: 'buzzing' as const },
  { min: 11, state: 'active' as const },
  { min: 1, state: 'quiet' as const },
  { min: 0, state: 'dormant' as const },
]

export type PulseState = 'popping' | 'buzzing' | 'active' | 'quiet' | 'dormant'

/** Map a pulse score to its Pulse_State band (same mapping as the map/carousel). */
export function pulseStateFromScore(score: number): PulseState {
  for (const t of STATE_THRESHOLDS) {
    if (score >= t.min) return t.state
  }
  return 'dormant'
}
