/**
 * Check-out clears the cooldown and lowers the beam.
 *
 * **Validates: Requirements 15.3**
 *
 * Two halves of the same honesty problem. A consumer who leaves and comes back
 * was being refused with a `429` because the cooldown key outlived their visit.
 * And the pulse score stayed where the last arrival left it until the decay
 * worker ran, so the map kept advertising a room that was emptying — the exact
 * over-claim `honest-presence.md` exists to prevent. A departure has to move the
 * number down, through the same formula an arrival moves it up with.
 *
 * The reward cooldown is deliberately left alone: check-out is one button press,
 * so clearing it would make leaving a way to mint a second reward inside the
 * four-hour window.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { checkInCooldownKey } from '../../check-in/cooldown.js'
import { computePulse, dailyCheckInKvKey, pulseKvKey } from '../../nodes/pulse.js'

const USER_ID = 'user-nomsa'
const NODE_ID = 'node-ramonas'
const CITY_ID = 'city-jhb'
const CITY_SLUG = 'johannesburg'

const h = vi.hoisted(() => ({
  state: {
    /** Value behind each KV key the service reads. */
    kv: new Map<string, string>(),
    livePresenceCount: 0,
  },
  kvGet: vi.fn(),
  kvSet: vi.fn(async () => undefined),
  kvDel: vi.fn(async () => undefined),
  getUserById: vi.fn(async () => ({ userId: USER_ID, isDisabled: false })),
  getNodeWithCity: vi.fn(async () => ({
    id: NODE_ID,
    name: "Ramona's",
    cityId: CITY_ID,
    city: { id: CITY_ID, slug: CITY_SLUG },
  })),
  endPresenceByCheckOut: vi.fn(),
  getLivePresenceCount: vi.fn(),
  recordPresenceSample: vi.fn(async () => 'winding_down'),
  writeDwellRow: vi.fn(async () => undefined),
  emitPulseUpdate: vi.fn(async () => undefined),
  emitPresenceUpdate: vi.fn(async () => undefined),
  emitFriendCheckout: vi.fn(async () => undefined),
  canEmitToFriends: vi.fn(async () => false),
  getFollowingIds: vi.fn(async () => [] as string[]),
  getMutualFollowIds: vi.fn(async () => new Set<string>()),
}))

vi.mock('../../../shared/config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/config/env.js')>()
  return { ...actual, DEV_MODE: false }
})

vi.mock('../../../shared/kv/dynamodb-kv.js', () => ({
  kvGet: h.kvGet,
  kvSet: h.kvSet,
  kvDel: h.kvDel,
}))

vi.mock('../../../shared/socket/events.js', () => ({
  emitPulseUpdate: h.emitPulseUpdate,
  emitPresenceUpdate: h.emitPresenceUpdate,
  emitFriendCheckout: h.emitFriendCheckout,
}))

vi.mock('../../../shared/privacy/privacy-guard.js', () => ({ canEmitToFriends: h.canEmitToFriends }))

vi.mock('../../auth/repository.js', () => ({ getUserById: h.getUserById }))

vi.mock('../../check-in/repository.js', () => ({ getNodeWithCity: h.getNodeWithCity }))

vi.mock('../../presence/dwell-sink.js', () => ({ writeDwellRow: h.writeDwellRow }))

vi.mock('../../presence/repository.js', () => ({
  endPresenceByCheckOut: h.endPresenceByCheckOut,
  getLivePresenceCount: h.getLivePresenceCount,
  recordPresenceSample: h.recordPresenceSample,
}))

vi.mock('../../social/repository.js', () => ({
  getFollowingIds: h.getFollowingIds,
  getMutualFollowIds: h.getMutualFollowIds,
}))

import { processCheckOut } from '../service.js'

/** The record a won check-out transition returns. */
function endedRecord() {
  const now = Math.floor(Date.now() / 1000)
  return { userId: USER_ID, nodeId: NODE_ID, dwellSeconds: 5400, endedAt: now }
}

beforeEach(() => {
  for (const fn of Object.values(h)) (fn as ReturnType<typeof vi.fn>).mockClear?.()
  h.state.kv = new Map([[dailyCheckInKvKey(NODE_ID), '8']])
  h.state.livePresenceCount = 3
  h.kvGet.mockImplementation(async (key: string) => h.state.kv.get(key) ?? null)
  h.getLivePresenceCount.mockImplementation(async () => h.state.livePresenceCount)
  h.endPresenceByCheckOut.mockResolvedValue(endedRecord())
})

describe('check-out clears the check-in cooldown', () => {
  it('deletes the presence cooldown for that consumer at that venue', async () => {
    await processCheckOut(USER_ID, { nodeId: NODE_ID })

    expect(h.kvDel).toHaveBeenCalledWith(`checkin:cooldown:presence:${USER_ID}:${NODE_ID}`)
    expect(h.kvDel).toHaveBeenCalledWith(checkInCooldownKey('presence', USER_ID, NODE_ID))
  })

  it('leaves the reward cooldown standing, so leaving cannot mint a second reward', async () => {
    await processCheckOut(USER_ID, { nodeId: NODE_ID })

    expect(h.kvDel).not.toHaveBeenCalledWith(checkInCooldownKey('reward', USER_ID, NODE_ID))
  })

  it('clears nothing when there was no live presence to end', async () => {
    h.endPresenceByCheckOut.mockResolvedValue(null)

    const result = await processCheckOut(USER_ID, { nodeId: NODE_ID })

    expect(result.presenceState).toBe('no_active_presence')
    expect(h.kvDel).not.toHaveBeenCalled()
  })
})

describe('check-out recomputes the pulse from the new presence count', () => {
  it('stores the score from the same formula the check-in path uses', async () => {
    h.state.livePresenceCount = 3

    await processCheckOut(USER_ID, { nodeId: NODE_ID })

    const pulseWrites = h.kvSet.mock.calls.filter((c) => String(c[0]) === pulseKvKey(CITY_ID, NODE_ID))
    expect(pulseWrites).toHaveLength(1)
    // 8 check-ins today, 3 people still in the room.
    expect(pulseWrites[0]![1]).toBe(String(computePulse(8, 3)))
  })

  it('lowers the score as the room empties', async () => {
    h.state.livePresenceCount = 3
    await processCheckOut(USER_ID, { nodeId: NODE_ID })
    const busy = Number(h.kvSet.mock.calls.find((c) => String(c[0]) === pulseKvKey(CITY_ID, NODE_ID))![1])

    h.kvSet.mockClear()
    h.state.livePresenceCount = 0
    await processCheckOut(USER_ID, { nodeId: NODE_ID })
    const empty = Number(h.kvSet.mock.calls.find((c) => String(c[0]) === pulseKvKey(CITY_ID, NODE_ID))![1])

    expect(empty).toBeLessThan(busy)
  })

  it('emits the new score to the city room so the beam dims', async () => {
    await processCheckOut(USER_ID, { nodeId: NODE_ID })

    expect(h.emitPulseUpdate).toHaveBeenCalledTimes(1)
    const [room, payload] = h.emitPulseUpdate.mock.calls[0]! as [
      string,
      { nodeId: string; pulseScore: number; checkInCount: number; state: string },
    ]
    expect(room).toBe(CITY_SLUG)
    expect(payload.nodeId).toBe(NODE_ID)
    expect(payload.pulseScore).toBe(computePulse(8, 3))
    expect(payload.checkInCount).toBe(8)
    expect(payload.state).toBe('buzzing')
  })

  it('reads an absent day counter as zero rather than substituting a number', async () => {
    h.state.kv = new Map()
    h.state.livePresenceCount = 0

    await processCheckOut(USER_ID, { nodeId: NODE_ID })

    const pulseWrite = h.kvSet.mock.calls.find((c) => String(c[0]) === pulseKvKey(CITY_ID, NODE_ID))!
    expect(pulseWrite[1]).toBe('0')
  })

  it('still reports the check-out when the pulse write fails', async () => {
    h.kvSet.mockRejectedValue(new Error('kv unavailable'))

    const result = await processCheckOut(USER_ID, { nodeId: NODE_ID })

    expect(result.presenceState).toBe('checked_out')
    expect(result.dwellSeconds).toBe(5400)
  })
})
