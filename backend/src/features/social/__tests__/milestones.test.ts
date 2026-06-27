import { describe, it, expect, vi, beforeEach } from 'vitest'

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }))

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: sendMock },
  TableNames: { appData: 'app-data' },
}))

import { recordMilestone, streakMilestoneFor, STREAK_MILESTONES } from '../milestones.js'

describe('streakMilestoneFor', () => {
  it('returns the streak count only on milestone thresholds', () => {
    for (const n of STREAK_MILESTONES) expect(streakMilestoneFor(n)).toBe(n)
    for (const n of [0, 1, 2, 4, 5, 6, 8, 13, 29, 31, 100]) {
      expect(streakMilestoneFor(n)).toBeNull()
    }
  })
})

describe('Feature: vibe-ranked-browse, Property 13: milestone idempotency', () => {
  const rec = {
    type: 'streak' as const,
    qualifier: '7',
    title: '7-day streak',
    body: "You're on a 7-day check-in streak",
    createdAt: '2026-01-01T00:00:00.000Z',
  }

  beforeEach(() => sendMock.mockReset())

  it('writes a new milestone once and returns true', async () => {
    sendMock.mockResolvedValueOnce({})
    await expect(recordMilestone('u1', rec)).resolves.toBe(true)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('returns false (no duplicate) when the milestone already exists', async () => {
    const err = new Error('exists') as Error & { name: string }
    err.name = 'ConditionalCheckFailedException'
    sendMock.mockRejectedValueOnce(err)
    await expect(recordMilestone('u1', rec)).resolves.toBe(false)
  })

  it('rethrows non-conditional errors', async () => {
    sendMock.mockRejectedValueOnce(new Error('boom'))
    await expect(recordMilestone('u1', rec)).rejects.toThrow('boom')
  })
})
