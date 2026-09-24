import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { OPEN_SOURCES, type OpenSource } from '@area-code/shared/constants/attribution'
import type { OnboardingStatus } from '@area-code/shared/types'
import * as fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import {
  buildDigestCopy,
  BANNED_CAUSAL_VERBS,
  ZERO_VISITS_NEXT_STEP,
  type DigestData,
  type DigestMetricName,
  type DigestMetrics,
  type DigestDeltas,
  type DigestSuppressibleName,
} from '../digest'
import { RECEIPT_METRIC_NAMES, type Receipt, type ReceiptBySource, type ReceiptMetricName } from '../receipt'
import { buildReceiptCopy, type ReceiptWindowLabel } from '../receipt-copy'
import { SUPPRESSION_FLOOR } from '../suppression'

/**
 * Property 3: Honest copy
 *
 * For any metrics vector (including all-zero), `buildDigestCopy` output
 * contains no causal verb from the banned list, renders no percentage for a
 * metric in `suppressed`, and the zero-visits branch contains exactly one
 * next step and no numeric claims.
 *
 * The same discipline extends to `buildReceiptCopy`, which writes every
 * owner-facing "found you" sentence on the live panel, the digest, the trial
 * and renewal emails, the Plans panel and the boost scoreboard
 * (proof-of-demand R4.6, R4.7, R10.3).
 *
 * **Validates: Requirements 2.1, 2.3**
 */

// ─── Arbitraries ────────────────────────────────────────────────────────────

const METRIC_NAMES: DigestMetricName[] = [
  'visits',
  'uniqueVisitors',
  'firstTimeVisitors',
  'returningVisitors',
  'redemptions',
  'firstGetIssued',
  'firstGetConversions',
  'shares',
]

// A non-negative integer count, biased so zero appears often enough to
// exercise the zero-visits branch across the run.
const countArb = fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 1000 }))

/** Distinct Found_You consumers per Open_Source. */
const sourceCountsArb: fc.Arbitrary<ReceiptBySource> = fc
  .tuple(...OPEN_SOURCES.map(() => fc.integer({ min: 0, max: 40 })))
  .map((values) => {
    const bySource = {} as ReceiptBySource
    OPEN_SOURCES.forEach((source: OpenSource, i) => {
      bySource[source] = values[i]
    })
    return bySource
  })

const baseMetricsArb = fc.record({
  visits: countArb,
  uniqueVisitors: countArb,
  firstTimeVisitors: countArb,
  returningVisitors: countArb,
  redemptions: countArb,
  firstGetIssued: countArb,
  firstGetConversions: countArb,
  shares: countArb,
  busiestDay: fc.option(fc.constantFrom('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'), {
    nil: null,
  }),
  busiestHour: fc.option(fc.integer({ min: 0, max: 23 }), { nil: null }),
})

/**
 * The Receipt block a Digest_Row carries (proof-of-demand R4.5), or `null` for a
 * row written before the Receipt existed. Built from parts so the block is
 * internally consistent: `uniqueVisitors` is the sum of the split, `bySource`
 * sums to Found_You, and first-timers never exceed it. Both shapes are generated
 * because the copy builder has to stay honest on a history row too.
 */
const attributionArb = fc.option(
  fc.record({
    bySource: sourceCountsArb,
    walkInVisitors: fc.integer({ min: 0, max: 120 }),
    firstTimerShare: fc.integer({ min: 0, max: 100 }),
    measuredFrom: fc.option(fc.constant('2026-09-27T22:00:00.000Z'), { nil: null }),
  }),
  { nil: null },
)

/**
 * The Going block a Digest_Row carries (proof-of-demand R9.8), or `null` for a
 * week where Going was never read. Internally consistent: the checked-in figure
 * is a share of the marks, so it can never exceed them. Both shapes are generated
 * because the copy builder has to stay silent, not zero, on an unmeasured week.
 */
const goingArb = fc.option(
  fc.record({
    marks: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 200 })),
    checkedInShare: fc.integer({ min: 0, max: 100 }),
  }),
  { nil: null },
)

const metricsArb: fc.Arbitrary<DigestMetrics> = fc
  .tuple(baseMetricsArb, attributionArb, goingArb)
  .map(([base, attribution, going]): DigestMetrics => {
    const withGoing: DigestMetrics =
      going === null
        ? base
        : {
            ...base,
            goingMarks: going.marks,
            goingCheckedIn: Math.floor((going.marks * going.checkedInShare) / 100),
          }

    if (attribution === null) return withGoing

    const foundYouVisitors = OPEN_SOURCES.reduce((sum, source) => sum + attribution.bySource[source], 0)

    return {
      ...withGoing,
      uniqueVisitors: foundYouVisitors + attribution.walkInVisitors,
      foundYouVisitors,
      walkInVisitors: attribution.walkInVisitors,
      foundYouFirstTimers: Math.floor((foundYouVisitors * attribution.firstTimerShare) / 100),
      bySource: attribution.bySource,
      measuredFrom: attribution.measuredFrom,
    }
  })

/**
 * The Receipt the metrics describe, by the same rebuild rule the digest applies:
 * null for a history row, and the suppression list narrowed to the Receipt's own
 * values. The oracle for "the Monday headline is the shared Found_You sentence".
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
    suppressed: RECEIPT_METRIC_NAMES.filter((name) => suppressed.includes(name)),
    measuredFrom: metrics.measuredFrom ?? null,
  }
}

/** The suppression entries the Receipt block implies, by the shared floor rule. */
function attributionSuppressed(metrics: DigestMetrics): ReceiptMetricName[] {
  const receipt = receiptFromMetrics(metrics, [])
  if (receipt === null) return []

  const sample: Record<ReceiptMetricName, number> = {
    uniqueVisitors: receipt.uniqueVisitors,
    foundYouVisitors: receipt.foundYouVisitors,
    walkInVisitors: receipt.walkInVisitors,
    foundYouFirstTimers: receipt.foundYouFirstTimers,
    // The per-source clause divides the Found_You count, so that is its sample.
    bySource: receipt.foundYouVisitors,
  }

  return RECEIPT_METRIC_NAMES.filter((name) => sample[name] < SUPPRESSION_FLOOR)
}

/**
 * The suppression entry the Going block implies, by the same floor rule
 * (R9.8). A week that never measured Going has nothing to suppress.
 */
function goingSuppressed(metrics: DigestMetrics): DigestSuppressibleName[] {
  const { goingMarks } = metrics
  if (goingMarks === undefined) return []
  return goingMarks < SUPPRESSION_FLOOR ? ['goingMarks'] : []
}

// Signed week-over-week deltas over a random subset of metrics.
const deltasArb: fc.Arbitrary<DigestDeltas> = fc.subarray(METRIC_NAMES).chain((names) =>
  fc.tuple(...names.map(() => fc.integer({ min: -500, max: 500 }))).map((values) => {
    const deltas: DigestDeltas = {}
    names.forEach((name, i) => {
      deltas[name] = values[i]
    })
    return deltas
  }),
)

const suppressedArb: fc.Arbitrary<DigestMetricName[]> = fc.subarray(METRIC_NAMES)

// The persisted suppression list is the union of the digest's own floor pass and
// the Receipt's, so the generated list carries the Receipt entries its metrics
// imply. Anything else would be a row the pipeline cannot produce.
const digestArb: fc.Arbitrary<DigestData> = fc
  .record({
    metrics: metricsArb,
    deltas: fc.option(deltasArb, { nil: undefined }),
    suppressed: suppressedArb,
  })
  .map(
    (digest): DigestData => ({
      ...digest,
      suppressed: [
        ...new Set<DigestSuppressibleName>([
          ...digest.suppressed,
          ...attributionSuppressed(digest.metrics),
          ...goingSuppressed(digest.metrics),
        ]),
      ],
    }),
  )

// Tier strings: the three real tiers, a lapsed variant, and arbitrary strings.
const tierArb = fc.oneof(fc.constantFrom('starter', 'growth', 'pro', 'lapsed'), fc.string())

// Case-insensitive whole-word matchers for each banned causal verb.
const bannedVerbMatchers = BANNED_CAUSAL_VERBS.map((verb) => new RegExp(`\\b${verb}\\b`, 'i'))

/**
 * Words no owner-facing sentence may carry, beyond the causal verbs
 * (proof-of-demand R10.3, R9.3): money the platform never measured, and
 * consumer-intent language that would sell a Going mark as an arrival.
 * Whole-word matching, so "upcoming" and "spending time" style compounds are
 * not false positives.
 */
const FORBIDDEN_WORDS = ['revenue', 'ticket', 'spend', 'will arrive', 'coming'] as const

const forbiddenWordMatchers = FORBIDDEN_WORDS.map((word) => new RegExp(`\\b${word}\\b`, 'i'))

function expectHonestSentence(line: string): void {
  for (const matcher of bannedVerbMatchers) {
    expect(matcher.test(line)).toBe(false)
  }
  for (const matcher of forbiddenWordMatchers) {
    expect(matcher.test(line)).toBe(false)
  }
}

// ─── Receipt arbitraries ────────────────────────────────────────────────────
//
// Built from parts so every generated Receipt is internally consistent (the
// conservation rule holds, `bySource` sums to `foundYouVisitors`, first-timers
// never exceed Found_You) and `suppressed` is derived by the same floor rule
// `computeReceipt` applies. An impossible Receipt would prove nothing about the
// copy the owner actually reads.

const receiptArb: fc.Arbitrary<Receipt> = fc
  .record({
    bySource: sourceCountsArb,
    walkInVisitors: fc.integer({ min: 0, max: 120 }),
    // Fraction of Found_You consumers who had never been in before.
    firstTimerShare: fc.integer({ min: 0, max: 100 }),
    // The caller may not have read the earliest-check-in map at all, in which
    // case first-timers are unmeasured rather than zero.
    firstTimersUnmeasured: fc.boolean(),
    measuredFrom: fc.option(fc.constant('2026-09-27T22:00:00.000Z'), { nil: null }),
  })
  .map(({ bySource, walkInVisitors, firstTimerShare, firstTimersUnmeasured, measuredFrom }) => {
    const foundYouVisitors = OPEN_SOURCES.reduce((sum, source) => sum + bySource[source], 0)
    const foundYouFirstTimers = firstTimersUnmeasured ? 0 : Math.floor((foundYouVisitors * firstTimerShare) / 100)

    const values: Record<ReceiptMetricName, number> = {
      uniqueVisitors: foundYouVisitors + walkInVisitors,
      foundYouVisitors,
      walkInVisitors,
      foundYouFirstTimers,
      // The per-source clause divides the Found_You count, so that is its sample.
      bySource: foundYouVisitors,
    }

    const suppressed = RECEIPT_METRIC_NAMES.filter(
      (name) => values[name] < SUPPRESSION_FLOOR || (name === 'foundYouFirstTimers' && firstTimersUnmeasured),
    )

    return {
      foundYouVisitors,
      walkInVisitors,
      uniqueVisitors: values.uniqueVisitors,
      foundYouFirstTimers,
      bySource,
      suppressed,
      measuredFrom,
    }
  })

/** Every Onboarding_Checklist combination, plus "no checklist read". */
const checklistArb: fc.Arbitrary<OnboardingStatus | null> = fc.option(
  fc.record({
    hasNode: fc.boolean(),
    hasReward: fc.boolean(),
    hasStaff: fc.boolean(),
    hasQr: fc.boolean(),
  }),
  { nil: null },
)

const windowLabelArb: fc.Arbitrary<ReceiptWindowLabel> = fc.constantFrom<ReceiptWindowLabel>(
  'week',
  'trial',
  'paid',
  'today',
  'window',
)

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Feature: weekly-attribution-digest, Property 3: Honest copy', () => {
  it('renders no banned causal verb in any sentence, over the whole input space', () => {
    fc.assert(
      fc.property(digestArb, tierArb, (digest, tier) => {
        const lines = buildDigestCopy(digest, tier)
        for (const line of lines) {
          for (const matcher of bannedVerbMatchers) {
            expect(matcher.test(line)).toBe(false)
          }
        }
      }),
      { numRuns: 200 },
    )
  })

  it('renders no percentage for a suppressed metric', () => {
    fc.assert(
      fc.property(digestArb, tierArb, (digest, tier) => {
        const joined = buildDigestCopy(digest, tier).join(' ')
        // The only derived percentage the builder renders is the first-timer
        // share, tied to firstTimeVisitors. When that metric is suppressed, no
        // percentage may appear anywhere; no other metric renders a percentage.
        if (digest.suppressed.includes('firstTimeVisitors')) {
          expect(joined).not.toContain('%')
        }
      }),
      { numRuns: 200 },
    )
  })

  it('zero-visits branch has exactly one next step and no numeric claims', () => {
    fc.assert(
      fc.property(digestArb, tierArb, (digest, tier) => {
        const zeroDigest: DigestData = {
          ...digest,
          metrics: { ...digest.metrics, visits: 0 },
        }
        const lines = buildDigestCopy(zeroDigest, tier)

        // Exactly one constructive next step, equal to the shared constant.
        const nextSteps = lines.filter((line) => line === ZERO_VISITS_NEXT_STEP)
        expect(nextSteps).toHaveLength(1)

        // No numeric claims: the zero branch must not render padded numbers.
        for (const line of lines) {
          expect(line).not.toMatch(/\d/)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('renders none of the forbidden words in any sentence', () => {
    fc.assert(
      fc.property(digestArb, tierArb, (digest, tier) => {
        for (const line of buildDigestCopy(digest, tier)) {
          expectHonestSentence(line)
        }
      }),
      { numRuns: 200 },
    )
  })
})

describe('Feature: Proof of demand, Property 3: Honest copy', () => {
  it('holds the banned causal verb list exactly as the digest defined it', () => {
    // R4.6: this spec adds sentences, it does not soften the list they must
    // pass. A new entry is fine; removing one is what this pins.
    expect([...BANNED_CAUSAL_VERBS]).toEqual(expect.arrayContaining(['brought', 'drove', 'generated', 'boosted']))
  })

  it('leads the Monday digest with the shared Found_You sentence, or says nothing when unmeasured', () => {
    fc.assert(
      fc.property(digestArb, tierArb, (digest, tier) => {
        const lines = buildDigestCopy(digest, tier)
        const receipt = receiptFromMetrics(digest.metrics, digest.suppressed)

        if (digest.metrics.visits === 0) {
          // The quiet-week branch is unchanged by this spec: no Receipt lines.
          expect(lines.join(' ')).not.toContain('found you on Area Code')
        } else if (receipt === null) {
          // A Digest_Row from before the Receipt existed was never measured, so
          // the digest claims nothing about Found_You (R4.5).
          expect(lines.join(' ')).not.toContain('found you on Area Code')
        } else {
          // The headline is the Found_You sentence, built by the one copy home
          // the emails and the Plans panel use, and the Receipt block leads the
          // digest in the same order (R4.5, R4.6).
          const expected = buildReceiptCopy(receipt, null, 'week')
          expect(lines.slice(0, expected.lines.length)).toEqual(expected.lines)
          expect(lines[0]).toBe(expected.headline)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('frames Going as intent, and only for a week that measured it (R9.8)', () => {
    fc.assert(
      fc.property(digestArb, tierArb, (digest, tier) => {
        const lines = buildDigestCopy(digest, tier)
        const goingLine = lines.find((line) => line.includes('marked going'))
        const { goingMarks, goingCheckedIn } = digest.metrics

        if (digest.metrics.visits === 0 || goingMarks === undefined) {
          // Quiet week, or a week where Going was never read: silence, not zero.
          expect(goingLine).toBeUndefined()
          return
        }

        expect(goingLine).toBeDefined()
        // The count always renders; the overlap only above the floor, and it can
        // never exceed the marks it is drawn from.
        if (digest.suppressed.includes('goingMarks')) {
          expect(goingLine).toBe(`${goingMarks} marked going before doors.`)
        } else {
          expect(goingLine).toBe(`${goingMarks} marked going before doors, ${goingCheckedIn} of them checked in.`)
          expect(goingCheckedIn ?? 0).toBeLessThanOrEqual(goingMarks)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('withholds the per-source and first-timer clauses the floor suppresses', () => {
    fc.assert(
      fc.property(digestArb, tierArb, (digest, tier) => {
        const joined = buildDigestCopy(digest, tier).join(' ')

        if (digest.suppressed.includes('bySource')) {
          expect(joined).not.toContain('Recorded sources:')
        }
        if (digest.suppressed.includes('foundYouFirstTimers')) {
          expect(joined).not.toContain('had never been in before')
        }
      }),
      { numRuns: 200 },
    )
  })

  it('renders no banned verb and no forbidden word in any Receipt sentence', () => {
    fc.assert(
      fc.property(receiptArb, checklistArb, windowLabelArb, (receipt, checklist, windowLabel) => {
        const copy = buildReceiptCopy(receipt, checklist, windowLabel)
        for (const line of copy.lines) {
          expectHonestSentence(line)
        }
      }),
      { numRuns: 200 },
    )
  })

  it('renders every non-null sentence exactly once, in order, next step last', () => {
    fc.assert(
      fc.property(receiptArb, checklistArb, windowLabelArb, (receipt, checklist, windowLabel) => {
        const copy = buildReceiptCopy(receipt, checklist, windowLabel)
        const expected = [
          copy.headline,
          copy.walkIn,
          copy.firstTimers,
          copy.bySource,
          copy.measuredFrom,
          copy.nextStep?.text ?? null,
        ].filter((line): line is string => line !== null)

        expect(copy.lines).toEqual(expected)
      }),
      { numRuns: 200 },
    )
  })

  it('never renders a suppressed value as a zero', () => {
    fc.assert(
      fc.property(receiptArb, checklistArb, windowLabelArb, (receipt, checklist, windowLabel) => {
        const copy = buildReceiptCopy(receipt, checklist, windowLabel)

        // Below the floor, or never measured: say less, do not say "0 of them".
        if (receipt.suppressed.includes('foundYouFirstTimers')) {
          expect(copy.firstTimers).toBeNull()
        }
        if (receipt.suppressed.includes('bySource')) {
          expect(copy.bySource).toBeNull()
        }
        expect(copy.lines.join(' ')).not.toMatch(/\b0 /)
      }),
      { numRuns: 200 },
    )
  })

  it('zero Found_You states the quiet window with exactly one next step', () => {
    const zeroFoundYouArb = receiptArb.map(
      (receipt): Receipt => ({
        ...receipt,
        foundYouVisitors: 0,
        foundYouFirstTimers: 0,
        bySource: { map: 0, share: 0, search: 0, push: 0 },
        uniqueVisitors: receipt.walkInVisitors,
        suppressed: RECEIPT_METRIC_NAMES.filter((name) => name !== 'walkInVisitors' && name !== 'uniqueVisitors'),
      }),
    )

    fc.assert(
      fc.property(zeroFoundYouArb, checklistArb, windowLabelArb, (receipt, checklist, windowLabel) => {
        const copy = buildReceiptCopy(receipt, checklist, windowLabel)

        // Exactly one next step, and it is the closing line.
        expect(copy.nextStep).not.toBeNull()
        const stepText = copy.nextStep?.text ?? ''
        expect(copy.lines.filter((line) => line === stepText)).toHaveLength(1)
        expect(copy.lines.at(-1)).toBe(stepText)

        // The headline states the quiet window plainly: no padded number, and
        // never "0 people found you" (R4.7, R6.3).
        expect(copy.headline).not.toMatch(/\d/)
        expect(copy.headline.toLowerCase()).toContain('no one has found you on area code')

        // An incomplete checklist points at the flag that is false.
        if (checklist !== null && !checklist.hasNode) {
          expect(copy.nextStep?.step).toBe('venue')
        }
        if (checklist !== null && checklist.hasNode && checklist.hasReward && checklist.hasQr && checklist.hasStaff) {
          expect(copy.nextStep?.step).toBeNull()
        }
      }),
      { numRuns: 200 },
    )
  })
})

// ─── Business marketing copy surface ────────────────────────────────────────
//
// proof-of-demand task 11.1 / R10.6: the owner-facing marketing and
// value-proposition copy has ONE home, `apps/business/src/i18n/locales/en.json`,
// so this test has one surface to quantify over. It is read as a file rather
// than imported, so the backend gains no dependency on an app (structure.md).
//
// Task 11.2 / R11.3 rides the same surface: a benchmark stays anonymous, so no
// owner-facing sentence may name another venue or compare against one.

const BUSINESS_COPY_PATH = 'apps/business/src/i18n/locales/en.json'

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url))

const businessCopy = JSON.parse(readFileSync(join(REPO_ROOT, BUSINESS_COPY_PATH), 'utf8')) as Record<string, string>

/** The key prefixes that own owner-facing marketing and plan copy. */
const MARKETING_PREFIXES = ['biz.marketing.', 'biz.plans.'] as const

const MARKETING_ENTRIES = Object.entries(businessCopy).filter(([key]) =>
  MARKETING_PREFIXES.some((prefix) => key.startsWith(prefix)),
)

/** The four reach mechanisms R10.6 names, and the word each one must carry. */
const REACH_MECHANISMS: ReadonlyArray<readonly [string, string]> = [
  ['biz.marketing.reach.map', 'map'],
  ['biz.marketing.reach.tonight', 'Tonight'],
  ['biz.marketing.reach.shares', 'WhatsApp'],
  ['biz.marketing.reach.friends', 'friends'],
]

/**
 * Constructions that turn a count into a comparison. A benchmark the owner reads
 * is anonymous or it does not exist (R10.2, R11.3), and none of these can be
 * written without an implied second party.
 */
const COMPARISON_MARKERS = [
  'than',
  'versus',
  'vs',
  'compared to',
  'unlike',
  'beats',
  'outperforms',
  'other venues',
  'nearby venues',
  'competitor',
  'average venue',
] as const

/**
 * Every proper noun the owner-facing copy is allowed to use: our own product
 * nouns and the one third-party channel a share travels on. A venue name, a
 * competitor name or a city ranking would not be on this list, which is the
 * point: the assertion is an allowlist, so it fails on names nobody predicted.
 */
const ALLOWED_PROPER_NOUNS = ['Area', 'Code', 'WhatsApp', 'Tonight', 'Pricing', 'Starter', 'Growth', 'Pro', 'QR']

/**
 * Capitalised words that are not sentence-initial, i.e. the words that can only
 * be there because they name something.
 */
function midSentenceCapitalisedWords(copy: string): string[] {
  return copy
    .split(/(?<=[.!?])\s+/)
    .flatMap((sentence) =>
      sentence
        .split(/\s+/)
        .slice(1)
        .map((word) => word.replace(/[^A-Za-z-]/g, '')),
    )
    .filter((word) => /^[A-Z]/.test(word))
}

/** Marketing values that are prose (a sentence), not a short UI label. */
const MARKETING_SENTENCES = MARKETING_ENTRIES.map(([, value]) => value).filter(
  (value) => value.includes(' ') && value.includes('.'),
)

/** Non-test source files under `apps/business/src`, for the one-home check. */
function businessSourceFiles(): string[] {
  const found: string[] = []

  function walk(absDir: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = join(absDir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(abs)
        continue
      }
      if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(abs)
    }
  }

  walk(join(REPO_ROOT, 'apps', 'business', 'src'))
  return found
}

describe('Feature: Proof of demand, Property 3: Honest copy (business marketing, R10.6)', () => {
  it('reads a marketing surface that exists and names the four reach mechanisms', () => {
    // Every assertion below is vacuous on an empty surface, so pin that the file
    // was found and still carries the copy R10.6 requires.
    expect(MARKETING_ENTRIES.length).toBeGreaterThan(10)
    expect(MARKETING_SENTENCES.length).toBeGreaterThan(0)

    for (const [key, mechanism] of REACH_MECHANISMS) {
      const copy = businessCopy[key]
      expect(copy, `${key} must exist in ${BUSINESS_COPY_PATH}`).toBeDefined()
      expect(copy, `${key} must describe reach as ${mechanism}`).toContain(mechanism)
    }
  })

  it('renders no banned verb and no forbidden word in any marketing sentence', () => {
    fc.assert(
      fc.property(fc.constantFrom(...MARKETING_ENTRIES), ([key, value]) => {
        expect(() => expectHonestSentence(value), `${key} must read as a measurement, not a cause`).not.toThrow()
      }),
      { numRuns: 200 },
    )
  })

  it('names no venue and draws no comparison in any marketing sentence (R10.2, R11.3)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...MARKETING_ENTRIES), ([key, value]) => {
        for (const marker of COMPARISON_MARKERS) {
          expect(
            new RegExp(`\\b${marker}\\b`, 'i').test(value),
            `${key} must not compare the venue against anything: "${marker}"`,
          ).toBe(false)
        }

        for (const word of midSentenceCapitalisedWords(value)) {
          expect(ALLOWED_PROPER_NOUNS, `${key} names "${word}", which is not one of our own product nouns`).toContain(
            word,
          )
        }
      }),
      { numRuns: 200 },
    )
  })

  it('keeps every marketing sentence out of the app source, so the i18n file is its one home', () => {
    const offenders: string[] = []

    for (const abs of businessSourceFiles()) {
      const source = readFileSync(abs, 'utf8')
      for (const sentence of MARKETING_SENTENCES) {
        if (source.includes(sentence)) {
          offenders.push(`${abs.slice(REPO_ROOT.length).split(sep).join('/')}: ${sentence}`)
        }
      }
    }

    expect(offenders, `marketing copy belongs in ${BUSINESS_COPY_PATH} only, never as an inline t() default`).toEqual(
      [],
    )
  })
})
