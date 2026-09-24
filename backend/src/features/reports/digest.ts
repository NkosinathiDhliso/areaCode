// Weekly Attribution Digest: pure logic core.
//
// Feature: weekly-attribution-digest
//
// Digest_Week arithmetic. South Africa observes no daylight saving, so the
// Southern African Standard Time (SAST) offset is a fixed UTC+2 year-round.
// That lets us treat a week boundary as a fixed offset instead of a
// timezone-library lookup, and keeps `digestWeekFor` framework-free and
// property-testable (callers pass the reference instant).

import { SAST_OFFSET_MS } from '../../shared/time/sast.js'

import { analyzePeakHours } from './analyzers/peak-hours.js'
import { anonymizeCheckIns, type RawCheckIn } from './anonymize.js'
import { buildReceiptCopy } from './receipt-copy.js'
import {
  computeReceipt,
  RECEIPT_METRIC_NAMES,
  type Receipt,
  type ReceiptBySource,
  type ReceiptMetricName,
} from './receipt.js'
import { SUPPRESSION_FLOOR } from './suppression.js'
import { FULL_ACCESS_TIERS } from './tier-gating.js'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS

/**
 * The Digest_Week that a given instant falls in.
 *
 * `weekStartIso` is the ISO calendar date (`yyyy-mm-dd`) of the opening Monday
 * in SAST. `windowStartUtc` / `windowEndUtc` are the ISO 8601 UTC timestamps
 * bounding the half-open window `[windowStartUtc, windowEndUtc)`.
 */
export interface DigestWeek {
  weekStartIso: string
  windowStartUtc: string
  windowEndUtc: string
}

/**
 * The Digest_Week for an instant: the seven-day window opening at the most
 * recent Monday 00:00 SAST strictly before `nowIso`, closing at the following
 * Monday 00:00 SAST.
 *
 * "Strictly before" means an instant landing exactly on a Monday 00:00 SAST
 * boundary belongs to the week that just closed, not the one just opening, so a
 * pipeline pass that fires on the boundary computes the completed week. The
 * result is constant for every instant inside the same SAST week, which is what
 * makes the derived Digest_Row idempotency key stable across a delayed or
 * re-run weekly pass.
 */
export function digestWeekFor(nowIso: string): DigestWeek {
  const nowMs = new Date(nowIso).getTime()
  if (Number.isNaN(nowMs)) {
    throw new Error(`digestWeekFor: invalid instant "${nowIso}"`)
  }

  // Shift into the SAST wall-clock domain so UTC field accessors read SAST.
  const sastMs = nowMs + SAST_OFFSET_MS
  const sast = new Date(sastMs)

  // Monday = 0 ... Sunday = 6 (getUTCDay is Sunday = 0 ... Saturday = 6).
  const daysSinceMonday = (sast.getUTCDay() + 6) % 7

  // Midnight of the current SAST calendar day, in the shifted domain.
  const dayStartSastMs = Date.UTC(sast.getUTCFullYear(), sast.getUTCMonth(), sast.getUTCDate())

  // Monday 00:00 SAST of the current week (always at or before now).
  let weekStartSastMs = dayStartSastMs - daysSinceMonday * DAY_MS

  // On an exact Monday 00:00 SAST boundary the current-week Monday equals now;
  // "strictly before" pushes us back to the week that just closed.
  if (weekStartSastMs >= sastMs) {
    weekStartSastMs -= WEEK_MS
  }

  const windowStartUtcMs = weekStartSastMs - SAST_OFFSET_MS
  const windowEndUtcMs = windowStartUtcMs + WEEK_MS

  return {
    weekStartIso: new Date(weekStartSastMs).toISOString().slice(0, 10),
    windowStartUtc: new Date(windowStartUtcMs).toISOString(),
    windowEndUtc: new Date(windowEndUtcMs).toISOString(),
  }
}

// ============================================================================
// Digest metrics data shape
// ============================================================================
//
// Attribution_Metrics computed for one business over one Digest_Week, plus the
// week-over-week deltas and the suppression list. This is the input the copy
// builder and the persisted Digest_Row both draw from (task 3.1 wraps these in
// the zod `digestRowSchema`; this file owns the TypeScript shape so the pure
// logic and the schema never drift).

/**
 * Numeric Attribution_Metrics that carry a week-over-week delta and are
 * suppressed by their own count.
 */
export type DigestMetricName =
  | 'visits'
  | 'uniqueVisitors'
  | 'firstTimeVisitors'
  | 'returningVisitors'
  | 'redemptions'
  | 'firstGetIssued'
  | 'firstGetConversions'
  | 'shares'

/**
 * The Attribution_Metrics for a Digest_Week. Numeric metrics are non-negative
 * integers. `busiestDay` / `busiestHour` are the peak-hours binning outputs and
 * are null when there is no check-in to bin.
 */
export interface DigestMetrics {
  visits: number
  uniqueVisitors: number
  firstTimeVisitors: number
  returningVisitors: number
  redemptions: number
  firstGetIssued: number
  firstGetConversions: number
  /**
   * Times a consumer shared this business's venues from Area Code during the
   * Digest_Week (share-button completions, recorded per node). A reach signal
   * the owner can see; never a ranking input (discovery-dna rule).
   */
  shares: number
  busiestDay: string | null
  busiestHour: number | null

  // ── Attribution_Metrics: the Receipt for the Digest_Week (R4.5) ────────────
  //
  // Every field below is optional because a Digest_Row written before the
  // Receipt existed has none of them. Absent means the week was never measured,
  // which is not the same fact as zero, so the copy builder stays silent on
  // Found_You for those weeks instead of claiming nobody found the venue.

  /** Distinct consumers who found the venue on Area Code and checked in. */
  foundYouVisitors?: number
  /** Distinct consumers in the week with Walk_In check-ins only. */
  walkInVisitors?: number
  /** Found_You consumers whose first-ever check-in here falls in the week. */
  foundYouFirstTimers?: number
  /** Found_You consumers counted once each, under their earliest source. */
  bySource?: ReceiptBySource
  /** Set when the week opens before `foundVia` was stamped (partial measurement). */
  measuredFrom?: string | null

  // ── Going: the pipeline before doors (R9.8) ────────────────────────────────
  //
  // Optional for the same reason as the Receipt block: a Digest_Row written
  // before Going existed never measured it, and unmeasured is not zero. INTENT
  // only. These two numbers are never an input to pulse, aliveness, momentum or
  // any ranking (R9.4), and the copy that renders them says "marked going",
  // never that anybody arrived.

  /** Marks recorded at the business's venues across the week's nights. */
  goingMarks?: number
  /**
   * How many of those marks belong to a consumer who also checked in at that
   * venue on that night. A measured overlap, not a conversion claim: nothing
   * here says the mark caused the visit.
   */
  goingCheckedIn?: number
}

/**
 * Everything that can appear in the suppression list: the numeric metrics above
 * plus the Receipt values the digest now carries. Receipt values are kept out of
 * `DigestMetricName` on purpose — they get no week-over-week delta (the Receipt
 * is a distinct-consumer split, not a running count), so `DigestDeltas` and the
 * persisted `deltas` map stay exactly the eight metrics they always were.
 */
export type DigestSuppressibleName = DigestMetricName | ReceiptMetricName | DigestGoingMetricName

/**
 * The Going value the floor applies to. Only the mark count: the checked-in
 * figure is read against it, so suppressing the denominator withholds the
 * comparison, and there is nothing else to suppress. Kept out of
 * `DigestMetricName` for the same reason as the Receipt values: Going carries no
 * week-over-week delta, so `DigestDeltas` stays the eight metrics it always was.
 */
export type DigestGoingMetricName = 'goingMarks'

/** Signed week-over-week deltas, keyed by metric. Absent when no prior week. */
export type DigestDeltas = Partial<Record<DigestMetricName, number>>

/**
 * The digest data the copy builder renders: the metrics, optional deltas, and
 * the list of metrics whose underlying sample is below the Suppression_Floor
 * (their absolute count still renders; derived percentages and comparisons do
 * not).
 */
export interface DigestData {
  metrics: DigestMetrics
  deltas?: DigestDeltas
  suppressed: DigestSuppressibleName[]
}

// ============================================================================
// Honest_Framing copy builder
// ============================================================================
//
// One source of truth for the copy strings rendered by BOTH the Digest_Email
// and the dashboard DigestCard. Honest_Framing is enforced here, in code, not
// left to reviewer vigilance: measurement verbs only, no causal claims,
// suppression-aware rendering, an honest zero-visits branch, and a tier-aware
// close.

/**
 * Causal verbs that imply Area Code originated foot traffic it only measured.
 * Banned from every digest sentence (R2.1). Exported so the honest-copy
 * property test asserts against the same single list (no drift).
 */
export const BANNED_CAUSAL_VERBS = ['brought', 'drove', 'generated', 'boosted'] as const

/**
 * The single constructive, non-blaming next step shown on a zero-visits week
 * (R2.3). Exactly one next step, no numbers.
 */
export const ZERO_VISITS_NEXT_STEP =
  'Ask your staff to mention Area Code at the till, or put the First-Get poster up where customers order.'

const plural = (n: number, singular: string): string => (n === 1 ? singular : `${singular}s`)

/**
 * The Going sentence for a Digest_Week (R9.8), or null when the week carries no
 * Going measurement at all.
 *
 * Null, not a zero line: a Digest_Row written before Going existed never counted
 * it, and saying "0 marked going" for a week nobody measured would be a claim we
 * cannot stand behind (`honest-presence.md`).
 *
 * Below the Suppression_Floor the absolute count still renders and the
 * checked-in comparison does not, which is the same rule every other derived
 * figure in this builder follows: too small a sample cannot carry a ratio.
 */
function buildGoingLine(metrics: DigestMetrics, suppressed: boolean): string | null {
  const { goingMarks, goingCheckedIn } = metrics
  if (goingMarks === undefined) return null

  const marked = `${goingMarks} marked going before doors`
  if (suppressed || goingCheckedIn === undefined) return `${marked}.`
  return `${marked}, ${goingCheckedIn} of them checked in.`
}

/** A signed comparison clause, e.g. ", up 3 from the previous week". */
function deltaClause(delta: number | undefined): string {
  if (delta === undefined) return ''
  if (delta > 0) return `, up ${delta} from the previous week`
  if (delta < 0) return `, down ${Math.abs(delta)} from the previous week`
  return ', unchanged from the previous week'
}

/**
 * Close shown to growth and pro (R5.3): a link to the full weekly report
 * surface they already own. No upgrade pointer (they are not upgrading).
 */
export const FULL_REPORT_CLOSE = 'Your full weekly report has the complete breakdown. Open it from your dashboard.'

/**
 * Close shown to starter and any lapsed-to-starter tier (R5.2): one concrete
 * capability the full report adds (peak-hours analysis) plus an upgrade pointer,
 * in Honest_Framing — no invented numbers from the locked report.
 */
export const STARTER_UPGRADE_CLOSE = 'The full weekly report adds peak-hours analysis. Upgrade to unlock it.'

/**
 * The tier-aware closing line (R5.2, R5.3). Growth and pro are pointed at the
 * full report they own; every other resolved tier (starter and lapsed) gets one
 * named locked capability plus an upgrade pointer, with no invented numbers.
 *
 * `tier` is the already-resolved effective tier (see `getEffectiveTier`, the
 * Tier_Resolver), so a lapsed paid business arrives here as 'starter' and gets
 * the starter close.
 */
function tierClose(tier: string): string {
  return FULL_ACCESS_TIERS.has(tier) ? FULL_REPORT_CLOSE : STARTER_UPGRADE_CLOSE
}

/**
 * Rebuild the Receipt from the persisted Attribution_Metrics so the digest can
 * render it through `buildReceiptCopy` — the one home for every owner-facing
 * "found you" sentence (R4.6). The digest never writes a second wording of the
 * same fact; the email, the Plans panel and the Monday card read identical words.
 *
 * Returns null for a Digest_Row written before the Receipt existed: those weeks
 * carry no measurement, and unmeasured is not zero, so the digest says nothing
 * about Found_You rather than reporting a zero it cannot stand behind (R4.7).
 */
function receiptFromMetrics(metrics: DigestMetrics, suppressed: DigestSuppressibleName[]): Receipt | null {
  const { foundYouVisitors, walkInVisitors, foundYouFirstTimers, bySource } = metrics
  if (
    foundYouVisitors === undefined ||
    walkInVisitors === undefined ||
    foundYouFirstTimers === undefined ||
    bySource === undefined
  ) {
    return null
  }

  return {
    foundYouVisitors,
    walkInVisitors,
    uniqueVisitors: metrics.uniqueVisitors,
    foundYouFirstTimers,
    bySource,
    // The digest list is the union of its own floor pass and the Receipt's;
    // narrowing it back hands `buildReceiptCopy` exactly what `computeReceipt`
    // produced, so a clause suppressed on one surface is suppressed on all.
    suppressed: RECEIPT_METRIC_NAMES.filter((name) => suppressed.includes(name)),
    // No annotation stored means the whole window was measured.
    measuredFrom: metrics.measuredFrom ?? null,
  }
}

/**
 * The ordered digest sentences shared by the email and the dashboard card.
 *
 * Honest_Framing (R2.1, R2.2): measurement verbs only (recorded, confirmed,
 * captured, issued); First-Get conversions are described as captured, visits as
 * recorded. Suppression-aware (R1.5): a metric in `suppressed` renders its
 * absolute count but no derived percentage or week-over-week comparison.
 * Zero-visits (R2.3): stated plainly with exactly one next step and no numbers.
 * Tier-aware close (R5.2, R5.3). Nothing the platform did not record is
 * rendered (R2.4): no revenue, no projected traffic.
 *
 * The Monday headline is the Found_You sentence (proof-of-demand R4.5): the
 * owner's first line is how many people found the venue on Area Code and checked
 * in, not the visit total. Those sentences come from `buildReceiptCopy`, shared
 * with the trial and renewal emails and the Plans panel.
 */
export function buildDigestCopy(digest: DigestData, tier: string): string[] {
  const { metrics, deltas = {}, suppressed } = digest
  const isSuppressed = (m: DigestSuppressibleName): boolean => suppressed.includes(m)
  const deltaFor = (m: DigestMetricName): string => (isSuppressed(m) ? '' : deltaClause(deltas[m]))

  // Zero-visits branch: honest statement, exactly one next step, no numbers.
  if (metrics.visits === 0) {
    return ['No visits were recorded through Area Code this week.', ZERO_VISITS_NEXT_STEP, tierClose(tier)]
  }

  const lines: string[] = []

  // The Receipt leads: Found_You, then Walk_In, then the clauses that clear the
  // floor. A week with visits but no Found_You takes the Receipt's quiet branch,
  // which closes on one next step instead of a padded number (R4.7). No
  // Onboarding_Checklist is read here, so that step is share and Tonight.
  const receipt = receiptFromMetrics(metrics, suppressed)
  if (receipt !== null) {
    lines.push(...buildReceiptCopy(receipt, null, 'week').lines)
  }

  lines.push(
    `${metrics.visits} ${plural(metrics.visits, 'visit')} recorded through Area Code this week` +
      `${deltaFor('visits')}.`,
  )

  lines.push(
    `${metrics.uniqueVisitors} unique ${plural(metrics.uniqueVisitors, 'visitor')} recorded` +
      `${deltaFor('uniqueVisitors')}.`,
  )

  // First-timer share is a derived percentage: only render it when the metric
  // is not suppressed and there is a denominator to divide by.
  let firstTimers = `${metrics.firstTimeVisitors} first-time ${plural(metrics.firstTimeVisitors, 'visitor')} recorded`
  if (!isSuppressed('firstTimeVisitors') && metrics.uniqueVisitors > 0) {
    const share = Math.round((metrics.firstTimeVisitors / metrics.uniqueVisitors) * 100)
    firstTimers += ` (${share}% of unique visitors)`
  }
  lines.push(`${firstTimers}.`)

  lines.push(`${metrics.returningVisitors} returning ${plural(metrics.returningVisitors, 'visitor')} recorded.`)

  lines.push(`${metrics.redemptions} reward ${plural(metrics.redemptions, 'redemption')} confirmed.`)

  lines.push(
    `${metrics.firstGetIssued} First-Get ${plural(metrics.firstGetIssued, 'code')} issued, ` +
      `${metrics.firstGetConversions} converted into signups captured by Area Code.`,
  )

  lines.push(
    `${metrics.shares} ${plural(metrics.shares, 'share')} of your venue recorded through Area Code this week` +
      `${deltaFor('shares')}.`,
  )

  // Going, framed as intent (R9.8). "Marked going" is the only verb allowed
  // here: a mark is a person saying they mean to be out, not an arrival, and the
  // second clause is a measured overlap with that night's check-ins, never a
  // conversion the platform caused (`honest-presence.md`, R9.3, R10.3).
  const goingLine = buildGoingLine(metrics, isSuppressed('goingMarks'))
  if (goingLine !== null) lines.push(goingLine)

  if (metrics.busiestDay !== null && metrics.busiestHour !== null) {
    const hour = String(metrics.busiestHour).padStart(2, '0')
    lines.push(`Busiest recorded window was ${metrics.busiestDay} around ${hour}:00.`)
  }

  lines.push(tierClose(tier))

  return lines
}

// ============================================================================
// Metric computation (Attribution_Metrics for a Digest_Week)
// ============================================================================
//
// Pure computation: given the raw events already read for the business's active
// nodes over one Digest_Week, produce the DigestData (metrics + deltas +
// suppression list). Keeping this I/O-free is deliberate — the repository reads
// (task 3.1) and the generator wiring (task 4.2) load the events and the prior
// week's metrics, then hand them here. That keeps the metric math property
// testable (Property 2: metric conservation) and free of DynamoDB and cycles.

/** Every numeric Attribution_Metric, in render order. Single source for the
 * delta and suppression passes so a new metric cannot be silently skipped. */
export const DIGEST_METRIC_NAMES: readonly DigestMetricName[] = [
  'visits',
  'uniqueVisitors',
  'firstTimeVisitors',
  'returningVisitors',
  'redemptions',
  'firstGetIssued',
  'firstGetConversions',
  'shares',
] as const

/**
 * The events read for one business over one Digest_Week, already scoped to the
 * business's active nodes and the week window by the caller.
 */
export interface DigestSources {
  /** Check-ins at the business's active nodes within the Digest_Week window. */
  windowCheckIns: RawCheckIn[]
  /**
   * The ISO 8601 timestamp of each visitor's earliest recorded check-in at ANY
   * of the business's nodes, over all time, keyed by userId. A window visitor
   * is a first-timer when this earliest check-in falls inside the Digest_Week
   * (R1.3). A visitor present in the window but absent from this map has no
   * provable earlier visit and is counted as a first-timer.
   */
  earliestCheckInByUser: Record<string, string>
  /** Confirmed redemptions (redeemedAt within the window) at the business's nodes. */
  redemptions: number
  /** First-Get tokens issued at the business's nodes with issuedAt in the window (R1.4). */
  firstGetIssued: number
  /**
   * First-Get tokens redeemed into a signup with redeemedAt in the window,
   * regardless of when the token was issued (R1.4).
   */
  firstGetConversions: number
  /**
   * Total share-button completions recorded across the business's nodes during
   * the Digest_Week. Summed by the caller from the per-node weekly share
   * counters. A recorded reach fact, never a causal or ranking signal.
   */
  shares: number
  /**
   * Going marks recorded across the week's nights, and how many of them belong
   * to a consumer who also checked in at that venue on that night (R9.8). The
   * caller reads the week's Going rows and joins them to the window check-ins in
   * memory; aggregate counts only, no identifiers reach here.
   *
   * Omitted when Going was not read for this week, which the copy builder renders
   * as silence rather than as zero.
   */
  going?: { marks: number; checkedIn: number }
}

/**
 * The busiest single hour (0-23 SAST) by check-in count, reusing the peak-hours
 * analyzer's hourly binning as the one source of truth. Null when there is no
 * check-in to bin. Ties resolve to the earliest hour.
 */
function busiestHourFrom(hourlyDistribution: Record<number, number>, visits: number): number | null {
  if (visits === 0) return null
  let bestHour: number | null = null
  let bestCount = 0
  for (let hour = 0; hour < 24; hour++) {
    const count = hourlyDistribution[hour] ?? 0
    if (count > bestCount) {
      bestCount = count
      bestHour = hour
    }
  }
  return bestHour
}

/**
 * Compute the Attribution_Metrics, week-over-week deltas, and suppression list
 * for one business over one Digest_Week.
 *
 * - visits: from the window check-ins (R1.2). uniqueVisitors comes from the
 *   Receipt computed here over the same check-ins.
 * - foundYouVisitors / walkInVisitors / foundYouFirstTimers / bySource /
 *   measuredFrom: the Receipt for the Digest_Week (proof-of-demand R4.5), from
 *   `computeReceipt` — one computation behind every owner-facing split.
 * - firstTimeVisitors: window visitors whose earliest recorded check-in at any
 *   of the business's nodes falls inside the window (R1.3). By construction this
 *   is counted only over the window's unique visitors, so
 *   firstTimeVisitors + returningVisitors === uniqueVisitors and
 *   uniqueVisitors <= visits always hold (Property 2).
 * - redemptions, firstGetIssued, firstGetConversions: passed through from the
 *   rewards read and the guest-claim rows (R1.2, R1.4).
 * - busiestDay / busiestHour: reuse the peak-hours binning helper.
 * - deltas: signed differences against the PRIOR Digest_Row's stored metrics
 *   only, never recomputed from raw data. Absent when there is no prior week
 *   (R1.2).
 * - suppressed: every metric whose absolute count is below the Suppression_Floor
 *   (R1.5), plus the Receipt values below it (R4.8); the copy builder shows
 *   their counts but withholds derived percentages, comparisons and the clauses
 *   that divide them.
 *
 * The `salt` is the reports anonymization salt, used only to bin check-ins for
 * the busiest day/hour via the shared anonymizer; no identifier reaches the
 * returned DigestData.
 */
export function computeDigest(
  week: DigestWeek,
  sources: DigestSources,
  salt: string,
  priorMetrics?: DigestMetrics | null,
): DigestData {
  const { windowCheckIns, earliestCheckInByUser, redemptions, firstGetIssued, firstGetConversions, shares, going } =
    sources

  const windowStartMs = new Date(week.windowStartUtc).getTime()

  const visits = windowCheckIns.length

  // The Receipt is computed here, from the same check-ins and the same
  // earliest-check-in map, so the split and the totals cannot disagree: the
  // digest takes `uniqueVisitors` from it rather than counting a second time,
  // which makes `foundYouVisitors + walkInVisitors === uniqueVisitors`
  // structural on this surface too (R4.2).
  const receipt = computeReceipt(windowCheckIns, week, earliestCheckInByUser)

  const uniqueUserIds = new Set(windowCheckIns.map((checkIn) => checkIn.userId))
  const uniqueVisitors = receipt.uniqueVisitors

  let firstTimeVisitors = 0
  for (const userId of uniqueUserIds) {
    const earliest = earliestCheckInByUser[userId]
    // No recorded earlier visit, or an earliest visit that lands inside the
    // window, both mean this is the visitor's first recorded check-in here.
    if (earliest === undefined || new Date(earliest).getTime() >= windowStartMs) {
      firstTimeVisitors++
    }
  }
  const returningVisitors = uniqueVisitors - firstTimeVisitors

  // Busiest day and hour reuse the peak-hours analyzer's binning (one home per
  // concept) rather than a forked week-window variant.
  const peakHours = analyzePeakHours(anonymizeCheckIns(windowCheckIns, salt))

  const metrics: DigestMetrics = {
    visits,
    uniqueVisitors,
    firstTimeVisitors,
    returningVisitors,
    redemptions,
    firstGetIssued,
    firstGetConversions,
    shares,
    busiestDay: peakHours.peakDay,
    busiestHour: busiestHourFrom(peakHours.hourlyDistribution, visits),
    foundYouVisitors: receipt.foundYouVisitors,
    walkInVisitors: receipt.walkInVisitors,
    foundYouFirstTimers: receipt.foundYouFirstTimers,
    bySource: receipt.bySource,
    measuredFrom: receipt.measuredFrom,
    // Going travels only when it was read. Absent means unmeasured, which the
    // copy builder renders as silence (R9.8).
    ...(going ? { goingMarks: going.marks, goingCheckedIn: going.checkedIn } : {}),
  }

  const suppressed: DigestSuppressibleName[] = [
    ...DIGEST_METRIC_NAMES.filter((name) => metrics[name] < SUPPRESSION_FLOOR),
    // The Receipt applied the same floor to its own values. `uniqueVisitors` is
    // shared with the pass above and identical there, so it is taken once.
    ...receipt.suppressed.filter((name) => name !== 'uniqueVisitors'),
    // Too few marks to carry the checked-in comparison; the count still renders.
    ...(going !== undefined && going.marks < SUPPRESSION_FLOOR ? (['goingMarks'] as const) : []),
  ]

  const data: DigestData = { metrics, suppressed }

  // Deltas come from the prior Digest_Row's stored metrics only; absent when no
  // prior week exists so the copy builder renders no comparison.
  if (priorMetrics) {
    const deltas: DigestDeltas = {}
    for (const name of DIGEST_METRIC_NAMES) {
      deltas[name] = metrics[name] - priorMetrics[name]
    }
    data.deltas = deltas
  }

  return data
}
