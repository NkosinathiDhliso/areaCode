// Pure anonymised dwell-time aggregation for Presence Integrity (Requirement 12).
//
// This module turns a set of anonymised `DwellRow`s for a single venue and
// period into Anonymised_Aggregate business-intelligence metrics: average and
// median dwell, a distribution by SAST time band (`peak` vs `off_peak`), and a
// split by how the presence ended (`checkout_terminated` vs `expiry_terminated`)
// so the business signal is never silently inflated or deflated by expiry
// estimates (Requirements 12.1, 12.2).
//
// It is a PURE function — no DynamoDB, no clock, no I/O — so it is fully
// property-testable and is the executable specification the read side must
// agree with. The DwellRow input already carries NO identity or coordinate
// fields (`userId`, `cognitoSub`, `displayName`, `email`, `phone`, `avatarUrl`,
// lat, lng), and this function introduces none, so the output is anonymised by
// construction (Property 9 / Requirements 10.3, 12.4).
//
// Minimum-sample suppression: when fewer than `MIN_DWELL_SAMPLE` rows exist for
// the venue+period, no numeric aggregate is produced — an insufficient-data
// indicator is returned instead, so a figure is never derived from too few
// people (Property 12 / Requirement 12.3).
//
// Per Requirement 13.3, whether these aggregates surface in business reports in
// this release is a founder flag; this module is the underlying computation
// only and wires up no report route.
import type { DwellRow, DwellTermination } from '../check-out/types.js'

/**
 * Minimum number of dwell records required for a venue+period before a numeric
 * aggregate is exposed. Below this, the aggregate is suppressed and an
 * insufficient-data indicator is returned instead (Requirement 12.3).
 *
 * Founder-flagged single source of truth (Requirement 13.3). The default of 5
 * is a privacy-preserving k-anonymity-style floor: it keeps a published dwell
 * figure from being attributable to too small a group. Change it here only.
 */
export const MIN_DWELL_SAMPLE = 5

/** A time band a dwell row can fall into (SAST 18:00–23:59 = peak). */
export type TimeBand = DwellRow['timeBand']

/**
 * Summary statistics over a set of dwell durations. `averageSeconds` and
 * `medianSeconds` are `null` only when `count` is 0 (an empty sub-bucket); they
 * are otherwise finite, non-negative numbers (possibly fractional, e.g. a
 * median of two even-positioned values, or a mean).
 */
export interface DwellStats {
  /** Number of dwell records in this bucket. */
  count: number
  /** Mean of `durationSeconds`; `null` when `count` is 0. */
  averageSeconds: number | null
  /** Median of `durationSeconds`; `null` when `count` is 0. */
  medianSeconds: number | null
}

/**
 * Numeric dwell aggregate for a venue+period, returned when the sample size is
 * at or above `MIN_DWELL_SAMPLE`.
 *
 * `byTermination` partitions the input cleanly: the two bucket counts are
 * disjoint and sum to `sampleSize` (Property 11 / Requirement 12.2). Likewise
 * `byTimeBand` partitions the input across the two bands.
 */
export interface DwellAggregateMetrics {
  sufficient: true
  /** Total number of dwell records aggregated. */
  sampleSize: number
  /** Stats over every dwell record, regardless of termination or band. */
  overall: DwellStats
  /** Stats split by how the presence ended (Requirement 12.2). */
  byTermination: Record<DwellTermination, DwellStats>
  /** Dwell distribution by SAST time band (Requirement 12.1). */
  byTimeBand: Record<TimeBand, DwellStats>
}

/**
 * Returned instead of figures when the venue+period has fewer than
 * `MIN_DWELL_SAMPLE` dwell records (Requirement 12.3). Carries only the
 * observed sample size and a stable reason — no derived dwell figure.
 */
export interface DwellAggregateInsufficient {
  sufficient: false
  /** The (sub-threshold) number of records observed. */
  sampleSize: number
  /** Stable machine-readable suppression reason. */
  reason: 'insufficient_data'
  /** The threshold that was not met, for surfacing/telemetry. */
  minSample: number
}

/**
 * Discriminated union: either a numeric aggregate (`sufficient: true`) or a
 * suppressed insufficient-data indicator (`sufficient: false`).
 */
export type DwellAggregate = DwellAggregateMetrics | DwellAggregateInsufficient

/** Options for {@link computeDwellAggregate}. */
export interface DwellAggregateOptions {
  /**
   * Override the minimum-sample threshold. Defaults to {@link MIN_DWELL_SAMPLE}.
   * Primarily useful for tests; production callers should use the default.
   */
  minSample?: number
}

/**
 * Mean of a list of durations. Returns `null` for an empty list (an undefined
 * mean), matching {@link DwellStats.averageSeconds}.
 */
function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  let sum = 0
  for (const v of values) sum += v
  return sum / values.length
}

/**
 * Median of a list of durations using the straightforward reference definition
 * (Property 10): sort ascending, take the middle value for an odd count, or the
 * average of the two middle values for an even count. Returns `null` for an
 * empty list. Does not mutate the input.
 */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) {
    return sorted[mid] as number
  }
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

/** Build {@link DwellStats} from a list of durations. */
function statsOf(durations: readonly number[]): DwellStats {
  return {
    count: durations.length,
    averageSeconds: mean(durations),
    medianSeconds: median(durations),
  }
}

/**
 * Compute the anonymised dwell aggregate for a single venue+period from its
 * dwell rows.
 *
 * The caller is responsible for selecting the rows for one venue and one period
 * (e.g. by querying the `DWELL#<nodeId>#<yyyy-mm-dd>` partitions). This function
 * is pure: it derives every figure from `rows` alone and introduces no identity
 * or coordinate fields.
 *
 * @param rows - the venue+period's dwell rows (any termination/time band).
 * @param opts - optional threshold override.
 * @returns a numeric aggregate when `rows.length >= minSample`, otherwise a
 *   suppressed insufficient-data indicator.
 */
export function computeDwellAggregate(
  rows: readonly DwellRow[],
  opts: DwellAggregateOptions = {},
): DwellAggregate {
  const minSample = opts.minSample ?? MIN_DWELL_SAMPLE
  const sampleSize = rows.length

  // Minimum-sample suppression (Requirement 12.3 / Property 12).
  if (sampleSize < minSample) {
    return {
      sufficient: false,
      sampleSize,
      reason: 'insufficient_data',
      minSample,
    }
  }

  // Partition durations by termination type and by time band. Each row lands in
  // exactly one termination bucket and exactly one time-band bucket, so the
  // bucket counts sum back to sampleSize (Property 11 / Requirement 12.2).
  const overall: number[] = []
  const checkout: number[] = []
  const expiry: number[] = []
  const peak: number[] = []
  const offPeak: number[] = []

  for (const row of rows) {
    overall.push(row.durationSeconds)

    if (row.termination === 'checkout_terminated') {
      checkout.push(row.durationSeconds)
    } else {
      expiry.push(row.durationSeconds)
    }

    if (row.timeBand === 'peak') {
      peak.push(row.durationSeconds)
    } else {
      offPeak.push(row.durationSeconds)
    }
  }

  return {
    sufficient: true,
    sampleSize,
    overall: statsOf(overall),
    byTermination: {
      checkout_terminated: statsOf(checkout),
      expiry_terminated: statsOf(expiry),
    },
    byTimeBand: {
      peak: statsOf(peak),
      off_peak: statsOf(offPeak),
    },
  }
}
