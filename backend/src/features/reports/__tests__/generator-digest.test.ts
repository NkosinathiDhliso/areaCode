/**
 * Digest path in the report-generator worker (R3.1, R3.3, R6.1, R6.2).
 *
 * The weekly generation message runs the Weekly Attribution Digest alongside
 * the full report. These behavioural tests drive `generateReportNow` with
 * stubbed DynamoDB, repository, cross-feature reads, and business lookup, and
 * assert:
 *   - a weekly run computes and persists exactly one Digest_Row (R3.1, R6.1);
 *   - the Digest_Email seam is attempted only when the row is newly `written`,
 *     never on a `duplicate` replay (retry suppression, R3.1);
 *   - a quiet week (zero check-ins) still produces a Digest_Row rather than
 *     being skipped like the full report (R1.1);
 *   - a digest failure is logged and skipped, never aborting the record (R3.3).
 *
 * Runs under the standard `pnpm test` (default node env), never gated on
 * DEV_MODE.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mutable mock state + doubles (vi.hoisted) ───────────────────────────────

const h = vi.hoisted(() => {
  const BUSINESS_ID = 'biz-1'
  const state = {
    businessNodes: [] as Array<{ nodeId: string; name: string }>,
    checkInsByNode: new Map<string, Array<Record<string, unknown>>>(),
    userRecords: new Map<string, Record<string, unknown>>(),
    business: null as Record<string, unknown> | null,
    effectiveTier: 'starter' as string,
    persistResult: 'written' as 'written' | 'duplicate',
  }

  const USERS_TABLE = 'users'

  const sendMock = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const name = cmd.constructor.name
    const input = cmd.input ?? {}

    if (name === 'QueryCommand') {
      const values = (input['ExpressionAttributeValues'] ?? {}) as Record<string, unknown>
      if (input['IndexName'] === 'BusinessIndex') {
        return { Items: state.businessNodes.map((n) => ({ nodeId: n.nodeId, name: n.name })) }
      }
      if (input['IndexName'] === 'NodeIndex') {
        const nodeId = values[':nodeId'] as string
        return { Items: state.checkInsByNode.get(nodeId) ?? [] }
      }
      if (input['IndexName'] === 'LocationIndex') {
        return {
          Items: state.businessNodes.map((n) => ({ nodeId: n.nodeId, businessId: BUSINESS_ID, cityId: 'city-1' })),
        }
      }
      if (typeof input['KeyConditionExpression'] === 'string' && !input['IndexName']) {
        const kc = input['KeyConditionExpression'] as string
        if (kc.includes('nodeId')) {
          const nodeId = values[':nodeId'] as string
          return { Items: [{ nodeId, cityId: 'city-1', category: 'bar' }] }
        }
        return { Items: [] }
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

  return {
    state,
    USERS_TABLE,
    BUSINESS_ID,
    sendMock,
    storeReportMock: vi.fn(async () => {}),
    storeReportTokensMock: vi.fn(async () => {}),
    storeBusinessMetricsMock: vi.fn(async () => {}),
    getPreviousReportMock: vi.fn(async () => null),
    persistDigestMock: vi.fn(async (_row: import('../types.js').DigestRow) => state.persistResult),
    getLatestDigestMock: vi.fn(async () => null),
    markDigestEmailSentMock: vi.fn(async (_businessId: string, _weekStart: string) => {}),
    broadcastMock: vi.fn(async () => {}),
    getBusinessByIdMock: vi.fn(async () => state.business),
    getEffectiveTierMock: vi.fn(() => state.effectiveTier),
    sendReportReadyEmailMock: vi.fn(async () => {}),
    sendDigestEmailMock: vi.fn(async () => {}),
    getCheckInsByUserMock: vi.fn(async () => ({
      checkIns: [] as Array<Record<string, unknown>>,
      nextCursor: undefined,
    })),
    getRewardsByNodeIdMock: vi.fn(async () => [] as Array<Record<string, unknown>>),
    getRedemptionsByRewardIdMock: vi.fn(async () => [] as Array<Record<string, unknown>>),
    listGuestClaimsSinceMock: vi.fn(async () => [] as Array<Record<string, unknown>>),
    buildDigestCopySpy: vi.fn(() => ['digest line']),
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
  persistDigest: h.persistDigestMock,
  getLatestDigest: h.getLatestDigestMock,
  markDigestEmailSent: h.markDigestEmailSentMock,
}))

// Partial mock: keep the real computeDigest/digestWeekFor so the metrics and
// week arithmetic are exercised end to end; spy only on buildDigestCopy so the
// write-gated email seam is observable.
vi.mock('../digest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../digest.js')>()
  return { ...actual, buildDigestCopy: h.buildDigestCopySpy }
})

vi.mock('../../../shared/websocket/broadcast.js', () => ({ broadcastToRoom: h.broadcastMock }))
vi.mock('../../auth/dynamodb-repository.js', () => ({ getBusinessById: h.getBusinessByIdMock }))
vi.mock('../../business/service.js', () => ({ getEffectiveTier: h.getEffectiveTierMock }))
vi.mock('../../../shared/email/ses.js', () => ({
  sendReportReadyEmail: h.sendReportReadyEmailMock,
  sendDigestEmail: h.sendDigestEmailMock,
}))
vi.mock('../../check-in/dynamodb-repository.js', () => ({ getCheckInsByUser: h.getCheckInsByUserMock }))
vi.mock('../../rewards/dynamodb-repository.js', () => ({
  getRewardsByNodeId: h.getRewardsByNodeIdMock,
  getRedemptionsByRewardId: h.getRedemptionsByRewardIdMock,
}))
vi.mock('../../rewards/guest-claim.js', () => ({ listGuestClaimsSince: h.listGuestClaimsSinceMock }))

import { generateReportNow } from '../generator.js'
import type { DigestRow } from '../types.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CURRENT_USERS = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']

// periodEnd is the just-closed Sunday 23:59:59.999 SAST (UTC), strictly inside
// the SAST week opening Monday 2026-01-05 — so digestWeekFor(periodEnd) resolves
// weekStart = 2026-01-05.
const PERIOD_START = '2026-01-04T22:00:00.000Z' // Mon 2026-01-05 00:00 SAST
const PERIOD_END = '2026-01-11T21:59:59.999Z' // Sun 2026-01-11 23:59:59.999 SAST
const EXPECTED_WEEK_START = '2026-01-05'

function seedNormalWeek(): void {
  h.state.businessNodes = [{ nodeId: 'node-a', name: 'Node A' }]
  h.state.checkInsByNode = new Map([
    [
      'node-a',
      CURRENT_USERS.map((userId, i) => ({
        userId,
        nodeId: 'node-a',
        tier: 'local',
        checkedInAt: `2026-01-0${5 + (i % 3)}T1${i}:00:00.000Z`,
      })),
    ],
  ])
  h.state.userRecords = new Map(CURRENT_USERS.map((userId) => [userId, { userId, tier: 'local' }]))
}

beforeEach(() => {
  vi.clearAllMocks()
  seedNormalWeek()
  h.state.business = { email: 'owner@venue.co.za', businessName: 'Venue One', tier: 'starter' }
  h.state.effectiveTier = 'starter'
  h.state.persistResult = 'written'
  h.getCheckInsByUserMock.mockResolvedValue({ checkIns: [], nextCursor: undefined })
  h.getRewardsByNodeIdMock.mockResolvedValue([])
  h.getRedemptionsByRewardIdMock.mockResolvedValue([])
  h.listGuestClaimsSinceMock.mockResolvedValue([])
  h.getLatestDigestMock.mockResolvedValue(null)
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('digest path computes and persists a Digest_Row on a weekly run (R3.1, R6.1)', () => {
  it('persists exactly one Digest_Row for the just-closed week with the computed metrics', async () => {
    await generateReportNow(BUSINESS_ID, 'weekly', PERIOD_START, PERIOD_END)

    expect(h.persistDigestMock).toHaveBeenCalledTimes(1)
    const row = h.persistDigestMock.mock.calls[0]![0] as DigestRow
    expect(row.businessId).toBe(BUSINESS_ID)
    expect(row.weekStart).toBe(EXPECTED_WEEK_START)
    expect(row.metrics.visits).toBe(CURRENT_USERS.length)
    expect(row.metrics.uniqueVisitors).toBe(CURRENT_USERS.length)
    expect(row.tierAtBuild).toBe('starter')
    expect(row.emailSent).toBe(false)
    // No prior row → no deltas.
    expect(row.deltas).toBeUndefined()
  })

  it('does not run the digest path for a monthly generation', async () => {
    await generateReportNow(BUSINESS_ID, 'monthly', '2026-01-01', '2026-01-31')
    expect(h.persistDigestMock).not.toHaveBeenCalled()
  })
})

describe('Digest_Email is sent only when the row is newly written (R4.2)', () => {
  it('sends the digest email on a written row with the venue name, headline visits, and copy lines', async () => {
    h.state.persistResult = 'written'
    await generateReportNow(BUSINESS_ID, 'weekly', PERIOD_START, PERIOD_END)

    expect(h.persistDigestMock).toHaveBeenCalledTimes(1)
    expect(h.buildDigestCopySpy).toHaveBeenCalledTimes(1)
    // Sent from the shared copy strings (one source of truth, R4.3): venue name,
    // headline visit count for the subject, and the built copy lines as body.
    expect(h.sendDigestEmailMock).toHaveBeenCalledTimes(1)
    expect(h.sendDigestEmailMock).toHaveBeenCalledWith('owner@venue.co.za', 'Venue One', CURRENT_USERS.length, [
      'digest line',
    ])
  })

  it('flips emailSent to true after a successful send (R7.3)', async () => {
    h.state.persistResult = 'written'
    await generateReportNow(BUSINESS_ID, 'weekly', PERIOD_START, PERIOD_END)

    // The row was persisted with emailSent:false, then flipped by a separate
    // best-effort update keyed on businessId + weekStart once the send succeeded.
    const row = h.persistDigestMock.mock.calls[0]![0] as DigestRow
    expect(row.emailSent).toBe(false)
    expect(h.markDigestEmailSentMock).toHaveBeenCalledTimes(1)
    expect(h.markDigestEmailSentMock).toHaveBeenCalledWith(BUSINESS_ID, EXPECTED_WEEK_START)
  })

  it('suppresses the email on a duplicate replay (R3.1)', async () => {
    h.state.persistResult = 'duplicate'
    await generateReportNow(BUSINESS_ID, 'weekly', PERIOD_START, PERIOD_END)

    expect(h.persistDigestMock).toHaveBeenCalledTimes(1)
    expect(h.buildDigestCopySpy).not.toHaveBeenCalled()
    expect(h.sendDigestEmailMock).not.toHaveBeenCalled()
    // No send → no flip; emailSent stays false.
    expect(h.markDigestEmailSentMock).not.toHaveBeenCalled()
  })
})

describe('Digest_Optout suppresses the email but not the row (R4.5)', () => {
  it('persists the Digest_Row but skips the send when digestEmailOptOut is set', async () => {
    h.state.persistResult = 'written'
    h.state.business = { email: 'owner@venue.co.za', businessName: 'Venue One', digestEmailOptOut: true }

    await generateReportNow(BUSINESS_ID, 'weekly', PERIOD_START, PERIOD_END)

    expect(h.persistDigestMock).toHaveBeenCalledTimes(1)
    expect(h.sendDigestEmailMock).not.toHaveBeenCalled()
    // Opt-out means no send, so emailSent is never flipped.
    expect(h.markDigestEmailSentMock).not.toHaveBeenCalled()
  })
})

describe('a missing business email skips the send but retains the row (R4.4)', () => {
  it('does not send when the business row has no email', async () => {
    h.state.persistResult = 'written'
    h.state.business = { businessName: 'Venue One' }

    await generateReportNow(BUSINESS_ID, 'weekly', PERIOD_START, PERIOD_END)

    expect(h.persistDigestMock).toHaveBeenCalledTimes(1)
    expect(h.sendDigestEmailMock).not.toHaveBeenCalled()
    // No address to send to → no flip.
    expect(h.markDigestEmailSentMock).not.toHaveBeenCalled()
  })
})

describe('a Digest_Email send failure never aborts the record or loses the row (R4.4)', () => {
  it('completes the full report even when sendDigestEmail throws', async () => {
    h.state.persistResult = 'written'
    h.sendDigestEmailMock.mockRejectedValueOnce(new Error('SES throttled'))

    const result = await generateReportNow(BUSINESS_ID, 'weekly', PERIOD_START, PERIOD_END)

    // The row was persisted before the send, and the failure is swallowed and
    // logged so the full report still generates and stores.
    expect(h.persistDigestMock).toHaveBeenCalledTimes(1)
    expect(h.sendDigestEmailMock).toHaveBeenCalledTimes(1)
    // The send failed, so emailSent is not flipped — the field stays honest.
    expect(h.markDigestEmailSentMock).not.toHaveBeenCalled()
    expect(result).toHaveProperty('reportId')
    expect(h.storeReportMock).toHaveBeenCalledTimes(1)
  })

  it('swallows a failed flip after a successful send (R7.3 best-effort)', async () => {
    h.state.persistResult = 'written'
    h.markDigestEmailSentMock.mockRejectedValueOnce(new Error('DynamoDB throttled'))

    const result = await generateReportNow(BUSINESS_ID, 'weekly', PERIOD_START, PERIOD_END)

    // The email sent, the flip failed, but the record still completes: a failed
    // flip never throws, rolls back, or resends.
    expect(h.sendDigestEmailMock).toHaveBeenCalledTimes(1)
    expect(h.markDigestEmailSentMock).toHaveBeenCalledTimes(1)
    expect(result).toHaveProperty('reportId')
    expect(h.storeReportMock).toHaveBeenCalledTimes(1)
  })
})

describe('quiet week still produces a Digest_Row (R1.1)', () => {
  it('persists a zero-visits Digest_Row even though the full report is skipped', async () => {
    h.state.checkInsByNode = new Map() // no check-ins anywhere

    const result = await generateReportNow(BUSINESS_ID, 'weekly', PERIOD_START, PERIOD_END)

    // Full report skips a zero-check-in week...
    expect(result).toEqual({ skipped: 'no_check_ins' })
    // ...but the digest is still computed and persisted, honestly zeroed.
    expect(h.persistDigestMock).toHaveBeenCalledTimes(1)
    const row = h.persistDigestMock.mock.calls[0]![0] as DigestRow
    expect(row.weekStart).toBe(EXPECTED_WEEK_START)
    expect(row.metrics.visits).toBe(0)
    expect(row.metrics.uniqueVisitors).toBe(0)
  })
})

describe('digest failure is logged and skipped, never aborting the record (R3.3)', () => {
  it('completes the full report even when persistDigest throws', async () => {
    h.persistDigestMock.mockRejectedValueOnce(new Error('DynamoDB unavailable'))

    const result = await generateReportNow(BUSINESS_ID, 'weekly', PERIOD_START, PERIOD_END)

    // The full report still generated and stored despite the digest failure.
    expect(result).toHaveProperty('reportId')
    expect(h.storeReportMock).toHaveBeenCalledTimes(1)
  })
})
