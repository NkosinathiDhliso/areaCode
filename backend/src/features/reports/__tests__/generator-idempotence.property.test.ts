/**
 * Feature: weekly-attribution-digest, Property 4: Generation idempotence.
 *
 * **Validates: Requirements 3.1**
 *
 * For any replay schedule of the weekly pass over the SAME business-week,
 * exactly one Digest_Row exists per business-week and at most one Digest_Email
 * dispatch is attempted. Mirrors the billing activation idempotence style
 * (`business/__tests__/subscription-idempotence.property.test.ts`).
 *
 * ─── Strategy ───────────────────────────────────────────────────────────────
 *
 * The unit under test is the generator's digest path (`runDigestPath`, reached
 * through the one exported entry point `generateReportNow`). `../repository.js`
 * is mocked; `persistDigest` is backed by a stateful in-memory store that
 * models the real DynamoDB conditional put keyed by `(businessId, weekStart)`:
 *   - the FIRST put for a business-week lands the row and returns `'written'`;
 *   - every subsequent put for the SAME business-week is a no-op and returns
 *     `'duplicate'`.
 * This reflects the true `attribute_not_exists(pk)` conditional-write semantics
 * that `putDigestRow` relies on, so idempotence is exercised at the layer the
 * design makes responsible for it (R3.1).
 *
 * The Digest_Email seam is `buildDigestCopy` (the generator builds the shared
 * copy strings and would hand them to SES only on a `'written'` row). It is
 * spied so "email dispatch attempted" is directly observable; the full-report
 * path's own `sendReportReadyEmail` is a different channel and is not counted.
 *
 * A replay schedule is an arbitrary sequence of weekly generation invocations
 * for one business over one week. Each invocation carries a `periodEnd` instant
 * that varies across the week but always resolves (via `digestWeekFor`) to the
 * same `weekStart`, so the runs are genuine replays of the same business-week.
 *
 * Runs under the standard `pnpm test` (default node env), never gated on
 * DEV_MODE.
 */

import * as fc from 'fast-check'
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
    // Stateful conditional-put store keyed by `${businessId}#${weekStart}`,
    // modelling attribute_not_exists(pk): first put per business-week lands the
    // row ('written'); every replay for the same key is a no-op ('duplicate').
    digestStore: new Map<string, import('../types.js').DigestRow>(),
    writtenCount: 0,
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

  // The stateful conditional-put. Mirrors putDigestRow's contract exactly.
  const persistDigestMock = vi.fn(async (row: import('../types.js').DigestRow) => {
    const key = `${row.businessId}#${row.weekStart}`
    if (state.digestStore.has(key)) return 'duplicate' as const
    state.digestStore.set(key, row)
    state.writtenCount++
    return 'written' as const
  })

  return {
    state,
    USERS_TABLE,
    BUSINESS_ID,
    sendMock,
    persistDigestMock,
    storeReportMock: vi.fn(async () => {}),
    storeReportTokensMock: vi.fn(async () => {}),
    storeBusinessMetricsMock: vi.fn(async () => {}),
    getPreviousReportMock: vi.fn(async () => null),
    getLatestDigestMock: vi.fn(async () => null),
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
    // The Digest_Email seam: called once per newly-written row.
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
}))

// Partial mock: keep the real computeDigest/digestWeekFor so week arithmetic
// and metrics run end to end; spy only on buildDigestCopy so the write-gated
// Digest_Email seam is observable.
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
import { digestWeekFor } from '../digest.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CURRENT_USERS = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']

// The Digest_Week under replay: Monday 2026-01-05 00:00 SAST opens the window
// at 2026-01-04T22:00:00.000Z UTC. Every periodEnd instant strictly after the
// opening boundary and at or before the following Monday 00:00 SAST resolves
// (via digestWeekFor) to this same weekStart, which is what makes the schedule
// a genuine replay of one business-week.
const WINDOW_OPEN_UTC_MS = Date.parse('2026-01-04T22:00:00.000Z')
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const EXPECTED_WEEK_START = '2026-01-05'

// periodStart is constant (the digest path derives the week from periodEnd, not
// periodStart, and the mocked check-in read ignores the period filter).
const PERIOD_START = '2026-01-04T22:00:00.000Z'

function seedWeek(): void {
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
  seedWeek()
  h.state.business = { email: 'owner@venue.co.za', businessName: 'Venue One', tier: 'starter' }
  h.state.effectiveTier = 'starter'
  h.state.digestStore.clear()
  h.state.writtenCount = 0
  h.getCheckInsByUserMock.mockResolvedValue({ checkIns: [], nextCursor: undefined })
  h.getRewardsByNodeIdMock.mockResolvedValue([])
  h.getRedemptionsByRewardIdMock.mockResolvedValue([])
  h.listGuestClaimsSinceMock.mockResolvedValue([])
  h.getLatestDigestMock.mockResolvedValue(null)
})

// ─── Arbitraries ──────────────────────────────────────────────────────────────

// An offset (ms) into the Digest_Week for a replay's periodEnd instant. Strictly
// after the opening boundary (1ms) and at or before the following Monday 00:00
// SAST (WEEK_MS); every value resolves to EXPECTED_WEEK_START.
const periodEndOffsetArb = fc.integer({ min: 1, max: WEEK_MS })

// A replay schedule: 1..10 weekly generation invocations for the same
// business-week, each with its own in-week periodEnd instant.
const scheduleArb = fc.array(periodEndOffsetArb, { minLength: 1, maxLength: 10 })

// ─── Property 4 ────────────────────────────────────────────────────────────────

describe('Feature: weekly-attribution-digest, Property 4: Generation idempotence', () => {
  it('one Digest_Row and at most one email attempt per business-week under replay (R3.1)', async () => {
    await fc.assert(
      fc.asyncProperty(scheduleArb, async (offsets) => {
        // Reset the conditional-put store and the email seam for this run.
        h.state.digestStore.clear()
        h.state.writtenCount = 0
        h.persistDigestMock.mockClear()
        h.buildDigestCopySpy.mockClear()
        h.sendDigestEmailMock.mockClear()

        // Every instant in the schedule must resolve to the one business-week
        // (guards the arbitrary: a drifting week would invalidate the replay).
        for (const offset of offsets) {
          const periodEnd = new Date(WINDOW_OPEN_UTC_MS + offset).toISOString()
          expect(digestWeekFor(periodEnd).weekStartIso).toBe(EXPECTED_WEEK_START)
        }

        // Drive the weekly pass once per replay in the schedule.
        for (const offset of offsets) {
          const periodEnd = new Date(WINDOW_OPEN_UTC_MS + offset).toISOString()
          await generateReportNow(BUSINESS_ID, 'weekly', PERIOD_START, periodEnd)
        }

        // ── Invariant 1: exactly ONE Digest_Row for the business-week ─────────
        // The store holds exactly one row, keyed at the expected business-week,
        // and the conditional put landed a row exactly once across all replays.
        expect(h.state.digestStore.size).toBe(1)
        expect(h.state.digestStore.has(`${BUSINESS_ID}#${EXPECTED_WEEK_START}`)).toBe(true)
        expect(h.state.writtenCount).toBe(1)

        // ── Invariant 2: AT MOST ONE Digest_Email dispatch attempted ──────────
        // The email seam fires only on the newly-written row; every replay after
        // is a duplicate no-op. With a non-empty schedule the first run always
        // writes, so the attempt count is exactly one.
        expect(h.buildDigestCopySpy.mock.calls.length).toBeLessThanOrEqual(1)
        expect(h.buildDigestCopySpy).toHaveBeenCalledTimes(1)
        // The actual SES dispatch fires only on the newly-written row too, so
        // at most one Digest_Email is ever sent across the whole replay.
        expect(h.sendDigestEmailMock.mock.calls.length).toBeLessThanOrEqual(1)
        expect(h.sendDigestEmailMock).toHaveBeenCalledTimes(1)
      }),
      { numRuns: 100 },
    )
  }, 60_000)
})
