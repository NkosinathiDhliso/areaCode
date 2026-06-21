/**
 * Gets feed ranking — pure, vibe-first ordering for the consumer "near me"
 * Get_Feed.
 *
 * This is the single source of truth for how gets are ORDERED once the
 * proximity query + lifecycle filter have selected them. It deliberately
 * mirrors the venue ranking in `apps/web/src/lib/carouselRanking.ts`
 * (`vibeRank`) and is bound by the same product law:
 *
 *   `.kiro/steering/discovery-dna-vibe-over-convenience.md`
 *
 * The order is LEXICOGRAPHIC, strongest signal first — proximity is structurally
 * incapable of outranking a more-alive or better-taste-matched get:
 *
 *   1. Aliveness  — how buzzing the get's venue is RIGHT NOW. Hero signal.
 *                   `aliveness = pulseScore + liveCount` (honest current
 *                   presence + decaying pulse). Higher wins outright.
 *   2. Taste match — archetype / music affinity between the venue's crowd and
 *                    the viewer, 0..1. Sits in the PRIMARY band, ABOVE proximity
 *                    (per the DNA: "When taste-match lands it joins THIS primary
 *                    comparison, ahead of proximity - never below it."). Until
 *                    the taste signal is wired it is passed as 0 for every get,
 *                    so it is neutral and aliveness leads — we never let
 *                    proximity fill the gap with a fake taste term.
 *   3. Proximity  — a pure tiebreaker, nearer first, only between gets of equal
 *                   aliveness AND equal taste. Can never invert a vibe/taste
 *                   winner.
 *   4. Id ascending — final deterministic tiebreak so the order is total and two
 *                     computations on identical input agree.
 *
 * NOTE: payment / tier / sponsorship is intentionally ABSENT. Per the DNA rule
 * and the event-and-offer-gets monetization invariant ("a get is a free
 * engagement tool; reach is the paid product"), what a business pays buys REACH
 * (a Boost lifts the proximity gate so a get is visible beyond near-me) — it
 * never reorders the feed. A paid get still has to be alive and on-taste to lead.
 *
 * Every function here is observably pure: no clock, no I/O, no globals — so the
 * ordering is deterministic and unit/property testable.
 */

export interface GetRankSignals {
  /** Stable get id — final deterministic tiebreak. */
  id: string
  /**
   * Honest aliveness of the get's venue right now: `pulseScore + liveCount`.
   * The hero signal. Higher ranks first.
   */
  aliveness: number
  /**
   * Archetype / music-taste affinity between the venue's crowd and the viewer,
   * normalised 0..1. Joins the PRIMARY comparison band ABOVE proximity. Pass 0
   * when the taste signal is not yet available (neutral — never invent it).
   */
  tasteMatch: number
  /** Distance from the viewer in metres. Proximity is a tiebreaker ONLY. */
  distanceMeters: number
}

/**
 * Order gets vibe-first (aliveness → taste → proximity → id), returning a new
 * array. The input is never mutated.
 */
export function rankGetsByVibe<T extends GetRankSignals>(gets: readonly T[]): T[] {
  return [...gets].sort((a, b) => {
    // 1) Aliveness — the hero signal. More-alive venue's get always wins.
    const alivenessDelta = b.aliveness - a.aliveness
    if (alivenessDelta !== 0) return alivenessDelta
    // 2) Taste match — primary band, above proximity. Better match wins.
    const tasteDelta = b.tasteMatch - a.tasteMatch
    if (tasteDelta !== 0) return tasteDelta
    // 3) Proximity — pure tiebreaker only (nearer first); never outranks vibe/taste.
    const distDelta = a.distanceMeters - b.distanceMeters
    if (distDelta !== 0) return distDelta
    // 4) Deterministic id tiebreak.
    if (a.id < b.id) return -1
    if (a.id > b.id) return 1
    return 0
  })
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
