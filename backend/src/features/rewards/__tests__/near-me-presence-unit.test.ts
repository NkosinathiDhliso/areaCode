/**
 * Near-me reads presence in seconds, so a live record is counted.
 *
 * **Validates: Requirements 15.4**
 *
 * `getLivePresenceCount(nodeId, now)` takes epoch SECONDS: that is the unit
 * presence records store `expiresAt` in. Near-me was passing `Date.now()`,
 * milliseconds, which is about 55,000 years in the future in that unit, so every
 * live record compared as long expired and every venue behind a get read as
 * empty. The aliveness term of the ranking was therefore always pulse-only.
 *
 * The presence read here is the REAL expiry comparison (`livePresenceCount` from
 * the read model) over a seeded record, so the unit mistake reproduces as the
 * count it actually produced: 0.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { livePresenceCount } from '../../presence/read-model.js'

const NODE_ID = 'node-ramonas'
const REWARD_ID = 'reward-1'
const NODE_LAT = -26.1954
const NODE_LNG = 28.0412

const h = vi.hoisted(() => ({
  state: {
    /** Epoch SECONDS at which the one seeded presence record stops being live. */
    expiresAtSeconds: 0,
    /** Every `now` the presence read was handed, for the unit assertion. */
    presenceReadsAt: [] as number[],
  },
  sendMock: vi.fn(),
  kvGet: vi.fn(async () => null),
  getNodeById: vi.fn(),
  getUserById: vi.fn(async () => ({ userId: 'viewer', archetypeId: 'archetype-eclectic' })),
  getStaffById: vi.fn(),
  findBusinessById: vi.fn(async () => null),
  listRedemptionsForBusiness: vi.fn(async () => []),
  getFollowingIds: vi.fn(async () => [] as string[]),
  getMutualFollowIds: vi.fn(async () => new Set<string>()),
  getFriendsPresence: vi.fn(async () => [] as Array<{ nodeId: string }>),
}))

vi.mock('../../../shared/db/dynamodb.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/db/dynamodb.js')>()
  return { ...actual, documentClient: { send: h.sendMock } }
})

vi.mock('../../../shared/kv/dynamodb-kv.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/kv/dynamodb-kv.js')>()
  return { ...actual, kvGet: h.kvGet }
})

vi.mock('../../nodes/dynamodb-repository.js', () => ({ getNodeById: h.getNodeById }))

vi.mock('../../auth/dynamodb-repository.js', () => ({
  getUserById: h.getUserById,
  getStaffById: h.getStaffById,
}))

vi.mock('../../business/repository.js', () => ({ findBusinessById: h.findBusinessById }))

vi.mock('../../business/staff-leaderboard.js', () => ({
  listRedemptionsForBusiness: h.listRedemptionsForBusiness,
}))

vi.mock('../../social/repository.js', () => ({
  getFollowingIds: h.getFollowingIds,
  getMutualFollowIds: h.getMutualFollowIds,
  getFriendsPresence: h.getFriendsPresence,
}))

// The presence adapter, with the real read-model semantics behind it: one
// `present` record, live until `expiresAtSeconds`, compared against whatever
// `now` the caller passes in whatever unit it passes.
vi.mock('../../presence/repository.js', () => ({
  getLivePresenceCount: vi.fn(async (_nodeId: string, now: number) => {
    h.state.presenceReadsAt.push(now)
    return livePresenceCount([{ state: 'present', expiresAt: h.state.expiresAtSeconds }], now)
  }),
}))

import { getRewardsNearMe } from '../repository.js'

beforeEach(() => {
  h.sendMock.mockReset()
  h.state.presenceReadsAt = []
  // Somebody checked in twenty minutes ago; their presence has forty to run.
  h.state.expiresAtSeconds = Math.floor(Date.now() / 1000) + 40 * 60

  h.sendMock.mockImplementation(async (cmd: { constructor: { name: string } }) => {
    if (cmd.constructor.name === 'ScanCommand') {
      return {
        Items: [{ rewardId: REWARD_ID, nodeId: NODE_ID, title: 'Free coffee', type: 'nth_checkin', isActive: true }],
      }
    }
    return { Items: [] }
  })

  h.getNodeById.mockResolvedValue({
    nodeId: NODE_ID,
    name: "Ramona's",
    slug: 'ramonas',
    lat: NODE_LAT,
    lng: NODE_LNG,
    isActive: true,
    businessId: null,
    cityId: 'city-jhb',
    currentArchetypeId: null,
    defaultArchetypeId: 'archetype-eclectic',
  })
})

describe('getRewardsNearMe counts live presence at the venue', () => {
  it('reads presence in epoch seconds', async () => {
    await getRewardsNearMe(NODE_LAT, NODE_LNG, 'viewer')

    expect(h.state.presenceReadsAt).toHaveLength(1)
    const now = h.state.presenceReadsAt[0]!
    const expectedSeconds = Math.floor(Date.now() / 1000)
    expect(Math.abs(now - expectedSeconds)).toBeLessThanOrEqual(2)
  })

  it('counts a live record, instead of reading the venue as empty', async () => {
    const gets = await getRewardsNearMe(NODE_LAT, NODE_LNG, 'viewer')

    expect(gets).toHaveLength(1)
    expect((gets[0] as { live_count: number }).live_count).toBe(1)
    // Aliveness carries that count into the ranking (no pulse row here, so the
    // live count is the whole aliveness term).
    expect((gets[0] as { aliveness: number }).aliveness).toBe(1)
  })

  it('reads an expired record as nobody there, honestly', async () => {
    h.state.expiresAtSeconds = Math.floor(Date.now() / 1000) - 60

    const gets = await getRewardsNearMe(NODE_LAT, NODE_LNG, 'viewer')

    expect((gets[0] as { live_count: number }).live_count).toBe(0)
  })
})
