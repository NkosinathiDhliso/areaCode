/**
 * Feature: tiered-visibility, Property 1: Check-in always contributes.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 9.1**
 *
 * For ANY check-in by any user at any node, the live signal is updated:
 *   - the pulse score is recalculated and stored (`pulse:{cityId}:{nodeId}`),
 *   - the daily counter increments (`checkin:today:{nodeId}` via `kvIncr`),
 *   - the `node:pulse_update` socket event is emitted to the city room.
 * No user relationship (mutual follow), consent value (identity / friend-emit),
 * privacy setting, business ownership, or check-in type can SUPPRESS any of
 * these. Those signals gate identity fan-out only, never the aliveness update.
 *
 * ─── Strategy ───────────────────────────────────────────────────────────────
 *
 * `processCheckIn` returns early in DEV_MODE, so the env is `dev` +
 * `AREA_CODE_FORCE_LIVE` (DEV_MODE off) and the service is imported dynamically
 * after the env is set — the same pattern as the sibling check-in suites. The
 * whole I/O surface (KV, sockets, privacy guard, repositories, dynamic-imported
 * milestone/notification/reward-lock modules) is mocked; proximity stays REAL
 * and is satisfied by submitting the node's own coordinates (distance 0). Each
 * run randomises the consent/relationship/setting inputs and asserts the three
 * live-signal writes fire regardless.
 *
 * Note on unique users: this DynamoDB implementation folds unique-user tracking
 * into the daily counter approximation (`uniqueUsers = dailyCount`; there is no
 * Redis SADD), so the property asserts the counter + pulse + emit that the real
 * code performs rather than a separate `unique_users` set write.
 */

import * as fc from 'fast-check'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

const h = vi.hoisted(() => ({
  kvGet: vi.fn(async () => null),
  kvSet: vi.fn(async () => undefined),
  kvIncr: vi.fn(async () => 1),
  kvTtl: vi.fn(async () => 0),
  emitPulseUpdate: vi.fn(async () => undefined),
  emitPresenceUpdate: vi.fn(async () => undefined),
  emitToast: vi.fn(async () => undefined),
  emitBusinessCheckin: vi.fn(async () => undefined),
  emitBusinessCheckinDetail: vi.fn(async () => undefined),
  emitFriendToast: vi.fn(async () => undefined),
  emitTierChanged: vi.fn(async () => undefined),
  canEmitIdentity: vi.fn(async () => true),
  canEmitToFriends: vi.fn(async () => true),
  sanitizeForBusiness: vi.fn((p: unknown) => p),
  send: vi.fn(async () => ({})),
  getUserById: vi.fn(),
  createOrRefreshPresence: vi.fn(async () => ({ opened: false })),
  getLivePresenceCount: vi.fn(async () => 0),
  recordPresenceSample: vi.fn(async () => null),
  getMutualFollowIds: vi.fn(async () => new Set<string>()),
  getFollowingIds: vi.fn(async () => [] as string[]),
  runAbuseChecks: vi.fn(async () => undefined),
  getUserCheckInCountAtNode: vi.fn(async () => 0),
  incrementLeaderboard: vi.fn(async () => undefined),
  getNodeWithCity: vi.fn(),
  insertCheckIn: vi.fn(async () => ({ checkInId: 'ci-1' })),
  incrementTotalCheckIns: vi.fn(async () => ({ totalCheckIns: 5, tier: 'local' })),
  updateStreak: vi.fn(async () => 1),
  processCheckInRewardLocks: vi.fn(async () => undefined),
  recordMilestone: vi.fn(async () => undefined),
  streakMilestoneFor: vi.fn(() => null),
  sendNotification: vi.fn(async () => undefined),
  getPreferences: vi.fn(async () => ({})),
}))

vi.mock('../../../shared/kv/dynamodb-kv.js', () => ({
  kvGet: h.kvGet,
  kvSet: h.kvSet,
  kvIncr: h.kvIncr,
  kvTtl: h.kvTtl,
}))

vi.mock('../../../shared/socket/events.js', () => ({
  emitPulseUpdate: h.emitPulseUpdate,
  emitPresenceUpdate: h.emitPresenceUpdate,
  emitToast: h.emitToast,
  emitBusinessCheckin: h.emitBusinessCheckin,
  emitBusinessCheckinDetail: h.emitBusinessCheckinDetail,
  emitFriendToast: h.emitFriendToast,
  emitTierChanged: h.emitTierChanged,
}))

vi.mock('../../../shared/privacy/privacy-guard.js', () => ({
  canEmitIdentity: h.canEmitIdentity,
  canEmitToFriends: h.canEmitToFriends,
  sanitizeForBusiness: h.sanitizeForBusiness,
}))

vi.mock('../../../shared/db/dynamodb.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/db/dynamodb.js')>()
  return { ...actual, documentClient: { send: h.send } }
})

vi.mock('../../auth/repository.js', () => ({ getUserById: h.getUserById }))

vi.mock('../../presence/repository.js', () => ({
  createOrRefreshPresence: h.createOrRefreshPresence,
  getLivePresenceCount: h.getLivePresenceCount,
  recordPresenceSample: h.recordPresenceSample,
}))

vi.mock('../../social/repository.js', () => ({
  getMutualFollowIds: h.getMutualFollowIds,
  getFollowingIds: h.getFollowingIds,
}))

vi.mock('../abuse.js', () => ({ runAbuseChecks: h.runAbuseChecks }))

vi.mock('../dynamodb-repository.js', () => ({
  getUserCheckInCountAtNode: h.getUserCheckInCountAtNode,
  incrementLeaderboard: h.incrementLeaderboard,
}))

vi.mock('../repository.js', () => ({
  getNodeWithCity: h.getNodeWithCity,
  insertCheckIn: h.insertCheckIn,
  incrementTotalCheckIns: h.incrementTotalCheckIns,
  updateStreak: h.updateStreak,
}))

vi.mock('../../rewards/threshold-lock.js', () => ({ processCheckInRewardLocks: h.processCheckInRewardLocks }))

vi.mock('../../social/milestones.js', () => ({
  recordMilestone: h.recordMilestone,
  streakMilestoneFor: h.streakMilestoneFor,
}))

vi.mock('../../notifications/service.js', () => ({
  sendNotification: h.sendNotification,
  getPreferences: h.getPreferences,
}))

let processCheckIn: (typeof import('../service.js'))['processCheckIn']

const NODE_LAT = -33.9249
const NODE_LNG = 18.4241

beforeAll(async () => {
  process.env['AREA_CODE_ENV'] = 'dev'
  process.env['AREA_CODE_FORCE_LIVE'] = '1'
  ;({ processCheckIn } = await import('../service.js'))
})

afterAll(() => {
  delete process.env['AREA_CODE_FORCE_LIVE']
})

// Randomised consent / relationship / setting inputs. None may suppress the
// live-signal writes.
const scenarioArb = fc.record({
  nodeId: fc.uuid(),
  userId: fc.uuid(),
  cityId: fc.uuid(),
  citySlug: fc.constantFrom('johannesburg', 'cape-town', 'durban'),
  type: fc.constantFrom('reward' as const, 'presence' as const),
  hasBusiness: fc.boolean(),
  canEmitIdentity: fc.boolean(),
  canEmitToFriends: fc.boolean(),
  privacy: fc.constantFrom('public', 'friends', 'private'),
  mutualCount: fc.integer({ min: 0, max: 3 }),
  dailyCount: fc.integer({ min: 1, max: 500 }),
})

describe('Feature: tiered-visibility, Property 1: Check-in always contributes', () => {
  it('recalculates pulse, increments the daily counter, and emits pulse_update for any inputs', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        // Reset only call history; the mock implementations below are re-set each
        // run so cross-run state never leaks.
        for (const fn of Object.values(h)) (fn as ReturnType<typeof vi.fn>).mockClear?.()

        h.kvGet.mockResolvedValue(null) // no cooldown active
        h.kvIncr.mockResolvedValue(s.dailyCount)
        h.canEmitIdentity.mockResolvedValue(s.canEmitIdentity)
        h.canEmitToFriends.mockResolvedValue(s.canEmitToFriends)
        h.getMutualFollowIds.mockResolvedValue(new Set(Array.from({ length: s.mutualCount }, (_, i) => `friend-${i}`)))
        h.getUserById.mockResolvedValue({
          id: s.userId,
          tier: 'local',
          isDisabled: false,
          displayName: 'Nomsa',
          username: 'nomsa',
          avatarUrl: null,
          privacy: s.privacy,
        })
        h.getNodeWithCity.mockResolvedValue({
          id: s.nodeId,
          lat: NODE_LAT,
          lng: NODE_LNG,
          name: 'The Venue',
          cityId: s.cityId,
          qrCheckinEnabled: false,
          businessId: s.hasBusiness ? 'biz-1' : null,
          city: { id: s.cityId, slug: s.citySlug },
        })

        const res = await processCheckIn(s.userId, {
          nodeId: s.nodeId,
          type: s.type,
          lat: NODE_LAT,
          lng: NODE_LNG,
        })

        expect(res.success).toBe(true)

        // 1. Daily counter incremented (R1.2).
        expect(h.kvIncr).toHaveBeenCalledWith(`checkin:today:${s.nodeId}`, expect.any(Number))

        // 2. Pulse score recalculated and stored (R1.1, R1.3).
        const pulseWrites = h.kvSet.mock.calls.filter((c) => String(c[0]).startsWith(`pulse:${s.cityId}:`))
        expect(pulseWrites).toHaveLength(1)
        expect(pulseWrites[0]![0]).toBe(`pulse:${s.cityId}:${s.nodeId}`)

        // 3. node:pulse_update emitted to the city room (R1.4, R1.5, R9.1).
        expect(h.emitPulseUpdate).toHaveBeenCalledTimes(1)
        const [room, payload] = h.emitPulseUpdate.mock.calls[0]! as [string, { nodeId: string }]
        expect(room).toBe(s.citySlug)
        expect(payload.nodeId).toBe(s.nodeId)
      }),
      { numRuns: 120 },
    )
  })
})
