/**
 * Unit tests for the Digest read-view service layer (task 6.1).
 *
 * Validates: Requirements 4.1
 *
 * `getLatestDigestView` / `getDigestHistoryView` read the reports repository and
 * assemble the API shape: the raw Attribution_Metrics PLUS the copy strings,
 * rebuilt from the persisted row via the SAME `buildDigestCopy` the Digest_Email
 * uses (one source of truth for copy, R4.3). These tests exercise the real copy
 * assembly (buildDigestCopy is not mocked) and only stub the repository reads.
 *
 * DEV_MODE is OFF (`AREA_CODE_FORCE_LIVE`) so the live read path runs, mirroring
 * digest-optout-service.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

import { BANNED_CAUSAL_VERBS } from '../../reports/digest.js'
import type { DigestRow } from '../../reports/types.js'

const getLatestDigest = vi.fn()
const queryDigestHistory = vi.fn()

vi.mock('../../reports/repository.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, getLatestDigest, queryDigestHistory }
})

let service: typeof import('../service.js')

const storedRow: DigestRow = {
  businessId: 'biz-1',
  weekStart: '2026-07-06',
  metrics: {
    visits: 23,
    uniqueVisitors: 18,
    firstTimeVisitors: 7,
    returningVisitors: 11,
    redemptions: 6,
    firstGetIssued: 9,
    firstGetConversions: 4,
    busiestDay: 'Friday',
    busiestHour: 20,
  },
  deltas: {
    visits: 5,
    uniqueVisitors: 3,
    firstTimeVisitors: 2,
    returningVisitors: 1,
    redemptions: 1,
    firstGetIssued: 2,
    firstGetConversions: 1,
  },
  suppressed: [],
  tierAtBuild: 'growth',
  emailSent: true,
  createdAt: '2026-07-06T20:00:00.000Z',
}

beforeAll(async () => {
  process.env['AREA_CODE_ENV'] = 'dev'
  process.env['AREA_CODE_FORCE_LIVE'] = '1'
  service = await import('../service.js')
})

afterAll(() => {
  delete process.env['AREA_CODE_FORCE_LIVE']
})

beforeEach(() => {
  getLatestDigest.mockReset()
  queryDigestHistory.mockReset()
})

describe('getLatestDigestView (R4.1)', () => {
  it('returns the stored metrics plus rendered copy for a stored digest', async () => {
    getLatestDigest.mockResolvedValueOnce(storedRow)

    const result = await service.getLatestDigestView('biz-1')

    expect(getLatestDigest).toHaveBeenCalledWith('biz-1')
    expect(result.digest).not.toBeNull()
    const digest = result.digest!

    // Raw metrics are surfaced verbatim (the card renders numbers from these).
    expect(digest.weekStart).toBe('2026-07-06')
    expect(digest.metrics).toEqual(storedRow.metrics)
    expect(digest.deltas).toEqual(storedRow.deltas)
    expect(digest.suppressed).toEqual([])
    expect(digest.tierAtBuild).toBe('growth')

    // Copy strings accompany the metrics (one source of truth with the email).
    expect(Array.isArray(digest.copy)).toBe(true)
    expect(digest.copy.length).toBeGreaterThan(0)
    expect(digest.copy.some((line) => line.includes('recorded through Area Code'))).toBe(true)
    // Honest_Framing holds in the assembled copy: no causal verbs.
    for (const line of digest.copy) {
      for (const verb of BANNED_CAUSAL_VERBS) {
        expect(line.toLowerCase()).not.toContain(verb)
      }
    }
  })

  it('returns a clean empty state (digest null) when no digest exists yet', async () => {
    getLatestDigest.mockResolvedValueOnce(null)

    const result = await service.getLatestDigestView('biz-1')

    expect(result).toEqual({ digest: null })
  })
})

describe('getDigestHistoryView (R4.1)', () => {
  it('returns a page of items with copy and passes the cursor through', async () => {
    const olderRow: DigestRow = { ...storedRow, weekStart: '2026-06-29', deltas: undefined }
    queryDigestHistory.mockResolvedValueOnce({ items: [storedRow, olderRow], nextCursor: 'next-page-cursor' })

    const result = await service.getDigestHistoryView('biz-1', 'incoming-cursor')

    // The opaque cursor is passed straight through to the repository read.
    expect(queryDigestHistory).toHaveBeenCalledWith('biz-1', 'incoming-cursor')

    expect(result.nextCursor).toBe('next-page-cursor')
    expect(result.items).toHaveLength(2)
    expect(result.items[0]!.weekStart).toBe('2026-07-06')
    expect(result.items[1]!.weekStart).toBe('2026-06-29')
    // A row with no stored deltas surfaces deltas: null, still with copy.
    expect(result.items[1]!.deltas).toBeNull()
    expect(result.items[1]!.copy.length).toBeGreaterThan(0)
  })

  it('normalises an absent nextCursor to null on the last page', async () => {
    queryDigestHistory.mockResolvedValueOnce({ items: [storedRow], nextCursor: undefined })

    const result = await service.getDigestHistoryView('biz-1')

    expect(queryDigestHistory).toHaveBeenCalledWith('biz-1', undefined)
    expect(result.nextCursor).toBeNull()
    expect(result.items).toHaveLength(1)
  })
})
