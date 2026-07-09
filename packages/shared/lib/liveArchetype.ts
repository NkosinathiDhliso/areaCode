import { ARCHETYPE_CATALOG } from '../constants/archetype-catalog'
import type { LiveArchetypeBranch, MusicSchedule, Node, PersonalityArchetype } from '../types'

import { genresToArchetype } from './genreToArchetype'
import { resolveActiveSlot, ScheduleResolverInternalError } from './scheduleResolver'

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal shape of a check-in entry consumed by the Live_Archetype resolver.
 *
 * The shared `CheckIn` type does not currently carry an `archetypeId` field -
 * the live-archetype-evaluator Lambda joins check-ins to the User table to
 * fetch each check-in user's archetype before invoking the resolver. We
 * therefore accept the structurally-narrow shape here so callers can pass
 * either denormalised `{ archetypeId }` objects or augmented `CheckIn`s.
 */
export interface LiveArchetypeCheckIn {
  archetypeId?: string | null
}

export interface LiveArchetypeInputs {
  /** The venue Node. Used for `defaultArchetypeId` (R7.7) only - never for I/O. */
  node: Pick<Node, 'id' | 'defaultArchetypeId'> | { id: string; defaultArchetypeId?: string | null }
  /** Optional Music_Schedule. When absent the resolver skips the schedule branches. */
  schedule?: MusicSchedule
  /**
   * Check-ins already filtered to the 90-minute Lookback_Window (R7.1, R7.6).
   * The resolver does no time-window filtering of its own - that's the
   * Lambda's job, since the cutoff requires `Date.now()` and the resolver
   * stays observably pure.
   */
  recentCheckIns: LiveArchetypeCheckIn[]
  /** Resolving timestamp, RFC 3339 with explicit timezone offset. */
  timestampIso: string
  // ── Presence-gate inputs (live-vibe-declaration) ──────────────────────────
  // All four are OPTIONAL by design so the flag-off path is byte-for-byte the
  // pre-feature resolver (design R10.3, R4.1). When `presenceFloor` is
  // undefined the resolver runs its existing precedence verbatim; only when it
  // is defined does the presence-is-truth gate engage.
  /**
   * The minimum qualifying Live_Presence_Count at which the glyph switches
   * from Declared_Vibe to Crowd_Vibe. When `undefined` the resolver runs its
   * existing (pre-feature) precedence verbatim - this is the flag-off path
   * (R10.3). Founder-confirmed candidate value: 3.
   */
  presenceFloor?: number
  /**
   * Small count below the Presence_Floor that holds the `crowd_live` branch to
   * prevent boundary oscillation. Applied downward only (see `previousBranch`).
   * Defaults to 0 when absent. Founder-confirmed candidate value: 1.
   */
  presenceGrace?: number
  /**
   * The honest present count gating the floor - honest present check-ins
   * inside the Lookback_Window carrying a catalog `archetypeId`. Never a
   * cumulative or decayed historical tally (R2.3). Treated as 0 when absent.
   */
  qualifyingPresenceCount?: number
  /**
   * The previously-resolved branch for this venue, used solely to apply the
   * downward Presence_Grace: the grace lowers the effective floor only while
   * `previousBranch === 'crowd_live'`. Sourced from the Node row's `lastBranch`
   * companion to `lastArchetypeId`. Absent/`null` ⇒ no grace applied.
   */
  previousBranch?: LiveArchetypeBranch | null
}

export interface LiveArchetypeResult {
  archetype: PersonalityArchetype
  branch: LiveArchetypeBranch
}

/**
 * Internal error type retained for symmetry with `ScheduleResolverInternalError`
 * and to give the Lambda's observability path a typed handle on R7.4 fall-through.
 *
 * Note: per the design ("R7 Live_Archetype resolver") and R7.4, the resolver
 * itself does NOT throw on the unreachable lineup branch. It catches the
 * upstream `ScheduleResolverInternalError` internally and falls through to
 * check-in / default / eclectic. This class exists so callers (the Lambda)
 * can construct and log a structured record of the fall-through without
 * inventing an ad-hoc shape.
 */
export class LiveArchetypeInternalError extends Error {
  public readonly code = 'unreachable_lineup_branch' as const
  public readonly nodeId: string
  public readonly scheduleId?: string
  public readonly timestamp: string

  constructor(args: { nodeId: string; scheduleId?: string; timestamp: string; message?: string }) {
    super(
      args.message ??
        `Live_Archetype internal error: unreachable lineup branch for node ${args.nodeId} at ${args.timestamp}`,
    )
    this.name = 'LiveArchetypeInternalError'
    this.nodeId = args.nodeId
    this.scheduleId = args.scheduleId
    this.timestamp = args.timestamp
    Object.setPrototypeOf(this, LiveArchetypeInternalError.prototype)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

const ECLECTIC_ID = 'archetype-eclectic'

/**
 * Index ARCHETYPE_CATALOG by `id` once at module load. Frozen so callers
 * cannot mutate the lookup table at runtime. R6.7 / R7.9 determinism depends
 * on the catalog being treated as immutable here.
 */
const CATALOG_BY_ID: ReadonlyMap<string, PersonalityArchetype> = (() => {
  const map = new Map<string, PersonalityArchetype>()
  for (const entry of ARCHETYPE_CATALOG) {
    map.set(entry.id, entry)
  }
  return map
})()

function getCatalogArchetype(id: string): PersonalityArchetype | undefined {
  return CATALOG_BY_ID.get(id)
}

function getEclecticArchetype(): PersonalityArchetype {
  // archetype-eclectic is required to exist in the catalog (R7.8); the
  // fallback literal is kept so a buggy or hand-edited catalog cannot crash
  // the live map.
  return (
    getCatalogArchetype(ECLECTIC_ID) ?? {
      id: ECLECTIC_ID,
      name: 'The Eclectic',
      iconId: 'eclectic',
      description: '',
      dimensionThresholds: {},
      priority: 2,
      isActive: true,
    }
  )
}

/**
 * Compute the mode (most frequent value) of catalog archetype ids in
 * `recentCheckIns`, with R7.6 tie-break rules:
 *   1. highest count wins
 *   2. lowest catalog `priority` wins on count tie
 *   3. lexicographically smallest `id` wins on priority tie
 *
 * Returns `null` if no check-in carries an `archetypeId` present in the
 * catalog. Iteration order over the input does not affect the result, since
 * we collect counts into a Map and then pick the winner via a deterministic
 * scan over the Map's keys.
 */
function pickCheckInMode(recentCheckIns: LiveArchetypeCheckIn[]): PersonalityArchetype | null {
  const counts = new Map<string, number>()
  for (const ci of recentCheckIns) {
    const id = ci?.archetypeId
    if (typeof id !== 'string' || id.length === 0) continue
    if (!CATALOG_BY_ID.has(id)) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  if (counts.size === 0) return null

  // Sort the candidate ids by the R7.6 tie-break order, then take the first.
  // We sort an array of ids rather than fold over the Map to keep the
  // tie-break logic compact and obviously order-independent.
  const candidates = Array.from(counts.entries()).map(([id, count]) => {
    const archetype = CATALOG_BY_ID.get(id)!
    return { id, count, priority: archetype.priority, archetype }
  })

  candidates.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count // highest count first
    if (a.priority !== b.priority) return a.priority - b.priority // lowest priority first
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0 // lex smallest id first
  })

  return candidates[0]!.archetype
}

/**
 * Resolve the schedule branch (steps 1 & 2 of the precedence table) for a
 * venue's Active_Slot, if one exists.
 *
 * Returns `{ archetype, branch: 'schedule_lineup' | 'schedule_blanket' }` when
 * an Active_Slot resolves to a catalog archetype, or `null` when there is no
 * schedule, no Active_Slot, or the matched slot is in an unexpected mode.
 *
 * This is the single home for the schedule-resolution logic. Both the
 * flag-off path (which surfaces the `schedule_*` branch verbatim) and the
 * flag-on path (which re-labels the same archetype as `declared_promise`)
 * call it, so the lineup/blanket genre-to-archetype mapping and the R7.4
 * `ScheduleResolverInternalError` fall-through are never duplicated.
 */
function resolveScheduleBranch(schedule: MusicSchedule | undefined, timestampIso: string): LiveArchetypeResult | null {
  if (!schedule) return null

  let resolved: ReturnType<typeof resolveActiveSlot> | null = null
  try {
    resolved = resolveActiveSlot(schedule, timestampIso)
  } catch (err) {
    // Per R7.4: the unreachable lineup branch must not crash the resolver.
    // Catch the well-known internal error and fall through. Any other
    // error (e.g. `ScheduleValidationError` for a malformed schedule)
    // propagates so the caller can decide whether to treat it as a
    // programmer error or to swallow it at the I/O boundary.
    if (err instanceof ScheduleResolverInternalError) {
      resolved = null
    } else {
      throw err
    }
  }

  if (resolved) {
    if (resolved.slot.mode === 'lineup' && resolved.lineupEntry) {
      const { archetype } = genresToArchetype(resolved.lineupEntry.genres)
      return { archetype, branch: 'schedule_lineup' }
    }
    if (resolved.slot.mode === 'blanket') {
      const { archetype } = genresToArchetype(resolved.slot.genres ?? [])
      return { archetype, branch: 'schedule_blanket' }
    }
    // Defensive: any other mode (validator should reject) falls through.
  }

  return null
}

/**
 * Resolve the tail of the precedence table (steps 4 & 5): the Node default
 * archetype if present in the catalog, otherwise the eclectic fallback. Shared
 * by both the flag-off path and the flag-on fall-through so the default →
 * eclectic logic has one home.
 */
function resolveDefaultTail(node: LiveArchetypeInputs['node']): LiveArchetypeResult {
  const defaultId = node?.defaultArchetypeId
  if (typeof defaultId === 'string' && defaultId.length > 0) {
    const fromCatalog = getCatalogArchetype(defaultId)
    if (fromCatalog) {
      return { archetype: fromCatalog, branch: 'default' }
    }
  }
  return { archetype: getEclecticArchetype(), branch: 'eclectic_fallback' }
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveLiveArchetype
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a venue's Live_Archetype for a given timestamp.
 *
 * Branch order (mirrors R7's table verbatim):
 *
 *   1. Active_Slot in `lineup` mode → `schedule_lineup`, archetype derived
 *      from the LineupEntry's genres.
 *   2. Active_Slot in `blanket` mode → `schedule_blanket`, archetype derived
 *      from the slot's genres.
 *   3. No Active_Slot AND ≥ 1 recent check-in with a catalog `archetypeId` →
 *      `checkin_mode`, archetype = mode of those ids with R7.6 tie-break.
 *   4. No Active_Slot, no qualifying check-ins, Node has a `defaultArchetypeId`
 *      that is present in the catalog → `default`.
 *   5. Otherwise → `eclectic_fallback`, archetype = `archetype-eclectic`.
 *
 * The function is observably pure (R7.9): same inputs → same output, no
 * `Date.now()`, no globals, no I/O. The `recentCheckIns` array is expected
 * to already be filtered to the 90-minute Lookback_Window - that filtering
 * is the Lambda's responsibility because it requires `Date.now()`.
 *
 * Per R7.4 the resolver does NOT throw on the unreachable lineup branch:
 * if `resolveActiveSlot` raises `ScheduleResolverInternalError`, the
 * resolver catches it internally and falls through to step 3, mirroring the
 * Lambda's behaviour and ensuring no runtime observably-incorrect crash.
 *
 * ── Presence-is-truth precedence (live-vibe-declaration) ────────────────────
 * When `inputs.presenceFloor` is defined the resolver evaluates the
 * presence-is-truth gate BEFORE the schedule branch (design "The precedence
 * flip"):
 *
 *   effectiveFloor = previousBranch === 'crowd_live'
 *     ? presenceFloor - (presenceGrace ?? 0)   // downward grace only
 *     : presenceFloor
 *   count = qualifyingPresenceCount ?? 0
 *
 *   if count >= effectiveFloor and a catalog crowd mode exists → `crowd_live`
 *   elif an Active_Slot resolves                               → `declared_promise`
 *   else                                                       → default → eclectic
 *
 * When `count >= effectiveFloor` but no qualifying crowd mode exists the
 * resolver does NOT fabricate a vibe - it falls through to the declared
 * promise / default tail (R2, design). When `presenceFloor` is `undefined`
 * (flag off, R10.3) the original live-vibe-on-map body runs verbatim and the
 * presence inputs are ignored entirely.
 */
export function resolveLiveArchetype(inputs: LiveArchetypeInputs): LiveArchetypeResult {
  const { schedule, recentCheckIns, timestampIso, node } = inputs

  // ── Flag-on path: presence-is-truth precedence (R1, R2, R3) ──────────────
  // Engaged only when `presenceFloor` is defined. Evaluated BEFORE the
  // schedule branch so a real crowd beats the declaration outright (R2.1).
  if (inputs.presenceFloor !== undefined) {
    const effectiveFloor =
      inputs.previousBranch === 'crowd_live'
        ? inputs.presenceFloor - (inputs.presenceGrace ?? 0) // downward grace only (R3.1, R3.2)
        : inputs.presenceFloor
    const count = inputs.qualifyingPresenceCount ?? 0

    if (count >= effectiveFloor) {
      const crowd = pickCheckInMode(recentCheckIns ?? [])
      if (crowd) {
        return { archetype: crowd, branch: 'crowd_live' }
      }
      // The room is real but no check-in carries a catalog archetype mode -
      // do NOT fabricate a vibe; fall through to the declared promise /
      // default tail below (R2, design).
    }

    // Below the floor (or no qualifying crowd above it): the declaration is a
    // promise about a not-yet-full room (R1.1).
    const declared = resolveScheduleBranch(schedule, timestampIso)
    if (declared) {
      return { archetype: declared.archetype, branch: 'declared_promise' }
    }

    // No Active_Slot → existing default → eclectic tail, unchanged (R1.2).
    return resolveDefaultTail(node)
  }

  // ── Flag-off path: existing live-vibe-on-map precedence, verbatim ────────
  // Steps 1 & 2: schedule branches.
  const scheduleResult = resolveScheduleBranch(schedule, timestampIso)
  if (scheduleResult) {
    return scheduleResult
  }

  // Step 3: check-in mode.
  const checkInMode = pickCheckInMode(recentCheckIns ?? [])
  if (checkInMode) {
    return { archetype: checkInMode, branch: 'checkin_mode' }
  }

  // Steps 4 & 5: Node default → eclectic fallback.
  return resolveDefaultTail(node)
}
