/**
 * Going: the pure core behind "I am going tonight" (proof-of-demand R9.1).
 *
 * Going is INTENT, never presence. Nothing in this module, and nothing that
 * reads it, may feed the live count, the pulse score, momentum, beam brightness
 * or any ranking. A person who marked going is not in the room
 * (`.kiro/steering/honest-presence.md`); the isolation is held by
 * `__tests__/going-isolation.property.test.ts` (Property 5).
 *
 * Everything here is pure: the night rule, the two row keys and the TTL. The
 * storage adapter is `going-repository.ts` and the service is
 * `going-service.ts`, so the rule that decides which night a mark belongs to is
 * testable without a database.
 *
 * POPIA: a row carries `userId` and nothing else about the person. No
 * coordinates, no device data, no venue history beyond the one mark, and it
 * expires on its own (see `goingRowTtlEpochSeconds`), so there is no sweeper and
 * no trail.
 */

import { parseCalendarDate } from '@area-code/shared/lib/schedule-validator'

import { nightFor, SAST_OFFSET_MS, type Instant } from '../../shared/time/sast.js'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Hour (SAST) at which the weekly digest pass fires on the Monday after a week
 * closes: `cron(0 4 ? * MON *)` on the report dispatcher
 * (`infra/environments/{dev,prod}/main.tf`), which is 06:00 SAST.
 */
export const GOING_DIGEST_PASS_HOUR_SAST = 6

/**
 * Hours of slack a Going row keeps AFTER that pass, so a delayed or re-run pass
 * still reads the week's rows (R9.8).
 */
export const GOING_TTL_SLACK_HOURS = 6

/**
 * Hour (SAST) on the Monday after the digest pass at which a Going row expires.
 * The slack is measured from the pass, not from the Monday 00:00 SAST week
 * boundary. Measured from the boundary, a row lapses at the very minute the pass
 * runs, and a week that recorded marks can be reported as "0 marked going before
 * doors." Never earlier (R9.1).
 */
const GOING_TTL_HOUR_SAST = GOING_DIGEST_PASS_HOUR_SAST + GOING_TTL_SLACK_HOURS

/**
 * The Going night an instant belongs to, as a SAST calendar date.
 *
 * A thin wrapper over the shared `nightFor`, kept because every Going caller
 * reads it by this name and the name says which rows it keys. The rule itself is
 * NOT Going's: `NIGHT_ROLLOVER_HOUR_SAST` in `packages/shared/lib/sast.ts` is
 * the product's one definition of a night, and Tonight resolves against the same
 * one, so a mark and the headline it was made for can never disagree about which
 * night they are talking about.
 *
 * Property 2b: every instant in `[04:00 SAST, 04:00 SAST + 24h)` maps to the
 * same date.
 */
export function goingNightFor(instant: Instant = Date.now()): string {
  return nightFor(instant)
}

/** Partition of the countable rows for one venue on one night. */
export function goingVenuePk(nodeId: string, date: string): string {
  return `GOING#${nodeId}#${date}`
}

/** Sort key of a consumer's row inside the venue partition. */
export function goingVenueSk(userId: string): string {
  return `USER#${userId}`
}

/** Partition of a consumer's own rows, which the erasure worker queries (R9.9). */
export function goingUserPk(userId: string): string {
  return `USER#${userId}`
}

/** Sort key of the mirror row: `begins_with(sk, 'GOING#')` finds them all, no scan. */
export function goingUserSk(nodeId: string, date: string): string {
  return `GOING#${date}#${nodeId}`
}

/**
 * When both rows of a Going pair expire: the Monday 12:00 SAST after the digest
 * pass covering the row's night (R9.1).
 *
 * The pass fires at Monday 06:00 SAST over the week that closed at Monday 00:00
 * SAST, so the rows must outlive the PASS, not just the week boundary; six hours
 * past it is enough for a delayed or re-run pass and short enough that a row never
 * outlives the week it describes by more than a morning. A Monday night lives
 * longest, a Sunday night shortest, and nothing needs sweeping either way.
 *
 * Throws on a date that is not a real calendar date: a row with no honest expiry
 * must never be written.
 */
export function goingRowTtlEpochSeconds(date: string): number {
  const dateSastMs = parseCalendarDate(date)
  if (dateSastMs === null) {
    throw new Error(`going: invalid night "${date}"`)
  }
  // getUTCDay on the shifted domain reads the SAST weekday: Sunday 0 .. Saturday 6.
  const daysSinceMonday = (new Date(dateSastMs).getUTCDay() + 6) % 7
  const weekStartSastMs = dateSastMs - daysSinceMonday * DAY_MS
  const expirySastMs = weekStartSastMs + 7 * DAY_MS + GOING_TTL_HOUR_SAST * 60 * 60 * 1000
  return Math.floor((expirySastMs - SAST_OFFSET_MS) / 1000)
}

/**
 * The seven Going nights of a Digest_Week, as SAST calendar dates, opening on
 * `weekStartIso` (the week's Monday).
 *
 * The digest reads Going per (venue, night) partition, so it needs the nights by
 * name. Derived from the same calendar-date arithmetic as the TTL above rather
 * than from a second date library, so the nights the digest reads are exactly the
 * nights the write path keyed (R9.8).
 *
 * Throws on a date that is not a real calendar date: a week the digest cannot
 * name is a bug, not a week with no Going.
 */
export function goingNightsForWeek(weekStartIso: string): string[] {
  const weekStartSastMs = parseCalendarDate(weekStartIso)
  if (weekStartSastMs === null) {
    throw new Error(`going: invalid week start "${weekStartIso}"`)
  }
  return Array.from({ length: 7 }, (_, i) => new Date(weekStartSastMs + i * DAY_MS).toISOString().slice(0, 10))
}
