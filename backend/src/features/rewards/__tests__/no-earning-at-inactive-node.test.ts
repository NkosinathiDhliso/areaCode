/**
 * Earned_Code_Policy — earning side (cross-portal-lifecycle-alignment task 3.3).
 *
 * The other half of R3.3: a demoted business earns NO new rewards, because its
 * venues are hidden from discovery. The proximity feed (`getRewardsNearMe`,
 * rewards repository) joins each active reward to its node and skips any reward
 * whose node is inactive, so a get at a lapsed venue never surfaces and can never
 * be claimed. This pins that skip so it cannot regress into surfacing dead venues.
 *
 * The real repository runs against a mocked DynamoDB scan and a mocked node
 * lookup. An inactive node short-circuits before any pulse/tier work, so those
 * best-effort dependencies are never reached and need no mocking.
 *
 * **Validates: Requirements 3.3**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  getNodeById: vi.fn(),
}))

vi.mock('../../../shared/db/dynamodb.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/db/dynamodb.js')>()
  return { ...actual, documentClient: { send: mocks.send } }
})

vi.mock('../../nodes/dynamodb-repository.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../nodes/dynamodb-repository.js')>()
  return { ...actual, getNodeById: mocks.getNodeById }
})

import { getRewardsNearMe } from '../repository.js'

const REWARD = {
  rewardId: 'reward-1',
  nodeId: 'node-1',
  isActive: true,
  title: 'Free Coffee',
  type: 'nth_checkin',
}

// Cape Town CBD-ish coordinates; the node sits at the same point so distance is 0.
const LAT = -33.9249
const LNG = 18.4241

describe('no new earning at inactive nodes (R3.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.send.mockResolvedValue({ Items: [REWARD] })
  })

  it('excludes an active reward whose owning node is inactive (lapsed venue)', async () => {
    mocks.getNodeById.mockResolvedValue({
      nodeId: 'node-1',
      name: 'Father Coffee',
      isActive: false,
      lat: LAT,
      lng: LNG,
      businessId: 'biz-1',
    })

    const result = await getRewardsNearMe(LAT, LNG)
    expect(result).toEqual([])
  })

  it('excludes the reward when its node cannot be resolved at all', async () => {
    mocks.getNodeById.mockResolvedValue(null)
    const result = await getRewardsNearMe(LAT, LNG)
    expect(result).toEqual([])
  })
})
