/**
 * Cross-cutting guardrail — Part B: generator anti-pattern (R8).
 *
 * **Validates: Requirements 8.2, 8.3**
 *
 * Two anti-patterns must never reappear in the report generator:
 *   1. `previousMetrics.pulseScore` hardcoded to `0` (H4). A `0` baseline
 *      turns any positive current pulse into a fabricated `+100% up` trend.
 *   2. `previousVisitorTokens` unconditionally reset to an empty set (H3),
 *      which forces the repeat-visitor rate to a fabricated `0%`.
 *
 * This is a BEHAVIORAL test, not a source-string scan: it runs
 * `generateReportNow` with a stubbed previous report (whose `summary.pulseScore`
 * is a real prior value) and a stubbed set of previous visitor tokens that
 * overlap the current visitors. It then inspects the report handed to
 * `storeReport` and asserts the previous pulse and previous tokens actually
 * flowed through — i.e. the pulse trend compares against the real prior value
 * (not a 0 baseline producing +100%) and the repeat-visitor analysis reports
 * `hasPriorData: true` with a real (non-zero) repeat rate.
 *
 * Runs under the standard `pnpm test` (default node env), never gated behind
 * DEV_MODE (Req 8.3).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import { hashVisitorToken } from '../anonymize.js'
import type { Report } from '../types.js'

// The generator resolves the anonymization salt via requireEnv with this dev
// default (AREA_CODE_ENV defaults to 'dev' in the test process, so the default
// applies). The previous-period tokens must be hashed with the SAME salt so
// they intersect the current visitors the generator derives internally.
const SALT = 'dev-anonymization-salt'

// ─── Mutable mock state + doubles (vi.hoisted) ───────────────────────────────

const h = vi.hoisted(() => {
  const state = {
    businessNodes: [] as Array<{ nodeId: string; name: string }>,
    checkInsByNode: new Map<string, Array<Record<string, unknown>>>(),
    userRecords: new Map<string, Record<string, unknown>>(),
    // Previous-period stub returned by getPreviousReport.
    previousReport: null as Report | null,
    previousTokens: [] as string[],
  }

  const USERS_TABLE = 'users'

  const sendMock = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const name = cmd.constructor.name
    const input = cmd.input ?? {}

    if (name === 'QueryCommand') {
      const values = (input['ExpressionAttributeValues'] ?? {}) as Record<string, unknown>
      // getBusinessNodes: the business's own nodes.
      if (input['IndexName'] === 'BusinessIndex') {
        return { Items: state.businessNodes.map((n) => ({ nodeId: n.nodeId, name: n.name })) }
      }
      // loadCheckInsForNode: check-ins for a node in the period.
      if (input['IndexName'] === 'NodeIndex') {
        const nodeId = values[':nodeId'] as string
        return { Items: state.checkInsByNode.get(nodeId) ?? [] }
      }
      // loadCategoryVenueMetrics / journey city lookup: single node by id.
      // Returns the node with a cityId so downstream city queries run and then
      // find no comparable venues (benchmarks/journey stay insufficient — light).
      if (typeof input['KeyConditionExpression'] === 'string' && !input['IndexName']) {
        const kc = input['KeyConditionExpression'] as string
        if (kc.includes('nodeId')) {
          const nodeId = values[':nodeId'] as string
          return { Items: [{ nodeId, cityId: 'city-1', category: 'bar' }] }
        }
        // BIZ_METRICS lookup (pk begins_with LATEST) → none.
        return { Items: [] }
      }
      // LocationIndex: only our own node exists in the city → no comparables.
      if (input['IndexName'] === 'LocationIndex') {
        return {
          Items: state.businessNodes.map((n) => ({ nodeId: n.nodeId, businessId: BUSINESS_ID, cityId: 'city-1' })),
        }
      }
      return { Items: [] }
    }

    if (name === 'BatchGetCommand') {
      const requestItems = input['RequestItems'] as Record<string, { Keys: Array<{ userId: string }> }>
      const table = Object.keys(requestItems)[0]!
      const keys = requestItems[table]!.Keys
      const items = keys.map((k) => state.userRecords.get(k.userId)).filter((v): v is Record<string, unknown> => !!v)
      return { Responses: { [table]: items } }
    }

    return {}
  })

  const storeReportMock = vi.fn(async () => {})
  const storeReportTokensMock = vi.fn(async () => {})
  const storeBusinessMetricsMock = vi.fn(async () => {})
  const getPreviousReportMock = vi.fn(async () =>
    state.previousReport ? { report: state.previousReport, visitorTokens: state.previousTokens } : null,
  )
  const broadcastMock = vi.fn(async () => {})

  const BUSINESS_ID = 'biz-1'
  return {
    state,
    USERS_TABLE,
    BUSINESS_ID,
    sendMock,
    storeReportMock,
    storeReportTokensMock,
    storeBusinessMetricsMock,
    getPreviousReportMock,
    broadcastMock,
  }
})

const BUSINESS_ID = h.BUSINESS_ID

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: h.sendMock },
  TableNames: {
    appData: 'app-data',
    users: h.USERS_TABLE,
    nodes: 'nodes',
    checkins: 'checkins',
    rewards: 'rewards',
    businesses: 'businesses',
  },
  isConditionalCheckFailedError: (err: unknown): boolean =>
    (err as { name?: string } | null)?.name === 'ConditionalCheckFailedException',
}))

vi.mock('../repository.js', () => ({
  storeReport: h.storeReportMock,
  storeReportTokens: h.storeReportTokensMock,
  storeBusinessMetrics: h.storeBusinessMetricsMock,
  getPreviousReport: h.getPreviousReportMock,
}))

vi.mock('../../../shared/websocket/broadcast.js', () => ({ broadcastToRoom: h.broadcastMock }))

// The real PII scanner runs unmocked: it correctly treats the report's own
// structural identifiers (reportId/businessId/nodeId) as non-PII, so a clean
// aggregated report reaches storeReport. Person-identifying UUIDs (userId /
// cognitoSub) are anonymized to visitor tokens before the report is built.

import { generateReportNow } from '../generator.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CURRENT_USERS = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']
const PREVIOUS_PULSE_SCORE = 50

/**
 * Minimal-but-valid previous-period Report. Only the fields the generator reads
 * for the trend/repeat comparison matter (`summary.pulseScore`,
 * `summary.totalCheckIns`, `crowdComposition.totalUniqueVisitors`,
 * `repeatVisitors.repeatRate`).
 */
function buildPreviousReport(): Report {
  return {
    reportId: 'prev-report',
    businessId: BUSINESS_ID,
    schemaVersion: 'v1',
    periodType: 'weekly',
    periodStart: '2025-12-29',
    periodEnd: '2026-01-04',
    generatedAt: '2026-01-05T00:00:00Z',
    nodes: [{ nodeId: 'node-a', nodeName: 'Node A' }],
    summary: {
      totalCheckIns: 20,
      pulseState: 'warming',
      topGenre: 'amapiano',
      headlineRecommendation: 'Keep it up.',
      pulseScore: PREVIOUS_PULSE_SCORE, // the real prior value that must flow through
    },
    peakHours: {
      hourlyDistribution: {},
      dailyDistribution: {},
      topWindows: [],
      peakDay: null,
      hasInsufficientData: true,
    },
    crowdComposition: {
      tierPercentages: {},
      tierUniqueCounts: {},
      totalUniqueVisitors: 10,
      hasInsufficientData: false,
    },
    musicProfile: null,
    repeatVisitors: { repeatRate: 40, firstTimeVisitorCount: 6, totalUniqueVisitors: 10, hasPriorData: true },
    trends: { metrics: {}, hasPriorData: false },
    benchmarks: null,
    journeyInsights: null,
    recommendations: { recommendations: [{ type: 'general', text: 'Keep it up.' }] },
  }
}

beforeEach(() => {
  vi.clearAllMocks()

  h.state.businessNodes = [{ nodeId: 'node-a', name: 'Node A' }]
  h.state.checkInsByNode = new Map([
    [
      'node-a',
      CURRENT_USERS.map((userId, i) => ({
        userId,
        nodeId: 'node-a',
        tier: 'local',
        checkedInAt: `2026-01-0${5 + (i % 3)}T1${i}:00:00Z`,
      })),
    ],
  ])
  h.state.userRecords = new Map(CURRENT_USERS.map((userId) => [userId, { userId, tier: 'local' }]))

  h.state.previousReport = buildPreviousReport()
  // Previous tokens overlap the current visitors u1, u2, u3 (hashed with the
  // same salt the generator uses) → a real, non-zero repeat intersection.
  h.state.previousTokens = ['u1', 'u2', 'u3'].map((u) => hashVisitorToken(u, SALT))
})

function generatedReport(): Report {
  expect(h.storeReportMock).toHaveBeenCalledTimes(1)
  return (h.storeReportMock.mock.calls[0] as unknown as [Report])[0]
}

// ─── Behavioral assertions ────────────────────────────────────────────────────

describe('generator flows the real previous pulse score (no hardcoded 0 baseline)', () => {
  it('pulseScore trend compares against the stored prior value, not a 0 baseline producing +100%', async () => {
    const result = await generateReportNow(BUSINESS_ID, 'weekly', '2026-01-05', '2026-01-11')
    expect(result).toHaveProperty('reportId')

    const report = generatedReport()
    const pulseTrend = report.trends.metrics['pulseScore']!

    // The real prior value flowed through — not the hardcoded 0.
    expect(pulseTrend.previous).toBe(PREVIOUS_PULSE_SCORE)
    expect(pulseTrend.hasPriorData).toBe(true)

    // The fabricated "+100% up from a 0 baseline" anti-pattern is absent.
    const fabricatedPlus100 =
      pulseTrend.previous === 0 && pulseTrend.percentChange === 100 && pulseTrend.direction === 'up'
    expect(fabricatedPlus100).toBe(false)
  })
})

describe('generator flows the real previous visitor tokens (no unconditional empty set)', () => {
  it('repeat-visitor analysis reflects the prior tokens: hasPriorData true and a real non-zero repeat rate', async () => {
    await generateReportNow(BUSINESS_ID, 'weekly', '2026-01-05', '2026-01-11')

    const report = generatedReport()
    const repeat = report.repeatVisitors

    // Prior tokens were non-empty and intersected the current visitors.
    expect(repeat.hasPriorData).toBe(true)
    // 3 of 6 current visitors (u1,u2,u3) also appear in the prior set → 50%.
    expect(repeat.totalUniqueVisitors).toBe(6)
    expect(repeat.repeatRate).toBeCloseTo(50, 5)
    expect(repeat.repeatRate).toBeGreaterThan(0)
  })

  it('honest-absence: with no prior tokens the repeat rate is marked unavailable, not a fabricated 0%', async () => {
    h.state.previousTokens = []
    await generateReportNow(BUSINESS_ID, 'weekly', '2026-01-05', '2026-01-11')

    const report = generatedReport()
    // No prior tokens → hasPriorData false so the UI suppresses the metric,
    // rather than presenting the intersection-forced 0% as a real value.
    expect(report.repeatVisitors.hasPriorData).toBe(false)
  })
})
