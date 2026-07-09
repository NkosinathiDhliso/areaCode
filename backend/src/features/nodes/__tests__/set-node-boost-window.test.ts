/**
 * `setNodeBoostWindow` — max-merge Boost_Window write (R5.1).
 *
 * The boost webhook branch sets a node's `boostUntil` to the LATER of the
 * existing value and the newly purchased window end. DynamoDB has no native
 * `max()`, so the write is a conditional UpdateItem that only lands when the
 * new instant is later (or none is set); a rejected condition is a benign
 * no-op (the stored window already ends later). This keeps the write
 * idempotent under Yoco re-delivery.
 *
 * The real repository runs against a mocked `documentClient`; the shared
 * `isConditionalCheckFailedError` detector is preserved via `importOriginal`
 * so the no-op branch is exercised for real.
 *
 * **Validates: Requirement 5.1**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}))

vi.mock('../../../shared/db/dynamodb.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/db/dynamodb.js')>()
  return {
    ...actual,
    documentClient: { send: mocks.send },
    TableNames: { ...actual.TableNames, nodes: 'nodes' },
  }
})

import { setNodeBoostWindow } from '../dynamodb-repository.js'

const NODE_ID = 'node-1'
const BOOST_UNTIL = '2026-07-09T18:00:00.000Z'

type CapturedUpdate = {
  input: {
    Key: { nodeId: string }
    UpdateExpression: string
    ConditionExpression: string
    ExpressionAttributeNames: Record<string, string>
    ExpressionAttributeValues: Record<string, string>
  }
}

function conditionalCheckError(): Error {
  const err = new Error('The conditional request failed') as Error & { name: string }
  err.name = 'ConditionalCheckFailedException'
  return err
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('setNodeBoostWindow (R5.1)', () => {
  it('issues a conditional UpdateItem that only writes when the new window is later', async () => {
    mocks.send.mockResolvedValueOnce({})

    await setNodeBoostWindow(NODE_ID, BOOST_UNTIL)

    expect(mocks.send).toHaveBeenCalledTimes(1)
    const command = mocks.send.mock.calls[0]![0] as CapturedUpdate
    expect(command.input.Key).toEqual({ nodeId: NODE_ID })
    expect(command.input.ConditionExpression).toBe('attribute_not_exists(#boostUntil) OR #boostUntil < :new')
    expect(command.input.ExpressionAttributeNames['#boostUntil']).toBe('boostUntil')
    expect(command.input.ExpressionAttributeValues[':new']).toBe(BOOST_UNTIL)
  })

  it('treats a conditional-check failure as a benign no-op (existing window is later)', async () => {
    mocks.send.mockRejectedValueOnce(conditionalCheckError())

    await expect(setNodeBoostWindow(NODE_ID, BOOST_UNTIL)).resolves.toBeUndefined()
  })

  it('rethrows non-conditional errors so real failures surface', async () => {
    mocks.send.mockRejectedValueOnce(new Error('network down'))

    await expect(setNodeBoostWindow(NODE_ID, BOOST_UNTIL)).rejects.toThrow('network down')
  })
})
