/**
 * The digest Going line (proof-of-demand R9.8, task 10.7).
 *
 * Going is the pipeline before doors, and the Monday line about it has to stay
 * INTENT: "N marked going before doors, M of them checked in". It is a measured
 * overlap, not a conversion the platform caused, and it may never read as an
 * arrival forecast (`honest-presence.md`, R9.3, R10.3).
 *
 * What these cases pin:
 *
 *  - measured: both numbers travel on the metrics and the sentence renders
 *  - unmeasured: a week where Going was not read says NOTHING, rather than zero.
 *    Absent is not empty, which is the same rule the Receipt block follows
 *  - suppressed: below the Suppression_Floor the mark count still renders and the
 *    checked-in comparison does not
 *  - Going never gains a week-over-week delta, so no surface can imply a trend
 *    from a count that expires every week
 *
 * _Requirements: 9.8_
 */

import { describe, it, expect } from 'vitest'

import type { RawCheckIn } from '../anonymize'
import {
  buildDigestCopy,
  computeDigest,
  digestWeekFor,
  DIGEST_METRIC_NAMES,
  type DigestData,
  type DigestMetrics,
  type DigestSources,
} from '../digest'
import { SUPPRESSION_FLOOR } from '../suppression'

const SALT = 'test-salt'
const WEEK = digestWeekFor('2026-03-09T08:00:00.000Z')

/** A check-in inside the week, so `visits` is non-zero and the line renders. */
function checkIn(userId: string, at: string): RawCheckIn {
  return { userId, nodeId: 'node-1', tier: 'starter', checkedInAt: at }
}

function sourcesWith(going?: { marks: number; checkedIn: number }): DigestSources {
  return {
    windowCheckIns: [checkIn('u1', '2026-03-06T19:00:00.000Z'), checkIn('u2', '2026-03-06T20:00:00.000Z')],
    earliestCheckInByUser: {},
    redemptions: 0,
    firstGetIssued: 0,
    firstGetConversions: 0,
    shares: 0,
    ...(going ? { going } : {}),
  }
}

function lineAbout(lines: string[]): string | undefined {
  return lines.find((line) => line.includes('marked going'))
}

// ─── The metrics ─────────────────────────────────────────────────────────────

describe('computeDigest carries Going as measured intent (R9.8)', () => {
  it('records the marks and the overlap when Going was read', () => {
    const { metrics } = computeDigest(WEEK, sourcesWith({ marks: 9, checkedIn: 6 }), SALT)

    expect(metrics.goingMarks).toBe(9)
    expect(metrics.goingCheckedIn).toBe(6)
  })

  it('omits both when Going was not read: unmeasured is not zero', () => {
    const { metrics } = computeDigest(WEEK, sourcesWith(), SALT)

    expect(metrics.goingMarks).toBeUndefined()
    expect(metrics.goingCheckedIn).toBeUndefined()
  })

  it('suppresses the comparison below the floor and not at it', () => {
    const below = computeDigest(WEEK, sourcesWith({ marks: SUPPRESSION_FLOOR - 1, checkedIn: 1 }), SALT)
    const at = computeDigest(WEEK, sourcesWith({ marks: SUPPRESSION_FLOOR, checkedIn: 2 }), SALT)

    expect(below.suppressed).toContain('goingMarks')
    expect(at.suppressed).not.toContain('goingMarks')
  })

  it('never lists goingMarks as suppressed for a week that never measured it', () => {
    expect(computeDigest(WEEK, sourcesWith(), SALT).suppressed).not.toContain('goingMarks')
  })

  it('gives Going no week-over-week delta', () => {
    const prior: DigestMetrics = {
      ...computeDigest(WEEK, sourcesWith({ marks: 3, checkedIn: 1 }), SALT).metrics,
    }
    const { deltas } = computeDigest(WEEK, sourcesWith({ marks: 9, checkedIn: 6 }), SALT, prior)

    // Exactly the eight numeric metrics, so nothing can imply a Going trend from
    // rows that expire every week.
    expect(Object.keys(deltas ?? {}).sort()).toEqual([...DIGEST_METRIC_NAMES].sort())
  })
})

// ─── The sentence ────────────────────────────────────────────────────────────

function copyFor(going: { marks: number; checkedIn: number } | undefined): string[] {
  const digest: DigestData = computeDigest(WEEK, sourcesWith(going), SALT)
  return buildDigestCopy(digest, 'growth')
}

describe('the Going sentence reads as intent, never as arrivals (R9.8, R9.3)', () => {
  it('names the marks and the overlap', () => {
    expect(lineAbout(copyFor({ marks: 9, checkedIn: 6 }))).toBe('9 marked going before doors, 6 of them checked in.')
  })

  it('withholds the overlap below the floor, keeping the absolute count', () => {
    expect(lineAbout(copyFor({ marks: 4, checkedIn: 3 }))).toBe('4 marked going before doors.')
  })

  it('says nothing at all about Going for an unmeasured week', () => {
    expect(lineAbout(copyFor(undefined))).toBeUndefined()
  })

  it('uses no arrival language in any sentence', () => {
    const joined = copyFor({ marks: 9, checkedIn: 6 }).join(' ')

    for (const forbidden of [/\bcoming\b/i, /\bwill arrive\b/i, /\barrived\b/i, /\barrivals\b/i]) {
      expect(forbidden.test(joined)).toBe(false)
    }
    // And the verb it does use is the one the consumer surface uses.
    expect(joined).toContain('marked going')
  })

  it('stays out of the quiet-week branch, which carries no numbers', () => {
    const digest = computeDigest(WEEK, sourcesWith({ marks: 9, checkedIn: 6 }), SALT)
    const quiet: DigestData = { ...digest, metrics: { ...digest.metrics, visits: 0 } }

    const lines = buildDigestCopy(quiet, 'growth')

    expect(lineAbout(lines)).toBeUndefined()
    for (const line of lines) expect(line).not.toMatch(/\d/)
  })
})
