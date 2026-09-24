/**
 * Found_Via stamped on the check-in (proof-of-demand R3.1 to R3.6, R11.2).
 *
 * This is the seam where "N people found you on Area Code and checked in" becomes
 * a measurement. The pure rule is covered by `found-via.test.ts` and
 * `found-via.property.test.ts`; what is covered here is the wiring the owner's
 * number actually depends on:
 *
 *  - a check-in with no Venue_Open row is stored as `walk_in`, so a QR scan at the
 *    till never reads as demand Area Code created
 *  - a row that passes the Away_Gate is stored as its own source, and the row is
 *    then consumed, so one open earns credit once
 *  - a row that fails the gate (opened in the room, minutes before) is a
 *    `walk_in`, and is still consumed
 *  - an offline replay is judged at `capturedAt`, not at the moment it drained
 *  - a client that posts its own `foundVia` is ignored: the value is
 *    server-derived, and the body schema strips the key
 *  - a duplicate replay delivery writes no second check-in, so a stamp is never
 *    replaced by a second one
 *  - the business socket payloads carry `foundVia` through the real privacy
 *    guard, so the live panel can split the two counts
 *
 * Strategy: `processCheckIn` returns early in DEV_MODE, so the env is `dev` +
 * `AREA_CODE_FORCE_LIVE` and the service is imported dynamically afterwards — the
 * same pattern as the sibling check-in suites. The I/O surface is mocked; the real
 * `found-via`, `venue-open` and `privacy-guard` modules run, and the KV mock is
 * keyed so the cooldown read and the Venue_Open read are distinguishable.
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 11.2_
 */

import { AWAY_GATE_MIN_MINUTES } from '@area-code/shared/constants/attribution'
import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'

import { SAST_OFFSET_MS } from '../../../shared/time/sast.js'

const h = vi.hoisted(() => ({
  kvGet: vi.fn(async (_key: string): Promise<string | null> => null),
  kvSet: vi.fn(async (_key: string, _value: string, _ttlSeconds?: number) => undefined),
  kvDel: vi.fn(async (_key: string) => undefined),
  kvIncr: vi.fn(async (_key: string, _ttlSeconds?: number) => 1),
  kvTtl: vi.fn(async (_key: string) => 0),
  emitPulseUpdate: vi.fn(async () => undefined),
  emitPresenceUpdate: vi.fn(async () => undefined),
  emitToast: vi.fn(async () => undefined),
  emitBusinessCheckin: vi.fn(async () => undefined),
  emitBusinessCheckinDetail: vi.fn(async () => undefined),
  emitFriendToast: vi.fn(async () => undefined),
  emitTierChanged: vi.fn(async () => undefined),
  canEmitIdentity: vi.fn(async () => false),
  canEmitToFriends: vi.fn(async () => false),
  send: vi.fn(async () => ({})),
  getUserById: vi.fn(async () => ({ userId: 'user-nomsa', tier: 'local', isDisabled: false })),
  createOrRefreshPresence: vi.fn(async () => ({ opened: false })),
  getLivePresenceCount: vi.fn(async () => 0),
  recordPresenceSample: vi.fn(async () => null),
  getMutualFollowIds: vi.fn(async () => new Set<string>()),
  getFollowingIds: vi.fn(async () => [] as string[]),
  runAbuseChecks: vi.fn(async () => undefined),
  getUserCheckInCountAtNode: vi.fn(async () => 1),
  incrementLeaderboard: vi.fn(async () => undefined),
  incrementNodeCheckInTotal: vi.fn(async () => 1),
  getNodeWithCity: vi.fn(),
  insertCheckIn: vi.fn(async () => ({ checkInId: 'ci-1' })),
  claimReplayCheckIn: vi.fn(async () => true),
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
  kvDel: h.kvDel,
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

// Real `sanitizeForBusiness`: the allowlist is part of what R3.6 asserts, so it
// must be the production one, not a pass-through.
vi.mock('../../../shared/privacy/privacy-guard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/privacy/privacy-guard.js')>()
  return { ...actual, canEmitIdentity: h.canEmitIdentity, canEmitToFriends: h.canEmitToFriends }
})

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
  claimReplayCheckIn: h.claimReplayCheckIn,
  incrementTotalCheckIns: h.incrementTotalCheckIns,
  incrementNodeCheckInTotal: h.incrementNodeCheckInTotal,
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

import { checkInBodySchema } from '../types.js'
import { venueOpenKey } from '../venue-open.js'

let processCheckIn: (typeof import('../service.js'))['processCheckIn']

const USER_ID = 'user-nomsa'
const NODE_ID = 'node-ramonas'
const OPEN_KEY = venueOpenKey(USER_ID, NODE_ID)
const NODE_LAT = -33.9249
const NODE_LNG = 18.4241
const MINUTE_MS = 60_000

beforeAll(async () => {
  process.env['AREA_CODE_ENV'] = 'dev'
  process.env['AREA_CODE_FORCE_LIVE'] = '1'
  ;({ processCheckIn } = await import('../service.js'))
})

afterAll(() => {
  delete process.env['AREA_CODE_FORCE_LIVE']
})

beforeEach(() => {
  for (const fn of Object.values(h)) (fn as ReturnType<typeof vi.fn>).mockClear?.()
  h.kvGet.mockResolvedValue(null)
  h.claimReplayCheckIn.mockResolvedValue(true)
  h.canEmitIdentity.mockResolvedValue(false)
  h.getUserById.mockResolvedValue({ userId: USER_ID, tier: 'local', isDisabled: false })
  h.getNodeWithCity.mockResolvedValue({
    id: NODE_ID,
    lat: NODE_LAT,
    lng: NODE_LNG,
    name: "Ramona's",
    cityId: 'city-jhb',
    qrCheckinEnabled: true,
    businessId: 'biz-1',
    city: { id: 'city-jhb', slug: 'johannesburg' },
  })
})

/** Put a Venue_Open row in the KV, opened `minutesAgo` before now. */
function withOpenRow(opts: { minutesAgo: number; source?: string; away?: boolean | null }) {
  const row = {
    source: opts.source ?? 'map',
    openedAt: new Date(Date.now() - opts.minutesAgo * MINUTE_MS).toISOString(),
    away: opts.away ?? null,
  }
  h.kvGet.mockImplementation(async (key: string) => (key === OPEN_KEY ? JSON.stringify(row) : null))
  return row
}

/** The `foundVia` the service handed the repository. */
function stampedFoundVia(): string {
  expect(h.insertCheckIn).toHaveBeenCalledTimes(1)
  const [data] = h.insertCheckIn.mock.calls[0]! as unknown as [{ foundVia: string }]
  return data.foundVia
}

/** The payload of a business emit, as it left the service. */
function emittedPayload(mock: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  const [, payload] = mock.mock.calls[0]! as unknown as [string, Record<string, unknown>]
  return payload
}

async function checkIn(extra: Record<string, unknown> = {}) {
  const input = {
    nodeId: NODE_ID,
    type: 'presence',
    lat: NODE_LAT,
    lng: NODE_LNG,
    ...extra,
  }
  return processCheckIn(USER_ID, input as unknown as Parameters<typeof processCheckIn>[1])
}

// ─── The stamp ──────────────────────────────────────────────────────────────

describe('check-in Found_Via stamp (R3.1, R3.2, R3.3)', () => {
  it('stamps walk_in when the consumer never opened the venue', async () => {
    await checkIn()

    expect(stampedFoundVia()).toBe('walk_in')
    expect(h.kvDel).not.toHaveBeenCalledWith(OPEN_KEY)
  })

  it('stamps the open source when the time arm of the Away_Gate passes', async () => {
    withOpenRow({ minutesAgo: AWAY_GATE_MIN_MINUTES + 5, source: 'share' })

    await checkIn()

    expect(stampedFoundVia()).toBe('share')
  })

  it('stamps the open source when the consumer was away, however recent the open', async () => {
    withOpenRow({ minutesAgo: 1, source: 'map', away: true })

    await checkIn()

    expect(stampedFoundVia()).toBe('map')
  })

  it('stamps walk_in when the consumer opened the app in the room minutes before', async () => {
    withOpenRow({ minutesAgo: AWAY_GATE_MIN_MINUTES - 5, source: 'map', away: false })

    await checkIn()

    expect(stampedFoundVia()).toBe('walk_in')
  })

  it('consumes the row, so one open earns credit once', async () => {
    withOpenRow({ minutesAgo: AWAY_GATE_MIN_MINUTES + 5, source: 'map' })

    await checkIn()

    expect(h.kvDel).toHaveBeenCalledWith(OPEN_KEY)
  })

  it('consumes a row that failed the gate too, so it cannot ripen into credit', async () => {
    withOpenRow({ minutesAgo: 2, source: 'map', away: false })

    await checkIn()

    expect(stampedFoundVia()).toBe('walk_in')
    expect(h.kvDel).toHaveBeenCalledWith(OPEN_KEY)
  })

  it('still writes the check-in when the attribution read fails, stamping walk_in', async () => {
    h.kvGet.mockImplementation(async (key: string) => {
      if (key === OPEN_KEY) throw new Error('dynamo unavailable')
      return null
    })

    const res = await checkIn()

    expect(res.success).toBe(true)
    expect(stampedFoundVia()).toBe('walk_in')
  })
})

// ─── Offline replay ─────────────────────────────────────────────────────────

describe('check-in Found_Via on an offline replay (R3.1, R3.2)', () => {
  it('judges the gate at capturedAt, not at the moment the queue drained', async () => {
    // Opened 15 minutes before the check-in actually happened (under the gate),
    // 25 minutes before it was delivered (over the gate). The honest answer is the
    // one measured at capture: walk_in.
    const capturedAt = new Date(Date.now() - 10 * MINUTE_MS).toISOString()
    withOpenRow({ minutesAgo: 25, source: 'map', away: null })

    await checkIn({ capturedAt })

    expect(stampedFoundVia()).toBe('walk_in')
  })

  it('credits a replay whose open cleared the gate before capture', async () => {
    const capturedAt = new Date(Date.now() - 5 * MINUTE_MS).toISOString()
    withOpenRow({ minutesAgo: AWAY_GATE_MIN_MINUTES + 10, source: 'share', away: null })

    await checkIn({ capturedAt })

    expect(stampedFoundVia()).toBe('share')
  })

  it('writes no second check-in on a duplicate delivery, so the first stamp stands', async () => {
    h.claimReplayCheckIn.mockResolvedValue(false)
    withOpenRow({ minutesAgo: AWAY_GATE_MIN_MINUTES + 5, source: 'map' })

    const res = await checkIn({ capturedAt: new Date(Date.now() - MINUTE_MS).toISOString() })

    expect(res.success).toBe(true)
    expect(h.insertCheckIn).not.toHaveBeenCalled()
    expect(h.kvDel).not.toHaveBeenCalledWith(OPEN_KEY)
  })
})

// ─── Server-derived only ────────────────────────────────────────────────────

describe('Found_Via is server-derived only (R3.5)', () => {
  it('strips a client-supplied foundVia at the boundary', () => {
    const parsed = checkInBodySchema.parse({
      nodeId: NODE_ID,
      type: 'presence',
      lat: NODE_LAT,
      lng: NODE_LNG,
      foundVia: 'share',
    })

    expect(parsed).not.toHaveProperty('foundVia')
  })

  it('ignores a client-supplied foundVia even if one reaches the service', async () => {
    await checkIn({ foundVia: 'share' })

    expect(stampedFoundVia()).toBe('walk_in')
  })
})

// ─── Socket payloads ────────────────────────────────────────────────────────

describe('business socket payloads carry Found_Via (R3.6, R11.2)', () => {
  it('survives the privacy guard on business:checkin', async () => {
    withOpenRow({ minutesAgo: AWAY_GATE_MIN_MINUTES + 5, source: 'share' })

    await checkIn()

    expect(h.emitBusinessCheckin).toHaveBeenCalledTimes(1)
    const payload = emittedPayload(h.emitBusinessCheckin)
    expect(payload['foundVia']).toBe('share')
    // Still no consumer identity alongside it.
    expect(payload).not.toHaveProperty('userId')
  })

  it('is present on business:checkin_detail', async () => {
    withOpenRow({ minutesAgo: 1, source: 'push', away: true })

    await checkIn()

    expect(h.emitBusinessCheckinDetail).toHaveBeenCalledTimes(1)
    expect(emittedPayload(h.emitBusinessCheckinDetail)['foundVia']).toBe('push')
  })

  it('reports walk_in on the payload rather than omitting the field', async () => {
    await checkIn()

    expect(emittedPayload(h.emitBusinessCheckin)['foundVia']).toBe('walk_in')
  })
})

// ─── Cached business row: SAST day partition (R15.8) ────────────────────────

/** The `pk` of the BIZ_CHECKIN cache row the service wrote, if any. */
function cachedRowPk(): string | null {
  for (const [command] of h.send.mock.calls as unknown as Array<[{ input?: Record<string, unknown> }]>) {
    const item = command?.input?.['Item'] as Record<string, unknown> | undefined
    const pk = item?.['pk']
    if (typeof pk === 'string' && pk.startsWith('BIZ_CHECKIN#')) return pk
  }
  return null
}

describe('business check-in cache row is partitioned by the SAST date (R15.8)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('files a 23:30 SAST check-in on the night it happened, not on tomorrow', async () => {
    // 23:30 SAST on 15 October is 21:30 UTC the same day — but 00:30 SAST is
    // 22:30 UTC the day BEFORE, which is where the UTC partition used to put it.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.parse('2026-10-16T00:00:00.000Z') - SAST_OFFSET_MS - 30 * MINUTE_MS))

    await checkIn()

    expect(cachedRowPk()).toBe('BIZ_CHECKIN#biz-1#2026-10-15')
  })

  it('files an 00:30 SAST check-in on the new SAST day', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.parse('2026-10-16T00:00:00.000Z') - SAST_OFFSET_MS + 30 * MINUTE_MS))

    await checkIn()

    // The UTC date at that instant is still the 15th; the owner's day is not.
    expect(cachedRowPk()).toBe('BIZ_CHECKIN#biz-1#2026-10-16')
  })
})
