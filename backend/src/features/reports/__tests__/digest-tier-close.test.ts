/**
 * Tier-aware close resolution (weekly-attribution-digest R5.1, R5.2, R5.3, R5.4).
 *
 * The digest is NOT tier-gated: every tier receives the same
 * Attribution_Metrics, and only the closing line changes (R5.1). The close is
 * built from the already-resolved effective tier:
 *   - starter (and any lapsed-to-starter tier) → one named locked capability
 *     (peak-hours analysis) plus an upgrade pointer, no invented numbers (R5.2);
 *   - growth / pro → a link to the full weekly report surface, no upgrade
 *     pointer (R5.3).
 *
 * The tier is resolved with the canonical `getEffectiveTier` Tier_Resolver as-is
 * (R5.4; the single seam in the generator swaps in the unified resolver when
 * billing-revenue-integrity task 5 merges). These tests use the REAL resolver so
 * the lapsed-paid → starter collapse is exercised end to end, and the REAL
 * `buildDigestCopy` so there is no mocked copy.
 *
 * Runs under the standard `pnpm test` (default node env).
 */

import { describe, it, expect } from 'vitest'

import { getEffectiveTier } from '../../business/service.js'
import {
  buildDigestCopy,
  FULL_REPORT_CLOSE,
  STARTER_UPGRADE_CLOSE,
  type DigestData,
  type DigestMetrics,
} from '../digest.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

// A populated (non-zero) metrics vector so the full digest body renders. Nothing
// here is suppressed, so the body is stable across tiers and only the close line
// can differ.
const METRICS: DigestMetrics = {
  visits: 23,
  uniqueVisitors: 20,
  firstTimeVisitors: 6,
  returningVisitors: 14,
  redemptions: 5,
  firstGetIssued: 8,
  firstGetConversions: 3,
  busiestDay: 'Friday',
  busiestHour: 20,
}

const DIGEST: DigestData = { metrics: METRICS, suppressed: [] }

const ZERO_DIGEST: DigestData = {
  metrics: {
    visits: 0,
    uniqueVisitors: 0,
    firstTimeVisitors: 0,
    returningVisitors: 0,
    redemptions: 0,
    firstGetIssued: 0,
    firstGetConversions: 0,
    busiestDay: null,
    busiestHour: null,
  },
  suppressed: [],
}

const lastLine = (data: DigestData, tier: string): string => {
  const lines = buildDigestCopy(data, tier)
  return lines[lines.length - 1]!
}

// ─── R5.2 / R5.3: the two close variants ─────────────────────────────────────

describe('tier-aware close variants (R5.2, R5.3)', () => {
  it('starter close names peak-hours analysis with an upgrade pointer and no invented numbers', () => {
    expect(lastLine(DIGEST, 'starter')).toBe(STARTER_UPGRADE_CLOSE)

    // R5.2: one concrete locked capability + an upgrade pointer.
    expect(STARTER_UPGRADE_CLOSE).toMatch(/peak-hours/)
    expect(STARTER_UPGRADE_CLOSE).toMatch(/upgrade/i)
    // Honest_Framing: no numbers copied from the locked report.
    expect(STARTER_UPGRADE_CLOSE).not.toMatch(/\d/)
  })

  it('any non-full-access tier gets the same starter upgrade close', () => {
    // free / payg / unknown all resolve below full access and share the close.
    for (const tier of ['free', 'payg', 'local', 'mystery-tier']) {
      expect(lastLine(DIGEST, tier)).toBe(STARTER_UPGRADE_CLOSE)
    }
  })

  it('growth and pro closes link to the full weekly report with no upgrade wording', () => {
    for (const tier of ['growth', 'pro']) {
      expect(lastLine(DIGEST, tier)).toBe(FULL_REPORT_CLOSE)
    }

    // R5.3: points at the full weekly report surface, never "upgrade to unlock".
    expect(FULL_REPORT_CLOSE).toMatch(/full weekly report/i)
    expect(FULL_REPORT_CLOSE).not.toMatch(/upgrade/i)
    expect(FULL_REPORT_CLOSE).not.toContain('unlock')
  })

  it('applies the same close split on a quiet (zero-visits) week', () => {
    expect(lastLine(ZERO_DIGEST, 'starter')).toBe(STARTER_UPGRADE_CLOSE)
    expect(lastLine(ZERO_DIGEST, 'growth')).toBe(FULL_REPORT_CLOSE)
  })
})

// ─── R5.4: lapsed-paid resolves to starter via the canonical resolver ─────────

describe('lapsed-paid business resolves to starter and gets the starter close (R5.1, R5.4)', () => {
  // A fixed "now" so the window comparisons are deterministic.
  const NOW = Date.UTC(2026, 6, 6, 20, 0, 0) // 2026-07-06T20:00:00Z

  it('collapses a stored growth business with only expired windows to starter', () => {
    const lapsedGrowth = {
      tier: 'growth',
      trialEndsAt: null,
      paidUntil: '2026-01-01T00:00:00.000Z', // expired
      paymentGraceUntil: '2026-01-08T00:00:00.000Z', // expired
    }
    const resolved = getEffectiveTier(lapsedGrowth, NOW)

    expect(resolved).toBe('starter')
    expect(lastLine(DIGEST, resolved)).toBe(STARTER_UPGRADE_CLOSE)
  })

  it('keeps a stored pro business with an active paid window on the full-report close', () => {
    const activePro = {
      tier: 'pro',
      trialEndsAt: null,
      paidUntil: '2026-12-31T00:00:00.000Z', // still open at NOW
      paymentGraceUntil: null,
    }
    const resolved = getEffectiveTier(activePro, NOW)

    expect(resolved).toBe('pro')
    expect(lastLine(DIGEST, resolved)).toBe(FULL_REPORT_CLOSE)
  })
})

// ─── R5.1: same metrics for every tier, only the close differs ────────────────

describe('the digest is not tier-gated: same metrics, only the close changes (R5.1)', () => {
  it('renders an identical digest body for every tier, differing only in the final close line', () => {
    const starter = buildDigestCopy(DIGEST, 'starter')
    const growth = buildDigestCopy(DIGEST, 'growth')
    const pro = buildDigestCopy(DIGEST, 'pro')

    // Same number of lines, and the body (everything above the close) is byte
    // identical across tiers — the metrics rendering is tier-independent.
    expect(growth.length).toBe(starter.length)
    expect(pro.length).toBe(starter.length)
    expect(growth.slice(0, -1)).toEqual(starter.slice(0, -1))
    expect(pro.slice(0, -1)).toEqual(starter.slice(0, -1))

    // Only the last line (the close) differs by tier.
    expect(starter[starter.length - 1]).toBe(STARTER_UPGRADE_CLOSE)
    expect(growth[growth.length - 1]).toBe(FULL_REPORT_CLOSE)
    expect(pro[pro.length - 1]).toBe(FULL_REPORT_CLOSE)
  })

  it('renders the same headline metrics regardless of tier', () => {
    // The headline visit count and unique-visitor line come from the metrics,
    // not the tier, so they appear verbatim for a starter and a paid tier.
    const starterBody = buildDigestCopy(DIGEST, 'starter').join(' ')
    const growthBody = buildDigestCopy(DIGEST, 'growth').join(' ')

    for (const body of [starterBody, growthBody]) {
      expect(body).toContain('23 visits recorded through Area Code this week')
      expect(body).toContain('20 unique visitors recorded')
    }
  })
})
