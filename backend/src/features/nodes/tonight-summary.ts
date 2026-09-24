/**
 * Tonight summary for a venue (proof-of-demand R8.5, task 9.1).
 *
 * Tonight is one dated programme: what is on, when it starts, and one get. It
 * is derived here at read time from the Dated_Slot the owner published on the
 * existing Music_Schedule. There is no second declaration store (R8.2), and
 * nothing about Tonight is persisted.
 *
 * Pure: no clock, no I/O, no globals. The caller passes the instant in, as the
 * schedule resolver does, so the whole file is testable without a database.
 * The reads that fetch the schedule and the featured get live in
 * `tonight-reader.ts`; this module only decides.
 *
 * Rules this file owns:
 * - **Dated only.** Tonight is the Dated_Slot for the night the venue is in. A
 *   weekly slot is the venue's ordinary programme, not tonight's promise, so it
 *   never produces a Tonight.
 * - **By night, not by calendar date.** A slot's hours are measured from the
 *   midnight of the date it names, so one published for Friday running 21:00 to
 *   02:00 is still Tonight at 01:00 on Saturday. That is the same night Going
 *   keyed its marks to (`NIGHT_ROLLOVER_HOUR_SAST`), so the headline cannot
 *   vanish from the map while consumers still hold a mark for it.
 * - **Headline required.** A Dated_Slot with no headline is a schedule
 *   override, not a published Tonight. Without the owner's line there is
 *   nothing honest to render, so the summary is `null` and the surface shows
 *   nothing (`honest-presence.md`: say less rather than pad).
 * - **Running beats upcoming.** A slot covering the instant wins and reports
 *   `startsAt: null` (it already started). Otherwise the soonest slot later
 *   today reports its local `HH:mm` start.
 * - **Anticipation, never presence.** Nothing here reads a check-in, a pulse
 *   score or a Going count, and the summary carries no crowd claim. Ranking and
 *   aliveness are unaffected (`discovery-dna-vibe-over-convenience.md`).
 */

import { isFeaturableGet } from '@area-code/shared/lib/featuredGet'
import { genresToArchetype } from '@area-code/shared/lib/genreToArchetype'
import { minutesIntoDatedNight, resolveScheduleClock } from '@area-code/shared/lib/scheduleResolver'
import type { MusicGenre, MusicSchedule, ScheduleSlot, VenueTonight } from '@area-code/shared/types'

/**
 * The featured get's fields Tonight needs. A structural subset of both the
 * stored reward row and the portal's `Reward`, so either assigns straight in.
 */
export interface TonightFeaturedGet {
  title: string
  isActive: boolean
  /** Active_Window end for event/offer gets. */
  endsAt?: string | null
  /** Loyalty equivalent of `endsAt`. */
  expiresAt?: string | null
}

/** The Dated_Slot Tonight resolved to, plus the local clock it was resolved at. */
export interface ResolvedTonightSlot {
  slot: ScheduleSlot
  /** Local `HH:mm` start, or null when the slot is already running. */
  startsAt: string | null
  /** Minutes since the midnight of the night the slot names, at the resolving
   *  instant. Past 1439 once the night has crossed midnight. */
  minutesIntoNight: number
}

/** A dated candidate with the resolving instant projected onto its own night. */
interface TonightCandidate {
  slot: ScheduleSlot
  minutes: number
}

/**
 * Resolve the Dated_Slot that is Tonight for a schedule at a given instant:
 * the slot running now, else the soonest slot still to start, else null.
 *
 * Exported because the read layer needs the slot's `featuredRewardId` before it
 * can fetch the get that {@link summariseTonight} renders. One resolution path,
 * used by both.
 */
export function resolveTonightSlot(
  schedule: MusicSchedule | null | undefined,
  nowIso: string,
): ResolvedTonightSlot | null {
  if (!schedule) return null

  // The schedule's own timezone arithmetic, reused rather than re-derived. This
  // is the same accessor the Active_Slot resolver evaluates a schedule against,
  // so Tonight and the live archetype can never disagree about the local date.
  const clock = resolveScheduleClock(nowIso, schedule.timezone)
  if (!clock) return null

  // Each candidate is read on the axis of the night it names, which is what lets
  // a night run past midnight: at 01:00 on Saturday a Friday slot ending 02:00 is
  // at minute 1500 of Friday's night and still running, rather than gone because
  // the calendar date turned over. `minutesIntoDatedNight` returns null for a
  // night too far from this instant to reach it.
  const candidates: TonightCandidate[] = []
  for (const slot of schedule.slots ?? []) {
    if (slot.date === undefined) continue
    if (typeof slot.headline !== 'string' || slot.headline.trim() === '') continue
    const minutes = minutesIntoDatedNight(slot.date, clock)
    if (minutes === null) continue
    candidates.push({ slot, minutes })
  }

  const running = earliest(candidates.filter((c) => c.slot.startTimeMin <= c.minutes && c.minutes < c.slot.endTimeMin))
  if (running) return { slot: running.slot, startsAt: null, minutesIntoNight: running.minutes }

  const upcoming = earliest(candidates.filter((c) => c.slot.startTimeMin > c.minutes))
  if (upcoming) return { slot: upcoming.slot, startsAt: upcoming.slot.startTime, minutesIntoNight: upcoming.minutes }

  return null
}

/**
 * Build the Tonight summary for a venue, or `null` when nothing is published
 * for the current local night.
 *
 * `featuredGet` is the get the slot's `featuredRewardId` points at, already
 * fetched by the caller. Its title is omitted when the get is gone, switched
 * off or already over (R8.5): a get the owner retired must not keep advertising
 * itself on the map.
 */
export function summariseTonight(input: {
  schedule: MusicSchedule | null | undefined
  nowIso: string
  featuredGet?: TonightFeaturedGet | null
}): VenueTonight | null {
  const resolved = resolveTonightSlot(input.schedule, input.nowIso)
  if (!resolved) return null

  const { slot, startsAt, minutesIntoNight } = resolved
  const summary: VenueTonight = {
    // `resolveTonightSlot` only returns slots with a non-empty headline.
    headline: slot.headline!.trim(),
    startsAt,
    archetypeId: slotArchetypeId(slot, minutesIntoNight),
  }

  const rewardTitle = featuredGetTitle(slot, input.featuredGet, Date.parse(input.nowIso))
  if (rewardTitle !== null) {
    summary.rewardTitle = rewardTitle
    // The id travels with the title so the detail surface can open the get's own
    // claim affordance. Both are set together or neither is.
    summary.featuredRewardId = slot.featuredRewardId
  }

  return summary
}

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * The soonest candidate of a set, by minutes from the instant to the slot's
 * start, then `slotId`. Measuring from the instant rather than comparing raw
 * start minutes keeps the order right when two candidates sit on different
 * nights, which two dated slots read at the same instant can.
 *
 * The validator forbids two dated slots overlapping in absolute time (R8.1), so
 * the running set holds at most one member; the ordering makes the result
 * deterministic anyway rather than depending on stored slot order.
 */
function earliest(candidates: TonightCandidate[]): TonightCandidate | undefined {
  let best: TonightCandidate | undefined
  let bestDelta = 0
  for (const candidate of candidates) {
    const delta = candidate.slot.startTimeMin - candidate.minutes
    if (!best) {
      best = candidate
      bestDelta = delta
      continue
    }
    if (delta < bestDelta || (delta === bestDelta && candidate.slot.slotId < best.slot.slotId)) {
      best = candidate
      bestDelta = delta
    }
  }
  return best
}

/**
 * Taste cue for the night through the existing genre-to-archetype mapping. For
 * a lineup slot that is already running this is the covering DJ entry's
 * archetype (what is on now); for an upcoming slot it is the opening entry's
 * (what starts). Unknown or absent genres resolve to the catalog's uncharted
 * archetype, which is the mapping's own designed answer, so the glyph is never
 * blank.
 */
function slotArchetypeId(slot: ScheduleSlot, minutesIntoNight: number): string {
  return genresToArchetype(slotGenres(slot, minutesIntoNight)).archetype.id
}

function slotGenres(slot: ScheduleSlot, minutesIntoNight: number): MusicGenre[] {
  if (slot.mode === 'blanket') return slot.genres ?? []

  const lineup = slot.lineup ?? []
  if (lineup.length === 0) return []

  // R3.7 aligns the first entry with the slot start, so the opening entry is
  // the right answer for a slot that has not begun.
  let covering = lineup[0]!
  for (const entry of lineup) {
    if (entry.startTimeMin <= minutesIntoNight && entry.startTimeMin > covering.startTimeMin) covering = entry
  }
  return covering.genres ?? []
}

/**
 * The featured get's title, or `null` when there is nothing to advertise: no
 * get on the slot, the get could not be read, it is switched off, it has ended,
 * or its title is blank.
 */
function featuredGetTitle(
  slot: ScheduleSlot,
  featuredGet: TonightFeaturedGet | null | undefined,
  nowMs: number,
): string | null {
  if (slot.featuredRewardId === undefined) return null
  if (!featuredGet) return null
  if (!Number.isFinite(nowMs)) return null
  if (!isFeaturableGet(featuredGet, nowMs)) return null
  const title = featuredGet.title?.trim() ?? ''
  return title === '' ? null : title
}
