/**
 * Dev-environment rehearsal for the Weekly Attribution Digest (task 8.1).
 *
 * Validates: Requirements 3.1, 4.2, 6.1
 *
 * ─── What this stands in for ─────────────────────────────────────────────────
 *
 * The spec's task 8.1 is "run the weekly pass in dev end to end" and verify the
 * five checkpoints below. A live dev deploy (real DynamoDB, real SES sandbox,
 * the real EventBridge Monday trigger) cannot run inside the automated suite, so
 * this file is the durable, replayable evidence for that rehearsal: it wires the
 * REAL pipeline modules together over one seeded business-week and its replay.
 *
 *   1. A Digest_Row is produced and persisted for a seeded business-week.
 *   2. The Digest_Email send is ATTEMPTED (captured by the SES seam) on a
 *      newly-written row (R4.2).
 *   3. The dashboard card data path (GET /v1/business/digest/latest via the
 *      business service `getLatestDigestView`) returns the metrics + copy for
 *      that same persisted row (R4.1 read that the card renders).
 *   4. Opt-out suppression: with `digestEmailOptOut=true`, the row is still
 *      written but NO Digest_Email is sent (R4.5).
 *   5. Replay: running the weekly pass again over the SAME week produces NO
 *      duplicate row and NO second email (R3.1 idempotence).
 *
 * ─── Fidelity: what is real vs mocked ────────────────────────────────────────
 *
 * REAL (exercised end to end):
 *   - the generator digest path (`generateReportNow` → `runDigestPath`);
 *   - the pure core (`computeDigest`, `buildDigestCopy`, `digestWeekFor`);
 *   - the reports repository (`persistDigest` conditional put, `getLatestDigest`,
 *     `queryDigestHistory`) and its PII scan;
 *   - the business read-view service (`getLatestDigestView` / `getDigestHistoryView`).
 *
 * The generator's WRITE and the business service's READ go through the SAME
 * in-memory app-data table, so this proves the row the pipeline persists is the
 * exact row the dashboard card path reads back, and that the real conditional
 * write returns `duplicate` on replay.
 *
 * MOCKED (an environment seam, not domain logic):
 *   - DynamoDB (`documentClient.send`), backed by an in-memory table that models
 *     the `attribute_not_exists(pk)` conditional put;
 *   - SES (`sendDigestEmail` etc.), so the send attempt is observable;
 *   - the cross-feature reads the digest joins against (check-in history for
 *     first-timer detection, rewards/redemptions, guest-claim First-Get rows,
 *     the business row lookup).
 *
 * ─── What a human must still verify in a real dev deploy ──────────────────────
 *
 * This cannot cover (out of scope for an automated run, verify manually in dev):
 *   - actual SES sandbox email delivery (message lands in the inbox, subject and
 *     body render, no PII leaks in the real MIME payload);
 *   - the real EventBridge Monday-22:00-UTC trigger firing the dispatcher;
 *   - the DynamoDB conditional write against the real app-data table.
 *
 * Runs under the standard `pnpm test` (default node env), never gated on
 * DEV_MODE.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

import { BANNED_CAUSAL_VERBS } from '../digest.js'

// ─── Mutable state, in-memory DynamoDB, and cross-feature seams (vi.hoisted) ──

const h = vi.hoisted(() => {
  const BUSINESS_ID = 'biz-rehearsal-1'
  const NODE_ID = 'node-rehearsal-a'

  const state = {
    business: null as Record<string, unknown> | null,
    businessNodes: [] as Array<{ nodeId: string; name: string }>,
    checkInsByNode: new Map<string, Array<Record<string, unknown>>>(),
    userRecords: new Map<string, Record<string, unknown>>(),
    // Cross-feature read seams the digest joins against.
    redemptionsByReward: new Map<string, Array<Record<string, unknown>>>(),
    rewardsByNode: new Map<string, Array<Record<string, unknown>>>(),
    guestClaims: [] as Array<Record<string, unknown>>,
  }

  // In-memory app-data table keyed by `${pk}\u0000${sk}`. Backs the REAL reports
  // repository so the generator's write and the business service's read share
  // one store. Models the conditional put the digest idempotency relies on.
  const appData = new Map<string, Record<string, unknown>>()
  const appKey = (pk: string, sk: string): string => `${pk}\u0000${sk}`

  const sendMock = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const name = cmd.constructor.name
    const input = cmd.input ?? {}
    const values = (input['ExpressionAttributeValues'] ?? {}) as Record<string, unknown>

    if (name === 'PutCommand') {
      // Only the app-data table receives puts in this pipeline (digest rows and
      // the full-report companion rows). Model attribute_not_exists(pk) for the
      // digest conditional write; unconditional puts overwrite.
      const item = input['Item'] as Record<string, unknown>
      const pk = item['pk'] as string
      const sk = item['sk'] as string
      const key = appKey(pk, sk)
      const condition = input['ConditionExpression'] as string | undefined
      if (condition?.includes('attribute_not_exists(pk)') && appData.has(key)) {
        const err = new Error('The conditional request failed') as Error & { name: string }
        err.name = 'ConditionalCheckFailedException'
        throw err
      }
      appData.set(key, item)
      return {}
    }

    if (name === 'GetCommand') {
      const keyObj = input['Key'] as { pk: string; sk: string }
      const item = appData.get(appKey(keyObj.pk, keyObj.sk))
      return item ? { Item: item } : {}
    }

    if (name === 'QueryCommand') {
      // Synthetic entity tables (nodes / check-ins) resolved by GSI first.
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
      if (input['IndexName'] === 'GSI1') {
        // Report listing GSI — not exercised by the digest rehearsal.
        return { Items: [] }
      }

      // Non-index primary-key queries on app-data (digest partition) or nodes.
      const kc = (input['KeyConditionExpression'] as string) ?? ''
      if (kc.includes('nodeId') && !kc.includes('pk')) {
        // loadCategoryVenueMetrics first-node lookup on the nodes table.
        const nodeId = values[':nodeId'] as string
        return { Items: [{ nodeId, cityId: 'city-1', category: 'bar' }] }
      }
      if (kc.includes('pk')) {
        const pk = values[':pk'] as string
        // begins_with(sk, :prefix) benchmark cache query → not seeded, empty.
        if (pk.startsWith('BIZ_METRICS#')) return { Items: [] }
        // Digest partition query (Latest / History): newest-first by sk.
        const matches = [...appData.values()]
          .filter((item) => item['pk'] === pk)
          .sort((a, b) => String(b['sk']).localeCompare(String(a['sk'])))
        const forward = input['ScanIndexForward'] as boolean | undefined
        const ordered = forward === false ? matches : [...matches].reverse()
        const limit = input['Limit'] as number | undefined
        return { Items: limit ? ordered.slice(0, limit) : ordered }
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
    BUSINESS_ID,
    NODE_ID,
    state,
    appData,
    sendMock,
    // Cross-feature read seams.
    getBusinessByIdMock: vi.fn(async () => state.business),
    getCheckInsByUserMock: vi.fn(async (userId: string) => {
      // The digest first-timer detector reads a visitor's full check-in history
      // at any of the business's nodes. Empty history → treated as first-timer.
      void userId
      return { checkIns: [] as Array<Record<string, unknown>>, nextCursor: undefined as string | undefined }
    }),
    getRewardsByNodeIdMock: vi.fn(async (nodeId: string) => state.rewardsByNode.get(nodeId) ?? []),
    getRedemptionsByRewardIdMock: vi.fn(async (rewardId: string) => state.redemptionsByReward.get(rewardId) ?? []),
    listGuestClaimsSinceMock: vi.fn(async () => state.guestClaims),
    // SES seams (four exports so both generator and business service resolve).
    // The digest sender is typed to its real signature so the captured call
    // tuple destructures with proper types.
    sendDigestEmailMock: vi.fn(
      async (_to: string, _venueName: string, _headlineVisits: number, _copyLines: string[]) => {},
    ),
    sendReportReadyEmailMock: vi.fn(async () => {}),
    sendRenewalReminderEmailMock: vi.fn(async () => {}),
    sendRenewalUpcomingEmailMock: vi.fn(async () => {}),
    broadcastMock: vi.fn(async () => {}),
  }
})

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: h.sendMock },
  TableNames: {
    appData: 'app-data',
    users: 'users',
    nodes: 'nodes',
    checkins: 'checkins',
    rewards: 'rewards',
    businesses: 'businesses',
  },
  isConditionalCheckFailedError: (err: unknown): boolean =>
    (err as { name?: string } | null)?.name === 'ConditionalCheckFailedException',
}))

vi.mock('../../auth/dynamodb-repository.js', () => ({ getBusinessById: h.getBusinessByIdMock }))
vi.mock('../../check-in/dynamodb-repository.js', () => ({ getCheckInsByUser: h.getCheckInsByUserMock }))
vi.mock('../../rewards/dynamodb-repository.js', () => ({
  getRewardsByNodeId: h.getRewardsByNodeIdMock,
  getRedemptionsByRewardId: h.getRedemptionsByRewardIdMock,
}))
vi.mock('../../rewards/guest-claim.js', () => ({ listGuestClaimsSince: h.listGuestClaimsSinceMock }))
vi.mock('../../../shared/email/ses.js', () => ({
  sendDigestEmail: h.sendDigestEmailMock,
  sendReportReadyEmail: h.sendReportReadyEmailMock,
  sendRenewalReminderEmail: h.sendRenewalReminderEmailMock,
  sendRenewalUpcomingEmail: h.sendRenewalUpcomingEmailMock,
}))
vi.mock('../../../shared/websocket/broadcast.js', () => ({ broadcastToRoom: h.broadcastMock }))

const BUSINESS_ID = h.BUSINESS_ID
const NODE_ID = h.NODE_ID

// The REAL modules under rehearsal are loaded after the env is set so their
// module-load config guards (assertPaymentConfig, requireEnv) take the dev path.
let generator: typeof import('../generator.js')
let businessService: typeof import('../../business/service.js')

// ─── Seeded business-week ─────────────────────────────────────────────────────
//
// periodEnd is the just-closed Sunday 23:59:59.999 SAST, strictly inside the
// SAST week opening Monday 2026-01-05 — so digestWeekFor(periodEnd) resolves the
// weekStart to 2026-01-05 (the generator derives the week from periodEnd).
const PERIOD_START = '2026-01-04T22:00:00.000Z' // Mon 2026-01-05 00:00 SAST
const PERIOD_END = '2026-01-11T21:59:59.999Z' // Sun 2026-01-11 23:59:59.999 SAST
const EXPECTED_WEEK_START = '2026-01-05'

// Eight distinct visitors, all first-timers (empty prior history), so the week
// is comfortably above the Suppression_Floor of 5 and renders derived shares.
const VISITORS = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8']

function seedBusinessWeek(): void {
  h.state.business = {
    businessId: BUSINESS_ID,
    email: 'owner@rehearsal.co.za',
    businessName: 'Rehearsal Venue',
    tier: 'starter',
  }
  h.state.businessNodes = [{ nodeId: NODE_ID, name: 'Rehearsal Node' }]
  h.state.checkInsByNode = new Map([
    [
      NODE_ID,
      VISITORS.map((userId, i) => ({
        userId,
        nodeId: NODE_ID,
        tier: 'local',
        // Spread across Mon–Wed of the seeded week, valid ISO in-window instants.
        checkedInAt: `2026-01-0${5 + (i % 3)}T1${i % 10}:30:00.000Z`,
      })),
    ],
  ])
  h.state.userRecords = new Map(VISITORS.map((userId) => [userId, { userId, tier: 'local' }]))
  // First-Get rows: one issued and one converted inside the window (R1.4).
  h.state.guestClaims = [
    { nodeId: NODE_ID, issuedAt: '2026-01-06T10:00:00.000Z', redeemedAt: undefined },
    { nodeId: NODE_ID, issuedAt: '2025-12-20T10:00:00.000Z', redeemedAt: '2026-01-07T12:00:00.000Z' },
  ]
}

beforeAll(async () => {
  // Live read paths (DEV_MODE off) while the config guards take the dev branch,
  // mirroring digest-view-service.test.ts. Loaded here so env is set pre-import.
  process.env['AREA_CODE_ENV'] = 'dev'
  process.env['AREA_CODE_FORCE_LIVE'] = '1'
  generator = await import('../generator.js')
  businessService = await import('../../business/service.js')
})

afterAll(() => {
  delete process.env['AREA_CODE_FORCE_LIVE']
})

beforeEach(() => {
  vi.clearAllMocks()
  h.appData.clear()
  seedBusinessWeek()
})

// ─── The rehearsal ─────────────────────────────────────────────────────────────

describe('Weekly Attribution Digest — dev rehearsal end to end (R3.1, R4.2, R6.1)', () => {
  it('checkpoints 1-3 & 5: one weekly pass persists a row, attempts the email, the card path reads it back, and replay is idempotent', async () => {
    // ── Checkpoint 1: the weekly pass persists exactly one Digest_Row ─────────
    await generator.generateReportNow(BUSINESS_ID, 'weekly', PERIOD_START, PERIOD_END)

    const digestRows = [...h.appData.values()].filter((item) => String(item['pk']).startsWith('DIGEST#'))
    expect(digestRows).toHaveLength(1)
    expect(digestRows[0]!['pk']).toBe(`DIGEST#${BUSINESS_ID}`)
    expect(digestRows[0]!['sk']).toBe(`WEEK#${EXPECTED_WEEK_START}`)
    expect(digestRows[0]!['weekStart']).toBe(EXPECTED_WEEK_START)

    // ── Checkpoint 2: the Digest_Email send was attempted on the written row ──
    expect(h.sendDigestEmailMock).toHaveBeenCalledTimes(1)
    const [to, venueName, headlineVisits, copyLines] = h.sendDigestEmailMock.mock.calls[0]!
    expect(to).toBe('owner@rehearsal.co.za')
    expect(venueName).toBe('Rehearsal Venue')
    expect(headlineVisits).toBe(VISITORS.length)
    expect(Array.isArray(copyLines)).toBe(true)
    expect(copyLines.length).toBeGreaterThan(0)

    // ── Checkpoint 3: the dashboard card data path reads the SAME row back ────
    // getLatestDigestView reads through the real reports repository against the
    // same in-memory store the generator just wrote (one source of truth).
    const view = await businessService.getLatestDigestView(BUSINESS_ID)
    expect(view.digest).not.toBeNull()
    const card = view.digest!
    expect(card.weekStart).toBe(EXPECTED_WEEK_START)
    expect(card.metrics.visits).toBe(VISITORS.length)
    expect(card.metrics.uniqueVisitors).toBe(VISITORS.length)
    // Empty prior history → every unique visitor is a first-timer (R1.3).
    expect(card.metrics.firstTimeVisitors).toBe(VISITORS.length)
    expect(card.metrics.returningVisitors).toBe(0)
    // First-Get counts joined from the guest-claim rows (R1.4).
    expect(card.metrics.firstGetIssued).toBe(1)
    expect(card.metrics.firstGetConversions).toBe(1)
    // The card renders copy, and the copy is Honest_Framing clean (no causal verbs).
    expect(card.copy.length).toBeGreaterThan(0)
    expect(card.copy.some((line) => line.includes('recorded through Area Code'))).toBe(true)
    for (const line of card.copy) {
      for (const verb of BANNED_CAUSAL_VERBS) {
        expect(line.toLowerCase()).not.toContain(verb)
      }
    }
    // The card copy is the SAME ordered copy the email was handed (R4.3).
    expect(card.copy).toEqual(copyLines)

    // ── Checkpoint 5: replay the SAME week — no duplicate row, no second email ─
    await generator.generateReportNow(BUSINESS_ID, 'weekly', PERIOD_START, PERIOD_END)

    const rowsAfterReplay = [...h.appData.values()].filter((item) => String(item['pk']).startsWith('DIGEST#'))
    expect(rowsAfterReplay).toHaveLength(1)
    // No second Digest_Email dispatched across the replay (retry suppression).
    expect(h.sendDigestEmailMock).toHaveBeenCalledTimes(1)
  })

  it('checkpoint 4: opt-out suppresses the email but the row is still written and readable', async () => {
    h.state.business = {
      businessId: BUSINESS_ID,
      email: 'owner@rehearsal.co.za',
      businessName: 'Rehearsal Venue',
      tier: 'starter',
      digestEmailOptOut: true,
    }

    await generator.generateReportNow(BUSINESS_ID, 'weekly', PERIOD_START, PERIOD_END)

    // Row is persisted regardless of the opt-out (the card always renders).
    const digestRows = [...h.appData.values()].filter((item) => String(item['pk']).startsWith('DIGEST#'))
    expect(digestRows).toHaveLength(1)
    const view = await businessService.getLatestDigestView(BUSINESS_ID)
    expect(view.digest?.weekStart).toBe(EXPECTED_WEEK_START)
    expect(view.digest?.metrics.visits).toBe(VISITORS.length)

    // ...but no Digest_Email is sent (R4.5).
    expect(h.sendDigestEmailMock).not.toHaveBeenCalled()
  })
})
