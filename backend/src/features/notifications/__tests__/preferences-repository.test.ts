import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'

/**
 * Pins the non-destructive persistence of notification preferences.
 *
 * The consumer settings screen PATCHes one toggle at a time. If the repository
 * wrote the record with a full-item `PutCommand`, each toggle would erase every
 * other preference (silently reverting them to defaults on the next read,
 * including flipping an explicit reward-push opt-out back on). These tests lock
 * in a partial `UpdateCommand` that merges only the keys in the patch.
 */

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }))

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: sendMock },
  TableNames: { appData: 'app-data' },
}))

vi.mock('../../../shared/db/entities.js', () => ({
  generateId: vi.fn(() => 'mock-id'),
}))

import { upsertNotificationPreferences } from '../repository.js'

beforeEach(() => {
  sendMock.mockReset()
  sendMock.mockResolvedValue({})
})

function lastCommandInput() {
  const call = sendMock.mock.calls.at(-1)
  if (!call) throw new Error('documentClient.send was not called')
  const command = call[0] as UpdateCommand
  expect(command).toBeInstanceOf(UpdateCommand)
  return command.input
}

describe('upsertNotificationPreferences — partial merge (no overwrite)', () => {
  const USER = 'user-1'

  it('uses an UpdateCommand, never a full-item PutCommand', async () => {
    await upsertNotificationPreferences(USER, { streakAtRisk: true })
    const command = sendMock.mock.calls.at(-1)![0]
    expect(command).toBeInstanceOf(UpdateCommand)
    expect(command).not.toBeInstanceOf(PutCommand)
  })

  it('targets the single-item preferences key', async () => {
    await upsertNotificationPreferences(USER, { streakAtRisk: true })
    const input = lastCommandInput()
    expect(input.Key).toEqual({ pk: `NOTIF_PREFS#${USER}`, sk: `NOTIF_PREFS#${USER}` })
    expect(input.TableName).toBe('app-data')
  })

  it('SETs only the provided key plus userId and updatedAt', async () => {
    await upsertNotificationPreferences(USER, { streakAtRisk: true })
    const input = lastCommandInput()

    // The provided key is written, with its real boolean value.
    expect(input.ExpressionAttributeNames).toMatchObject({ '#streakAtRisk': 'streakAtRisk' })
    expect(input.ExpressionAttributeValues).toMatchObject({ ':streakAtRisk': true, ':userId': USER })

    // No OTHER preference key leaks into the write — that is the overwrite bug.
    const names = Object.values(input.ExpressionAttributeNames ?? {})
    expect(names).not.toContain('rewardActivated')
    expect(names).not.toContain('leaderboardPrewarning')
    expect(names).not.toContain('followedUserCheckin')
    expect(names).not.toContain('rewardClaimedPush')
  })

  it('does not reference an earlier toggle when a later, different toggle is written', async () => {
    // First toggle
    await upsertNotificationPreferences(USER, { streakAtRisk: true })
    // Second, independent toggle
    await upsertNotificationPreferences(USER, { leaderboardPrewarning: true })

    const input = lastCommandInput()
    const names = Object.values(input.ExpressionAttributeNames ?? {})
    // The second write must not carry the first key — proving one toggle
    // cannot clobber another. Under the old PutCommand it would have.
    expect(names).toContain('leaderboardPrewarning')
    expect(names).not.toContain('streakAtRisk')
  })

  it('preserves an explicit false (opt-out is honoured, not dropped)', async () => {
    await upsertNotificationPreferences(USER, { rewardClaimedPush: false })
    const input = lastCommandInput()
    expect(input.ExpressionAttributeValues).toMatchObject({ ':rewardClaimedPush': false })
  })

  it('writes every key when a full preference object is supplied', async () => {
    await upsertNotificationPreferences(USER, {
      streakAtRisk: true,
      rewardActivated: false,
      rewardClaimedPush: false,
      leaderboardPrewarning: true,
      followedUserCheckin: true,
    })
    const input = lastCommandInput()
    const names = Object.values(input.ExpressionAttributeNames ?? {})
    for (const key of [
      'streakAtRisk',
      'rewardActivated',
      'rewardClaimedPush',
      'leaderboardPrewarning',
      'followedUserCheckin',
      'userId',
      'updatedAt',
    ]) {
      expect(names).toContain(key)
    }
  })

  it('ignores undefined keys (does not write a null/undefined attribute)', async () => {
    await upsertNotificationPreferences(USER, { streakAtRisk: true, rewardActivated: undefined })
    const input = lastCommandInput()
    const names = Object.values(input.ExpressionAttributeNames ?? {})
    expect(names).toContain('streakAtRisk')
    expect(names).not.toContain('rewardActivated')
  })
})
