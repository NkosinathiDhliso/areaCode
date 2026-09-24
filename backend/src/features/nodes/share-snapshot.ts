/**
 * Share_Preview snapshot copy — the `og:description` line served for
 * `/node/{slug}` (proof-of-demand R1.2, R1.3).
 *
 * Pure: no clock, no I/O, no globals. Same input always yields the same line,
 * so the route can be tested without a network or a database.
 *
 * Shape of the line (segments joined by a middle dot, in discovery-DNA
 * priority order — aliveness and taste lead, gets trail):
 *
 *   {venue name} · {pulse label} · {live count} here now · {Tonight} · {gets}
 *
 *   "Ramona's · Buzzing · 12 here now · Amapiano tonight from 21:00 · 1 get live"
 *   "Ramona's · Quiet right now · Amapiano tonight from 21:00"
 *   "Ramona's · Be the first in"
 *
 * Honesty rules this file enforces (`honest-presence.md`):
 * - Zero live presence never reads as busy. It reads "Quiet right now", or
 *   "Be the first in" when there is no pulse either. The decayed pulse score
 *   can never promote an empty room to Active/Buzzing/Popping.
 * - The live count only appears when it is above zero; we say less rather
 *   than dressing up an empty room.
 *
 * The venue name always leads the line (design Property 4), even though the
 * design's illustrative examples omit it; `og:title` carries the name too, but
 * some crawlers render the description alone.
 */

import { pulseStateFromScore, type PulseState } from '../rewards/ranking.js'

/** Segment separator (U+00B7 middle dot), as used in the consumer whisper copy. */
const SEPARATOR = ' \u00b7 '

/**
 * Hard upper bound on the rendered line. The snapshot is strictly shorter than
 * this; link crawlers truncate long descriptions themselves and we would rather
 * choose what gets dropped than let WhatsApp cut mid-word.
 */
export const SHARE_SNAPSHOT_MAX_LENGTH = 200

/**
 * Pulse_State → snapshot label. `quiet` and `dormant` share the honest
 * under-claim wording; only `active` and above read as lively.
 */
const STATE_LABEL: Record<PulseState, string> = {
  popping: 'Popping',
  buzzing: 'Buzzing',
  active: 'Active',
  quiet: 'Quiet right now',
  dormant: 'Quiet right now',
}

/** Zero presence, zero pulse: an invitation, never an implied crowd. */
const FIRST_IN_LABEL = 'Be the first in'

/** Zero presence with residual pulse: the venue was alive, it is not now. */
const QUIET_LABEL = 'Quiet right now'

/**
 * Display clamp on the live count. A venue cannot physically hold more than
 * this; the clamp keeps the rendered line bounded for any upstream value.
 */
const COUNT_DISPLAY_MAX = 99_999

/** Local 24h start time, `HH:mm`. */
const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * The Tonight fields the snapshot needs. Deliberately a structural subset of
 * the `summariseTonight` return shape (task 9.1) so that summary assigns
 * straight into this parameter without a second named type for the concept.
 */
export interface ShareSnapshotTonight {
  /** Owner-written headline for the night (validator bound: 60 chars). */
  headline: string
  /** Local start as `HH:mm` (SAST), or null when the slot is already running. */
  startsAt: string | null
}

export interface ShareSnapshotInput {
  /** Venue name. Always rendered. */
  name: string
  /** Decayed Pulse_Score from the pulse KV. */
  pulseScore: number
  /** Honest Live_Presence_Count: who is there right now. */
  liveCheckInCount: number
  /** Count of gets currently live at the venue. */
  activeRewardCount: number
  /** Tonight summary, or null when nothing is on. Null until task 9 wires it. */
  tonight: ShareSnapshotTonight | null
}

/**
 * Build the share snapshot line for a venue.
 *
 * Length discipline: when the line would reach {@link SHARE_SNAPSHOT_MAX_LENGTH}
 * the lowest-priority clauses are dropped first (gets, then Tonight). The venue
 * name and the presence label always survive; a name longer than the remaining
 * budget is truncated with an ellipsis, which cannot happen for a name inside
 * the 100-character node-name validator bound.
 */
export function buildShareSnapshot(input: ShareSnapshotInput): string {
  const name = input.name.trim()
  const live = normaliseCount(input.liveCheckInCount)
  const gets = normaliseCount(input.activeRewardCount)

  // Always present: the presence reading, plus the count when it is real.
  const lead: string[] = [presenceLabel(normaliseScore(input.pulseScore), live)]
  if (live > 0) lead.push(`${live} here now`)

  // Droppable, lowest priority last.
  const trailing: string[] = []
  const tonight = tonightClause(input.tonight)
  if (tonight) trailing.push(tonight)
  if (gets > 0) trailing.push(gets === 1 ? '1 get live' : `${gets} gets live`)

  for (let keep = trailing.length; keep >= 0; keep--) {
    const line = join([name, ...lead, ...trailing.slice(0, keep)])
    if (line.length < SHARE_SNAPSHOT_MAX_LENGTH) return line
  }

  // Only reachable for a name longer than the validator allows.
  const tail = join(lead)
  const budget = SHARE_SNAPSHOT_MAX_LENGTH - 1 - tail.length - SEPARATOR.length
  const shortName = budget > 1 ? `${name.slice(0, budget - 1)}\u2026` : ''
  return join([shortName, tail]).slice(0, SHARE_SNAPSHOT_MAX_LENGTH - 1)
}

function join(segments: readonly string[]): string {
  return segments.filter((segment) => segment.length > 0).join(SEPARATOR)
}

/**
 * The aliveness reading. Zero live presence can never read as busy, whatever
 * the pulse score says (`honest-presence.md`, under-claim never over-claim).
 */
function presenceLabel(pulseScore: number, liveCount: number): string {
  if (liveCount <= 0) return pulseScore > 0 ? QUIET_LABEL : FIRST_IN_LABEL
  return STATE_LABEL[pulseStateFromScore(pulseScore)]
}

function tonightClause(tonight: ShareSnapshotTonight | null): string | null {
  if (!tonight) return null
  const headline = tonight.headline.trim()
  if (!headline) return null
  const startsAt = tonight.startsAt?.trim() ?? ''
  // An unrecognised start value is left out rather than printed raw: a wrong
  // time on a share card is worse than no time.
  if (!LOCAL_TIME.test(startsAt)) return `${headline} tonight`
  return `${headline} tonight from ${startsAt}`
}

/** Non-negative integer for display; non-finite input reads as nothing to say. */
function normaliseCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(Math.floor(value), COUNT_DISPLAY_MAX)
}

/** Non-negative pulse score; non-finite input reads as no pulse. */
function normaliseScore(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return value
}
