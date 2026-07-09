/**
 * Report dispatcher fan-out (Weekly Attribution Digest, task 4.1).
 *
 * Locks the R1.1 / R6.1 guarantee that the WEEKLY pass dispatches a
 * generation message for every business with at least one active node,
 * regardless of check-in activity in the window (a zero-visits week is a
 * designed honest digest state). The MONTHLY pass is report-only and stays
 * gated on activity, unchanged.
 *
 * DynamoDB reads are routed by table + index off the real command inputs
 * (no lib-dynamodb mock), matching the repository test style. The SQS client
 * is mocked so dispatched messages are capturable and their shape asserted
 * to stay backward compatible with the generator.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  dynamoSend: vi.fn(),
  sqsSend: vi.fn(),
}))

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: class {
    send = mocks.sqsSend
  },
  SendMessageCommand: class {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  },
}))

vi.mock('../../../shared/config/env.js', () => ({
  AWS_REGION: 'af-south-1',
}))

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.dynamoSend },
  TableNames: { businesses: 'businesses', nodes: 'nodes', checkins: 'checkins' },
}))

import { handler } from '../dispatcher.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

type NodeFixture = { nodeId: string; isActive?: boolean }

let nodesByBusiness: Record<string, NodeFixture[]>
let activeCheckinNodes: Set<string>

/**
 * Route documentClient.send by the command's table + index. Businesses come
 * from a Scan on the businesses table; nodes from the BusinessIndex query on
 * the nodes table; activity from the NodeIndex query on the checkins table.
 */
function routeDynamo(command: { input: Record<string, unknown> }) {
  const input = command.input
  const table = input['TableName'] as string

  if (table === 'businesses') {
    return {
      Items: Object.keys(nodesByBusiness).map((businessId) => ({ businessId })),
    }
  }

  if (table === 'nodes') {
    const values = input['ExpressionAttributeValues'] as Record<string, unknown>
    const businessId = values[':businessId'] as string
    const nodes = nodesByBusiness[businessId] ?? []
    return {
      Items: nodes.map((n) => ({
        nodeId: n.nodeId,
        // Mirror stored rows: isActive is present on real rows. When a fixture
        // omits it we leave it absent to exercise the default-true read path.
        ...(n.isActive === undefined ? {} : { isActive: n.isActive }),
      })),
    }
  }

  if (table === 'checkins') {
    const values = input['ExpressionAttributeValues'] as Record<string, unknown>
    const nodeId = values[':nodeId'] as string
    return { Items: activeCheckinNodes.has(nodeId) ? [{ checkinId: 'c1' }] : [] }
  }

  throw new Error(`unexpected table ${table}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env['AREA_CODE_REPORT_QUEUE_URL'] = 'https://sqs.test/queue'
  nodesByBusiness = {}
  activeCheckinNodes = new Set()
  mocks.dynamoSend.mockImplementation((command: { input: Record<string, unknown> }) =>
    Promise.resolve(routeDynamo(command)),
  )
  mocks.sqsSend.mockResolvedValue({})
})

function dispatchedBusinessIds(): string[] {
  return mocks.sqsSend.mock.calls.map((call) => {
    const body = JSON.parse((call[0] as { input: { MessageBody: string } }).input.MessageBody)
    return body.businessId as string
  })
}

describe('weekly pass (R1.1, R6.1): wider fan-out', () => {
  it('dispatches a business with an active node but zero activity in the window', async () => {
    nodesByBusiness = { 'biz-quiet': [{ nodeId: 'n1', isActive: true }] }
    // No entries in activeCheckinNodes: the business had zero check-ins.

    await handler({ periodType: 'weekly' })

    expect(dispatchedBusinessIds()).toEqual(['biz-quiet'])
  })

  it('treats a node with an absent isActive attribute as active (repository default)', async () => {
    nodesByBusiness = { 'biz-legacy': [{ nodeId: 'n1' }] }

    await handler({ periodType: 'weekly' })

    expect(dispatchedBusinessIds()).toEqual(['biz-legacy'])
  })

  it('skips a business with no nodes at all', async () => {
    nodesByBusiness = { 'biz-empty': [] }

    await handler({ periodType: 'weekly' })

    expect(mocks.sqsSend).not.toHaveBeenCalled()
  })

  it('skips a business whose only nodes are inactive', async () => {
    nodesByBusiness = { 'biz-inactive': [{ nodeId: 'n1', isActive: false }] }

    await handler({ periodType: 'weekly' })

    expect(mocks.sqsSend).not.toHaveBeenCalled()
  })

  it('never gates weekly dispatch on check-in activity (no activity query issued)', async () => {
    nodesByBusiness = { 'biz-quiet': [{ nodeId: 'n1', isActive: true }] }

    await handler({ periodType: 'weekly' })

    const queriedCheckins = mocks.dynamoSend.mock.calls.some(
      (call) => (call[0] as { input: { TableName?: string } }).input.TableName === 'checkins',
    )
    expect(queriedCheckins).toBe(false)
  })

  it('sends a backward-compatible message shape the generator consumes', async () => {
    nodesByBusiness = { 'biz-quiet': [{ nodeId: 'n1', isActive: true }] }

    await handler({ periodType: 'weekly' })

    const body = JSON.parse((mocks.sqsSend.mock.calls[0]![0] as { input: { MessageBody: string } }).input.MessageBody)
    expect(Object.keys(body).sort()).toEqual(['businessId', 'periodEnd', 'periodStart', 'periodType'])
    expect(body.businessId).toBe('biz-quiet')
    expect(body.periodType).toBe('weekly')
    expect(typeof body.periodStart).toBe('string')
    expect(typeof body.periodEnd).toBe('string')
  })
})

describe('monthly pass: report-only, unchanged', () => {
  it('skips a business with an active node but zero activity in the window', async () => {
    nodesByBusiness = { 'biz-quiet': [{ nodeId: 'n1', isActive: true }] }
    // No activity recorded for n1.

    await handler({ periodType: 'monthly' })

    expect(mocks.sqsSend).not.toHaveBeenCalled()
  })

  it('dispatches a business that has check-in activity in the window', async () => {
    nodesByBusiness = { 'biz-busy': [{ nodeId: 'n1', isActive: true }] }
    activeCheckinNodes = new Set(['n1'])

    await handler({ periodType: 'monthly' })

    expect(dispatchedBusinessIds()).toEqual(['biz-busy'])
    // The activity gate ran: the checkins table was queried.
    const queriedCheckins = mocks.dynamoSend.mock.calls.some(
      (call) => (call[0] as { input: { TableName?: string } }).input.TableName === 'checkins',
    )
    expect(queriedCheckins).toBe(true)
  })

  it('skips a business with no nodes', async () => {
    nodesByBusiness = { 'biz-empty': [] }

    await handler({ periodType: 'monthly' })

    expect(mocks.sqsSend).not.toHaveBeenCalled()
  })
})

describe('per-business error isolation', () => {
  it('continues dispatching after one business throws', async () => {
    nodesByBusiness = {
      'biz-a': [{ nodeId: 'n1', isActive: true }],
      'biz-boom': [{ nodeId: 'n2', isActive: true }],
      'biz-c': [{ nodeId: 'n3', isActive: true }],
    }
    // Make the SQS send for biz-boom fail; the others must still dispatch.
    mocks.sqsSend.mockImplementation((command: { input: { MessageBody: string } }) => {
      const body = JSON.parse(command.input.MessageBody)
      if (body.businessId === 'biz-boom') {
        return Promise.reject(new Error('sqs down'))
      }
      return Promise.resolve({})
    })

    // Must not throw: the per-business try/catch swallows and continues.
    await expect(handler({ periodType: 'weekly' })).resolves.toBeUndefined()

    // biz-c is processed after biz-boom fails, so its dispatch proves the loop
    // kept going past the failure (per-business error isolation).
    const attempted = dispatchedBusinessIds()
    expect(attempted).toContain('biz-a')
    expect(attempted).toContain('biz-c')
  })
})
