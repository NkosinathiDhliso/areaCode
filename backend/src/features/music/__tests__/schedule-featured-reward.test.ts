/**
 * Feature: proof-of-demand R8.4 — a Dated_Slot's `featuredRewardId` must be a
 * live get at one of the business's own nodes.
 *
 * Strategy: the rewards repository read and the schedule write are mocked so the
 * only surface under test is the decision the service owns. The reward rows are
 * the shape `rewards/repository.getRewardById` returns (the reward plus its
 * joined node), because ownership is resolved through the node rather than any
 * id the client sent.
 *
 * Every rejection is a 400 naming the reason. The reward is never silently
 * dropped from the slot: an owner who picked a get for tonight and got a
 * schedule back without it would believe it is showing when it is not.
 *
 * Validates: Requirements 8.4
 */
import type { MusicSchedule, ScheduleSlot } from '@area-code/shared/types'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRewardById: vi.fn(),
  upsertSchedule: vi.fn(),
}))

vi.mock('../../rewards/repository.js', () => ({ getRewardById: mocks.getRewardById }))
vi.mock('../schedule-repository.js', () => ({ upsertSchedule: mocks.upsertSchedule }))

import { assertFeaturedRewardsUsable, upsertScheduleForBusiness } from '../schedule-service.js'

const BUSINESS = 'biz-1'
const NOW = '2026-03-06T18:00:00.000Z'

function datedSlot(overrides: Partial<ScheduleSlot> = {}): ScheduleSlot {
  return {
    slotId: 'tonight',
    dayOfWeek: 'FRI',
    startTime: '21:00',
    endTime: '23:59',
    startTimeMin: 21 * 60,
    endTimeMin: 23 * 60 + 59,
    mode: 'blanket',
    genres: ['amapiano'],
    date: '2026-03-06',
    headline: 'Amapiano with DJ Khanya',
    featuredRewardId: 'reward-1',
    ...overrides,
  }
}

function scheduleWith(slots: ScheduleSlot[]): MusicSchedule {
  return {
    businessId: BUSINESS,
    scheduleId: 'default',
    timezone: 'Africa/Johannesburg',
    slots,
    updatedAt: NOW,
    schemaVersion: 1,
  }
}

function liveReward(overrides: Record<string, unknown> = {}) {
  return {
    rewardId: 'reward-1',
    id: 'reward-1',
    nodeId: 'node-1',
    title: 'Free welcome drink',
    isActive: true,
    node: { businessId: BUSINESS, name: 'The Yard' },
    ...overrides,
  }
}

beforeEach(() => {
  mocks.getRewardById.mockReset()
  mocks.upsertSchedule.mockReset()
  mocks.upsertSchedule.mockImplementation(async (schedule: MusicSchedule) => schedule)
})

describe('featuredRewardId validation (R8.4)', () => {
  it("accepts a live get at one of the business's own nodes", async () => {
    mocks.getRewardById.mockResolvedValue(liveReward())
    await expect(assertFeaturedRewardsUsable(scheduleWith([datedSlot()]), BUSINESS, NOW)).resolves.toBeUndefined()
    expect(mocks.getRewardById).toHaveBeenCalledWith('reward-1')
  })

  it('rejects a get that does not exist', async () => {
    mocks.getRewardById.mockResolvedValue(null)
    await expect(assertFeaturedRewardsUsable(scheduleWith([datedSlot()]), BUSINESS, NOW)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it("rejects a get at another business's node, reported the same as a missing one", async () => {
    mocks.getRewardById.mockResolvedValue(liveReward({ node: { businessId: 'biz-2', name: 'Elsewhere' } }))
    await expect(assertFeaturedRewardsUsable(scheduleWith([datedSlot()]), BUSINESS, NOW)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('no longer exists'),
    })
  })

  it('rejects a get whose node could not be resolved (fails closed)', async () => {
    mocks.getRewardById.mockResolvedValue(liveReward({ node: null }))
    await expect(assertFeaturedRewardsUsable(scheduleWith([datedSlot()]), BUSINESS, NOW)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('rejects a deactivated get', async () => {
    mocks.getRewardById.mockResolvedValue(liveReward({ isActive: false }))
    await expect(assertFeaturedRewardsUsable(scheduleWith([datedSlot()]), BUSINESS, NOW)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('switched off'),
    })
  })

  it('rejects a get whose event window has already ended', async () => {
    mocks.getRewardById.mockResolvedValue(liveReward({ endsAt: '2026-03-05T22:00:00.000Z' }))
    await expect(assertFeaturedRewardsUsable(scheduleWith([datedSlot()]), BUSINESS, NOW)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('already ended'),
    })
  })

  it('rejects a get that has expired', async () => {
    mocks.getRewardById.mockResolvedValue(liveReward({ expiresAt: '2026-01-01T00:00:00.000Z' }))
    await expect(assertFeaturedRewardsUsable(scheduleWith([datedSlot()]), BUSINESS, NOW)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('accepts a get whose window is still open tonight', async () => {
    mocks.getRewardById.mockResolvedValue(
      liveReward({ startsAt: '2026-03-06T19:00:00.000Z', endsAt: '2026-03-07T02:00:00.000Z' }),
    )
    await expect(assertFeaturedRewardsUsable(scheduleWith([datedSlot()]), BUSINESS, NOW)).resolves.toBeUndefined()
  })

  it('checks each distinct id once across slots and ignores weekly slots', async () => {
    mocks.getRewardById.mockResolvedValue(liveReward())
    const weekly = datedSlot({ slotId: 'weekly', date: undefined, featuredRewardId: undefined })
    const secondDated = datedSlot({ slotId: 'tonight-2', date: '2026-03-13', startTime: '20:00' })
    await assertFeaturedRewardsUsable(scheduleWith([weekly, datedSlot(), secondDated]), BUSINESS, NOW)
    expect(mocks.getRewardById).toHaveBeenCalledTimes(1)
  })

  it('does not read rewards at all for a weekly-only schedule', async () => {
    const weekly = datedSlot({ slotId: 'weekly', date: undefined, featuredRewardId: undefined, headline: undefined })
    await upsertScheduleForBusiness(scheduleWith([weekly]), BUSINESS)
    expect(mocks.getRewardById).not.toHaveBeenCalled()
    expect(mocks.upsertSchedule).toHaveBeenCalledTimes(1)
  })

  it('never writes the schedule when a featured get is rejected', async () => {
    mocks.getRewardById.mockResolvedValue(null)
    await expect(upsertScheduleForBusiness(scheduleWith([datedSlot()]), BUSINESS)).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(mocks.upsertSchedule).not.toHaveBeenCalled()
  })
})
