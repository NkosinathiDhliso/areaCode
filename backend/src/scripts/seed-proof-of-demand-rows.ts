/**
 * The rows the dev seed writes, derived from `./seed-proof-of-demand-plan.ts`
 * (spec task 12.1, R13.1).
 *
 * Pure: no clock of its own, no I/O, no AWS. The caller passes the instant in and
 * gets back every row, so the numbers recorded in `docs/UAT_PROOF_OF_DEMAND.md`
 * are derivable without touching a table.
 *
 * Instants come from the real week and day arithmetic the readers use
 * (`digestWeekFor`, `startOfSastDayIso`, `goingNightFor`), so the history lands
 * inside the exact Digest_Week the Monday pass reports, today's check-ins inside
 * the exact SAST day the live panel counts, and a Going mark on the same night
 * the count reads.
 */

import type { FoundVia, OpenSource } from '@area-code/shared/constants/attribution'
import { dayOfWeekForCalendarDate } from '@area-code/shared/lib/schedule-validator'
import type { ScheduleSlot } from '@area-code/shared/types'

import { goingNightFor } from '../features/nodes/going.js'
import { digestWeekFor, type DigestWeek } from '../features/reports/digest.js'
import { sastDateString, startOfSastDayIso } from '../shared/time/sast.js'

import {
  historyUserId,
  refs,
  SEED_ACTIVITY,
  SEED_PREFIX,
  venueFor,
  type SeedVenue,
} from './seed-proof-of-demand-plan.js'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** Wall-clock SAST bounds of every seeded Tonight. Fixed, so a re-run is a no-op. */
export const TONIGHT_START = { time: '18:00', minutes: 18 * 60 } as const
export const TONIGHT_END = { time: '23:30', minutes: 23 * 60 + 30 } as const

/** SAST hour the seeded Digest_Week check-ins land on, one per weekday. */
const WEEK_CHECKIN_HOUR_SAST = 20

/** How far before the Digest_Week a returning consumer's earlier visit sits. */
const PRIOR_VISIT_DAYS_BEFORE_WEEK = 3

/**
 * How long ago a seeded Venue_Open happened. Clear of `AWAY_GATE_MIN_MINUTES` and
 * well inside `ATTRIBUTION_WINDOW_HOURS`, so the row is live and would credit
 * Found_You if that consumer checked in now.
 */
export const OPEN_MINUTES_AGO = 45

// ─── Check-ins ───────────────────────────────────────────────────────────────

/**
 * One seeded check-in. `timestamp` is the table sort key, so it must be
 * deterministic or a re-run would add a second row. `visitCount` is which visit
 * this is for that consumer at that venue, 1-based, as the owner panel shows it.
 */
export interface SeedCheckIn {
  checkInId: string
  timestamp: number
  checkedInAt: string
  userId: string
  nodeId: string
  venueKey: string
  foundVia: FoundVia
  visitCount: number
}

/**
 * The last fully closed Digest_Week: the one a weekly pass run now would report.
 *
 * `digestWeekFor` returns the week CONTAINING its instant, and an instant exactly
 * on a Monday 00:00 SAST boundary belongs to the week that just closed. Feeding it
 * this week's own opening boundary is therefore the documented way to step back
 * one week, rather than subtracting seven days and re-deriving the arithmetic.
 *
 * It matters that the seed targets this week and not the current one: the current
 * week is still running, so half its nights are in the future and a check-in
 * written there would report a visit that has not happened.
 */
export function closedDigestWeek(nowIso: string): DigestWeek {
  return digestWeekFor(digestWeekFor(nowIso).windowStartUtc)
}

/**
 * Every check-in the seed writes. Three groups:
 * - the closed Digest_Week, one 20:00 SAST check-in per history consumer, which
 *   is what the next Monday pass reports;
 * - a prior visit before that week for the `returning` consumers;
 * - today, at fixed SAST wall-clock minutes, which the live panel counts.
 */
export function buildCheckIns(nowIso: string): SeedCheckIn[] {
  const weekStartMs = Date.parse(closedDigestWeek(nowIso).windowStartUtc)
  const dayStartMs = Date.parse(startOfSastDayIso(nowIso))
  const rows: Omit<SeedCheckIn, 'visitCount'>[] = []

  for (const activity of SEED_ACTIVITY) {
    const { nodeId } = venueFor(activity.key)
    const push = (tag: string, ms: number, ref: string, foundVia: FoundVia): void => {
      rows.push({
        checkInId: `${SEED_PREFIX}-ci-${activity.key}-${tag}`,
        timestamp: ms,
        checkedInAt: new Date(ms).toISOString(),
        userId: historyUserId(activity.key, ref),
        nodeId,
        venueKey: activity.key,
        foundVia,
      })
    }

    const weekRefs = [...refs('f', activity.weekFoundVia.length), ...refs('w', activity.weekWalkIns)]
    weekRefs.forEach((ref, i) => {
      // One weekday each, spread over the seven nights, 20:00 SAST.
      const ms = weekStartMs + (i % 7) * DAY_MS + WEEK_CHECKIN_HOUR_SAST * HOUR_MS + i * MINUTE_MS
      push(`week-${ref}`, ms, ref, activity.weekFoundVia[i] ?? 'walk_in')
    })

    refs('f', activity.returning).forEach((ref, i) => {
      const priorDayMs = weekStartMs - PRIOR_VISIT_DAYS_BEFORE_WEEK * DAY_MS
      push(`prior-${ref}`, priorDayMs + WEEK_CHECKIN_HOUR_SAST * HOUR_MS + i * MINUTE_MS, ref, 'walk_in')
    })

    activity.today.forEach((entry, i) => {
      push(`today-${String(i + 1)}`, dayStartMs + entry.offsetMin * MINUTE_MS, entry.ref, entry.foundVia)
    })
  }

  // Visit number per consumer per venue, in chronological order, so the cached
  // owner-facing row carries the same `visitCount` the live path would have.
  const seen = new Map<string, number>()
  return rows
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((row) => {
      const key = `${row.userId}#${row.nodeId}`
      const visitCount = (seen.get(key) ?? 0) + 1
      seen.set(key, visitCount)
      return { ...row, visitCount }
    })
}

/** The SAST calendar date a seeded check-in is reported on (the owner's day). */
export function checkInSastDate(row: SeedCheckIn): string {
  return sastDateString(row.timestamp)
}

// ─── Tonight ─────────────────────────────────────────────────────────────────

/** The Dated_Slot published for tonight at one venue (R8.1). */
export function buildTonightSlot(venue: SeedVenue, nowIso: string): ScheduleSlot {
  const date = sastDateString(nowIso)
  const dayOfWeek = dayOfWeekForCalendarDate(date)
  if (!dayOfWeek) throw new Error(`seed rows: cannot resolve weekday for "${date}"`)
  return {
    slotId: `${SEED_PREFIX}-slot-${venue.key}-${date}`,
    dayOfWeek,
    startTime: TONIGHT_START.time,
    endTime: TONIGHT_END.time,
    startTimeMin: TONIGHT_START.minutes,
    endTimeMin: TONIGHT_END.minutes,
    mode: 'blanket',
    genres: venue.genres,
    date,
    headline: venue.headline,
    featuredRewardId: venue.rewardId,
  }
}

// ─── Going, Venue_Open, presence ─────────────────────────────────────────────

/** One Going mark. `date` is the Going night, from the 04:00 SAST rollover rule. */
export interface SeedGoingMark {
  userId: string
  nodeId: string
  date: string
}

/**
 * Tonight's Going marks, sized to straddle `GOING_PUBLIC_THRESHOLD`: one venue
 * above it (count visible on the card), one below (nothing on the card), one with
 * none at all ("Be the first to mark going" on the detail block).
 *
 * The marks belong to history consumers, never to the twelve testers: a tester
 * must arrive with the control unmarked so the rehearsal can toggle it.
 */
export function buildGoingMarks(nowIso: string): SeedGoingMark[] {
  const date = goingNightFor(nowIso)
  return SEED_ACTIVITY.flatMap((activity) =>
    activity.goingRefs.map((ref) => ({
      userId: historyUserId(activity.key, ref),
      nodeId: venueFor(activity.key).nodeId,
      date,
    })),
  )
}

/** One unconsumed Venue_Open. `away` is always true: the look happened far out. */
export interface SeedVenueOpen {
  userId: string
  nodeId: string
  source: OpenSource
  openedAt: string
  away: boolean
}

/**
 * The live Venue_Open rows the seed leaves in place.
 *
 * A check-in consumes its own row, so the seeded history leaves none behind.
 * These are the other half of the pipeline: looks that have not become visits
 * yet. They make the row shape, the TTL and the Away_Gate inspectable during the
 * rehearsal, and none belongs to a tester, whose open must come from their own
 * app or the credit would not be earned.
 */
export function buildVenueOpens(nowIso: string): SeedVenueOpen[] {
  const openedAt = new Date(Date.parse(nowIso) - OPEN_MINUTES_AGO * MINUTE_MS).toISOString()
  return SEED_ACTIVITY.flatMap((activity) =>
    activity.openRefs.map(({ ref, source }) => ({
      userId: historyUserId(activity.key, ref),
      nodeId: venueFor(activity.key).nodeId,
      source,
      openedAt,
      away: true,
    })),
  )
}

/** Who the seed records as still in the room, per venue. Backs the live count. */
export function buildPresence(): Array<{ userId: string; nodeId: string }> {
  return SEED_ACTIVITY.flatMap((activity) =>
    activity.presentRefs.map((ref) => ({
      userId: historyUserId(activity.key, ref),
      nodeId: venueFor(activity.key).nodeId,
    })),
  )
}
