/**
 * Check-in replay idempotency (cross-portal-lifecycle-alignment task 4.2).
 *
 * Validates: Requirements 5.7
 *
 * `claimReplayCheckIn` is the dedup primitive that makes a double delivery of the
 * same queued check-in produce at most one check-in row. It conditional-puts a
 * marker keyed on (userId, nodeId, capturedAt):
 *
 *   - first delivery  → the put succeeds  → returns true  (proceed with insert)
 *   - second delivery → conditional fails → returns false (return original success)
 *   - any other error → rethrown (never a silent swallow)
 *
 * The real repository runs against a mocked DynamoDB client; the real
 * `isConditionalCheckFailedError` classifies the thrown error, so the race
 * semantics are exercised end to end without live AWS.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ send: vi.fn() }))

vi.mock('../../../shared/db/dynamodb.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/db/dynamodb.js')>()
  return { ...actual, documentClient: { send: mocks.send } }
})

import { claimReplayCheckIn } from '../repository.js'

const CAPTURED = '2026-06-15T12:00:00.000Z'

function conditionalError() {
  const err = new Error('The conditional request failed')
  err.name = 'ConditionalCheckFailedException'
  return err
}

describe('claimReplayCheckIn — idempotency race (R5.7)', () => {
  beforeEach(() => {
    mocks.send.mockReset()
  })

  it('returns true when the marker is claimed for the first time', async () => {
    mocks.send.mockResolvedValueOnce({})
    await expect(claimReplayCheckIn('user-1', 'node-1', CAPTURED)).resolves.toBe(true)
    // The conditional put targets the app-data table with attribute_not_exists.
    const putArg = mocks.send.mock.calls[0]![0] as { input: Record<string, unknown> }
    expect(putArg.input['ConditionExpression']).toContain('attribute_not_exists')
  })

  it('returns false when the marker already exists (duplicate delivery)', async () => {
    mocks.send.mockRejectedValueOnce(conditionalError())
    await expect(claimReplayCheckIn('user-1', 'node-1', CAPTURED)).resolves.toBe(false)
  })

  it('models the race: first claim wins, second delivery is a no-op', async () => {
    mocks.send.mockResolvedValueOnce({}).mockRejectedValueOnce(conditionalError())
    const first = await claimReplayCheckIn('user-1', 'node-1', CAPTURED)
    const second = await claimReplayCheckIn('user-1', 'node-1', CAPTURED)
    expect(first).toBe(true)
    expect(second).toBe(false)
  })

  it('rethrows a non-conditional error (never silently swallowed)', async () => {
    mocks.send.mockRejectedValueOnce(new Error('throttled'))
    await expect(claimReplayCheckIn('user-1', 'node-1', CAPTURED)).rejects.toThrow('throttled')
  })
})
