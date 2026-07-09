/**
 * Report-ready notification delivery on the live path (R9.1, R9.3).
 *
 * The generator delivers Report_Ready_Notifications through the existing
 * delivered channels (WebSocket + SES email), replacing the enqueue to the
 * consumer-less `push-sender` SQS queue. These tests assert:
 *   - R9.1: on a successful generation the SES report-ready email is sent to
 *     the business's resolved email + name, and the WebSocket broadcast fires.
 *   - R9.3: when email delivery throws, the failure is swallowed (logged) and
 *     report persistence still completes (storeReport was already called).
 *
 * Behavioral test: it drives `generateReportNow` with stubbed DynamoDB,
 * repository, WebSocket, business lookup, and SES doubles. Runs under the
 * standard `pnpm test` (default node env), never gated behind DEV_MODE.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── Mutable mock state + doubles (vi.hoisted) ───────────────────────────────

const h = vi.hoisted(() => {
  const BUSINESS_ID = 'biz-1'
  const state = {
    businessNodes: [] as Array<{ nodeId: string; name: string }>,
    checkInsByNode: new Map<string, Array<Record<string, unknown>>>(),
    userRecords: new Map<string, Record<string, unknown>>(),
    business: null as { email?: string; businessName?: string } | null,
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
      if (typeof input['KeyConditionExpression'] === 'string' && !input['IndexName']) {
        const kc = input['KeyConditionExpression'] as string
        if (kc.includes('nodeId')) {
          const nodeId = values[':nodeId'] as string
          return { Items: [{ nodeId, cityId: 'city-1', category: 'bar' }] }
        }
        return { Items: [] }
      }
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
  const getPreviousReportMock = vi.fn(async () => null)
  const broadcastMock = vi.fn(async () => {})
  const getBusinessByIdMock = vi.fn(async () => state.business)
  const sendReportReadyEmailMock = vi.fn(async () => {})

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
    getBusinessByIdMock,
    sendReportReadyEmailMock,
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
vi.mock('../../auth/dynamodb-repository.js', () => ({ getBusinessById: h.getBusinessByIdMock }))
vi.mock('../../../shared/email/ses.js', () => ({ sendReportReadyEmail: h.sendReportReadyEmailMock }))

import { generateReportNow } from '../generator.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CURRENT_USERS = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']

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
  h.state.business = { email: 'owner@venue.co.za', businessName: 'Venue One' }
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('report-ready notifications deliver on the live path (R9.1)', () => {
  it('sends the SES report-ready email to the resolved business email + name and broadcasts over WebSocket', async () => {
    const result = await generateReportNow(BUSINESS_ID, 'weekly', '2026-01-05', '2026-01-11')
    expect(result).toHaveProperty('reportId')
    const reportId = (result as { reportId: string }).reportId

    // Report persisted.
    expect(h.storeReportMock).toHaveBeenCalledTimes(1)

    // WebSocket broadcast to the business room.
    expect(h.broadcastMock).toHaveBeenCalledWith(`business:${BUSINESS_ID}`, {
      type: 'report:ready',
      payload: { reportId, businessId: BUSINESS_ID },
    })

    // SES email sent to the resolved destination, no SQS enqueue.
    expect(h.sendReportReadyEmailMock).toHaveBeenCalledTimes(1)
    expect(h.sendReportReadyEmailMock).toHaveBeenCalledWith('owner@venue.co.za', 'Venue One', reportId, 'weekly')
  })

  it('skips the email (no throw) when the business row has no email address', async () => {
    h.state.business = { businessName: 'No Email Venue' }
    const result = await generateReportNow(BUSINESS_ID, 'weekly', '2026-01-05', '2026-01-11')

    expect(result).toHaveProperty('reportId')
    expect(h.storeReportMock).toHaveBeenCalledTimes(1)
    expect(h.sendReportReadyEmailMock).not.toHaveBeenCalled()
  })
})

describe('notification failure never aborts report persistence (R9.3)', () => {
  it('completes generation and returns the reportId even when email delivery throws', async () => {
    h.sendReportReadyEmailMock.mockRejectedValueOnce(new Error('SES throttled'))

    const result = await generateReportNow(BUSINESS_ID, 'weekly', '2026-01-05', '2026-01-11')

    // Report was already stored before notifications ran, and the throwing
    // email did not propagate.
    expect(h.storeReportMock).toHaveBeenCalledTimes(1)
    expect(result).toHaveProperty('reportId')
  })

  it('completes generation even when the WebSocket broadcast throws', async () => {
    h.broadcastMock.mockRejectedValueOnce(new Error('socket gone'))

    const result = await generateReportNow(BUSINESS_ID, 'weekly', '2026-01-05', '2026-01-11')

    expect(h.storeReportMock).toHaveBeenCalledTimes(1)
    expect(result).toHaveProperty('reportId')
    // Email still delivered despite the WebSocket failure (independent channels).
    expect(h.sendReportReadyEmailMock).toHaveBeenCalledTimes(1)
  })
})
