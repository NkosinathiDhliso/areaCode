// The Receipt: the pure logic core behind every owner-facing "found you" number.
//
// Feature: proof-of-demand (R4.1, R4.2, R4.5, R4.8)
//
// One computation, five surfaces: the live panel, the Monday digest, the trial
// and renewal emails, the Plans panel and the boost scoreboard all read their
// Found_You and Walk_In counts from here. That is what makes the conservation
// rule (`foundYouVisitors + walkInVisitors === uniqueVisitors`) structural
// rather than four coincidences that drift apart.
//
// I/O-free on purpose, exactly like `computeDigest`: the caller loads the
// check-ins for the business's active nodes over the window (the existing
// NodeIndex reads) and hands them here, so the split arithmetic is property
// testable without DynamoDB.

import { OPEN_SOURCES, RECEIPT_MEASURED_FROM_ISO, type OpenSource } from '@area-code/shared/constants/attribution'

import type { RawCheckIn } from './anonymize.js'
import { SUPPRESSION_FLOOR } from './suppression.js'

/**
 * The half-open window `[windowStartUtc, windowEndUtc)` the Receipt covers, as
 * ISO 8601 UTC instants. A `DigestWeek` satisfies this shape, so the digest
 * passes its own week straight through.
 */
export interface ReceiptWindow {
  windowStartUtc: string
  windowEndUtc: string
}

/**
 * The only three facts the split needs from a check-in. A `RawCheckIn`
 * satisfies it, so the digest passes its rows straight through, and a caller
 * that holds plain check-in rows (the live panel read) passes those without
 * inventing the report-only fields it does not have.
 */
export type ReceiptCheckIn = Pick<RawCheckIn, 'userId' | 'checkedInAt' | 'foundVia'>

/** Distinct-consumer counts per Open_Source. `walk_in` is never a source. */
export type ReceiptBySource = Record<OpenSource, number>

/** Receipt values subject to the Suppression_Floor (R4.8). */
export type ReceiptMetricName =
  | 'uniqueVisitors'
  | 'foundYouVisitors'
  | 'walkInVisitors'
  | 'foundYouFirstTimers'
  | 'bySource'

/** Every suppressible Receipt value, in render order. */
export const RECEIPT_METRIC_NAMES: readonly ReceiptMetricName[] = [
  'uniqueVisitors',
  'foundYouVisitors',
  'walkInVisitors',
  'foundYouFirstTimers',
  'bySource',
] as const

/**
 * The pair an owner reads on every surface, in distinct consumers.
 *
 * - `foundYouVisitors`: consumers with at least one Found_You check-in in the
 *   window ("found you on Area Code and checked in").
 * - `walkInVisitors`: consumers in the window with Walk_In check-ins only
 *   ("already in the room").
 * - `uniqueVisitors`: distinct consumers in the window. Always the sum of the
 *   two above, so no consumer is counted twice and none is dropped.
 * - `foundYouFirstTimers`: Found_You consumers whose first-ever check-in at the
 *   business falls inside the window. `0` when the caller supplied no
 *   earliest-check-in map, in which case the field is listed in `suppressed`
 *   because unmeasured is not the same fact as zero.
 * - `bySource`: Found_You consumers counted once each, under the source of
 *   their earliest Found_You check-in in the window. Sums to
 *   `foundYouVisitors`.
 * - `suppressed`: values whose sample is below the Suppression_Floor. The
 *   counts still render; derived percentages and comparisons must not.
 * - `measuredFrom`: the instant `foundVia` started being stamped, when the
 *   window opens before it. Non-null means part of the window predates the
 *   measurement, so a partial window must never be read as zero demand (R4.8).
 */
export interface Receipt {
  foundYouVisitors: number
  walkInVisitors: number
  uniqueVisitors: number
  foundYouFirstTimers: number
  bySource: ReceiptBySource
  suppressed: ReceiptMetricName[]
  measuredFrom: string | null
}

const MEASURED_FROM_MS = new Date(RECEIPT_MEASURED_FROM_ISO).getTime()

/** A stored `foundVia` only credits a source if it is on the shared enum. */
function isOpenSource(value: unknown): value is OpenSource {
  return typeof value === 'string' && (OPEN_SOURCES as readonly string[]).includes(value)
}

/**
 * Deterministic order over sources, used only to break a tie between two
 * Found_You check-ins by the same consumer at the same instant, so `bySource`
 * never depends on the order the rows came back from the read.
 */
function sourceRank(source: OpenSource): number {
  return OPEN_SOURCES.indexOf(source)
}

/** An unreadable timestamp sorts last, so a readable sibling wins the tie. */
function instantMs(iso: string): number {
  const ms = new Date(iso).getTime()
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms
}

function zeroedBySource(): ReceiptBySource {
  const bySource = {} as ReceiptBySource
  for (const source of OPEN_SOURCES) {
    bySource[source] = 0
  }
  return bySource
}

/**
 * Compute the Receipt for one business over one window.
 *
 * Grouping is per consumer, not per check-in: a consumer with any Found_You
 * check-in in the window is a Found_You visitor, everyone else in the window is
 * a Walk_In visitor. That is what keeps the two counts exhaustive and disjoint
 * (R4.2) and what stops a repeat visitor inflating either side.
 *
 * Check-ins written before the Phase 1 deploy carry no `foundVia` and read as
 * Walk_In, which is the honest direction: a history the platform never measured
 * is never sold as demand it created (R4.1).
 *
 * @param checkIns Check-ins at the business's active nodes inside the window,
 *   already scoped by the caller (same contract as `computeDigest`).
 * @param window The window the check-ins were read for.
 * @param earliestCheckInByUser ISO timestamp of each consumer's earliest
 *   check-in at any of the business's nodes, over all time. Omit it when the
 *   caller has not done that read; `foundYouFirstTimers` is then reported as
 *   unmeasured via `suppressed`.
 */
export function computeReceipt(
  checkIns: readonly ReceiptCheckIn[],
  window: ReceiptWindow,
  earliestCheckInByUser?: Record<string, string>,
): Receipt {
  const windowStartMs = new Date(window.windowStartUtc).getTime()
  const windowEndMs = new Date(window.windowEndUtc).getTime()
  if (Number.isNaN(windowStartMs) || Number.isNaN(windowEndMs)) {
    throw new Error(`computeReceipt: invalid window "${window.windowStartUtc}".."${window.windowEndUtc}"`)
  }

  // Earliest Found_You check-in per consumer: decides both the Found_You set
  // and the single source that consumer is counted under.
  const firstFoundYou = new Map<string, { at: number; source: OpenSource }>()
  const visitors = new Set<string>()

  for (const checkIn of checkIns) {
    visitors.add(checkIn.userId)

    const source = checkIn.foundVia
    if (!isOpenSource(source)) continue

    const at = instantMs(checkIn.checkedInAt)
    const current = firstFoundYou.get(checkIn.userId)
    const wins =
      current === undefined || at < current.at || (at === current.at && sourceRank(source) < sourceRank(current.source))
    if (wins) {
      firstFoundYou.set(checkIn.userId, { at, source })
    }
  }

  const uniqueVisitors = visitors.size
  const foundYouVisitors = firstFoundYou.size
  const walkInVisitors = uniqueVisitors - foundYouVisitors

  const bySource = zeroedBySource()
  for (const { source } of firstFoundYou.values()) {
    bySource[source] += 1
  }

  // First-timers are counted only over Found_You consumers: the "had never been
  // in before" clause sits on the Found_You sentence, never on the total.
  let foundYouFirstTimers = 0
  if (earliestCheckInByUser !== undefined) {
    for (const userId of firstFoundYou.keys()) {
      const earliest = earliestCheckInByUser[userId]
      // No recorded earlier visit, or an earliest visit inside the window, both
      // mean this is the consumer's first recorded check-in at this business.
      if (earliest === undefined || new Date(earliest).getTime() >= windowStartMs) {
        foundYouFirstTimers++
      }
    }
  }

  const sampleFor = (name: ReceiptMetricName): number => {
    switch (name) {
      case 'uniqueVisitors':
        return uniqueVisitors
      case 'foundYouVisitors':
        return foundYouVisitors
      case 'walkInVisitors':
        return walkInVisitors
      case 'foundYouFirstTimers':
        return foundYouFirstTimers
      // The per-source clause divides by the Found_You count, so that is the
      // sample its percentages have to clear.
      case 'bySource':
        return foundYouVisitors
    }
  }

  const firstTimersUnmeasured = earliestCheckInByUser === undefined
  const suppressed = RECEIPT_METRIC_NAMES.filter(
    (name) => sampleFor(name) < SUPPRESSION_FLOOR || (name === 'foundYouFirstTimers' && firstTimersUnmeasured),
  )

  return {
    foundYouVisitors,
    walkInVisitors,
    uniqueVisitors,
    foundYouFirstTimers,
    bySource,
    suppressed,
    measuredFrom: windowStartMs < MEASURED_FROM_MS ? RECEIPT_MEASURED_FROM_ISO : null,
  }
}
