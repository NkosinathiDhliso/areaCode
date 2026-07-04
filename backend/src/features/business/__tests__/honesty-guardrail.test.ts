/**
 * Cross-cutting guardrail — Part A: repository derivation (R8).
 *
 * **Validates: Requirements 8.1, 8.3**
 *
 * The DEV_MODE branch of the business service returns fixed, realistic
 * constants (`getLiveStats` → pulseScore 45 / rewardsClaimed 12 / totalCheckIns
 * 1247, `getAudienceAnalytics` → totalUniqueVisitors 247 / repeatVsNew
 * {180,67}, `getMusicAudience` → all zeros/empties). Those constants must never
 * be the source of a production value.
 *
 * This suite drives the REPOSITORY functions directly (repository.ts). The
 * DEV_MODE branch lives one layer up in service.ts, so calling the repository
 * is inherently the non-DEV production path. Fed a known non-trivial dataset
 * (two nodes, distinct users with tiers + music genres, a pulse KV, some
 * redemptions), the returned metric fields must be DERIVED from that dataset
 * and must NOT equal the DEV_MODE constants. It also covers the honest-absence
 * path (no pulse row → pulseScore null; below-threshold music → insufficient).
 *
 * Runs under the standard `pnpm test` (default node env), never gated behind
 * DEV_MODE (Req 8.3).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ─── DEV_MODE constants that production must NOT equal ───────────────────────
// Kept here verbatim so a change to the service fixtures is caught by review.
const DEV_LIVE_STATS = { checkInsToday: 34, rewardsClaimed: 12, pulseScore: 45, totalCheckIns: 1247 }
const DEV_AUDIENCE = {
  tierDistribution: { local: 40, regular: 30, fixture: 20, institution: 8, legend: 2 },
  repeatVsNew: { repeat: 180, new: 67 },
  totalUniqueVisitors: 247,
  peakHours: ['12:00-14:00', '18:00-21:00'],
}
const DEV_MUSIC = {
  totalWithMusicPrefs: 0,
  genreDistribution: {},
  archetypeBreakdown: {},
  peakArchetypeByTime: [],
}

// ─── Mutable mock state + doubles (vi.hoisted so factories can reference it) ──

const h = vi.hoisted(() => {
  interface RepoCheckIn {
    userId: string
    checkedInAt: string
  }
  const state = {
    nodes: [] as Array<{ nodeId: string; cityId?: string }>,
    checkInsByNode: new Map<string, RepoCheckIn[]>(),
    pulseByKey: new Map<string, string>(),
    userRecords: new Map<string, Record<string, unknown>>(),
    redemptions: [] as unknown[],
  }

  const USERS_TABLE = 'users'

  // In-memory documentClient router. Only the two command shapes these three
  // repository functions issue are modelled: the BusinessIndex node query and
  // the users BatchGet (tiers / music prefs).
  const sendMock = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const name = cmd.constructor.name
    const input = cmd.input ?? {}
    if (name === 'QueryCommand') {
      if (input['IndexName'] === 'BusinessIndex') {
        return { Items: state.nodes.map((n) => ({ nodeId: n.nodeId, cityId: n.cityId })) }
      }
      return { Items: [] }
    }
    if (name === 'BatchGetCommand') {
      const requestItems = input['RequestItems'] as Record<string, { Keys: Array<{ userId: string }> }>
      const table = Object.keys(requestItems)[0]!
      const keys = requestItems[table]!.Keys
      const items = keys.map((k) => state.userRecords.get(k.userId)).filter((v): v is Record<string, unknown> => !!v)
      return { Responses: { [table]: items } }
    }
    return {}
  })

  const kvGetMock = vi.fn(async (key: string) => state.pulseByKey.get(key) ?? null)
  const getCheckInsByNodeMock = vi.fn(async (nodeId: string) => ({
    checkIns: state.checkInsByNode.get(nodeId) ?? [],
  }))
  const listRedemptionsMock = vi.fn(async () => state.redemptions)

  return { state, USERS_TABLE, sendMock, kvGetMock, getCheckInsByNodeMock, listRedemptionsMock }
})

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: h.sendMock },
  TableNames: {
    appData: 'app-data',
    users: h.USERS_TABLE,
    nodes: 'nodes',
    checkins: 'checkins',
    rewards: 'rewards',
    businesses: 'businesses',
  },
  isConditionalCheckFailedError: (err: unknown): boolean =>
    (err as { name?: string } | null)?.name === 'ConditionalCheckFailedException',
}))

vi.mock('../../../shared/kv/dynamodb-kv.js', () => ({ kvGet: h.kvGetMock }))

vi.mock('../../check-in/dynamodb-repository.js', () => ({ getCheckInsByNode: h.getCheckInsByNodeMock }))

vi.mock('../staff-leaderboard.js', () => ({ listRedemptionsForBusiness: h.listRedemptionsMock }))

import { getLiveStats, getAudienceAnalytics, getMusicAudience } from '../repository.js'

// ─── Known non-trivial dataset ───────────────────────────────────────────────
//
// Two nodes in city-1. Eight check-ins across six distinct users; u1 and u2
// each check in twice (repeat visitors). Distinct tiers per user. Every user
// has declared music genres. Pulse rows: node-a 62, node-b 30 → max 62.

const BUSINESS_ID = 'biz-1'

function loadRichDataset(): void {
  h.state.nodes = [
    { nodeId: 'node-a', cityId: 'city-1' },
    { nodeId: 'node-b', cityId: 'city-1' },
  ]
  h.state.checkInsByNode = new Map([
    [
      'node-a',
      [
        { userId: 'u1', checkedInAt: '2026-01-05T18:30:00Z' },
        { userId: 'u1', checkedInAt: '2026-01-06T19:00:00Z' },
        { userId: 'u2', checkedInAt: '2026-01-05T18:45:00Z' },
        { userId: 'u3', checkedInAt: '2026-01-05T19:15:00Z' },
        { userId: 'u4', checkedInAt: '2026-01-05T20:00:00Z' },
      ],
    ],
    [
      'node-b',
      [
        { userId: 'u5', checkedInAt: '2026-01-05T12:30:00Z' },
        { userId: 'u6', checkedInAt: '2026-01-05T13:00:00Z' },
        { userId: 'u2', checkedInAt: '2026-01-06T18:00:00Z' },
      ],
    ],
  ])
  h.state.pulseByKey = new Map([
    ['pulse:city-1:node-a', '62'],
    ['pulse:city-1:node-b', '30'],
  ])
  h.state.userRecords = new Map<string, Record<string, unknown>>([
    ['u1', userRecord('u1', 'local', ['amapiano', 'house'])],
    ['u2', userRecord('u2', 'regular', ['amapiano'])],
    ['u3', userRecord('u3', 'fixture', ['house', 'hiphop'])],
    ['u4', userRecord('u4', 'local', ['amapiano'])],
    ['u5', userRecord('u5', 'legend', ['jazz'])],
    ['u6', userRecord('u6', 'institution', ['amapiano', 'jazz'])],
  ])
  // Seven same-day redemptions → rewardsClaimed 7 (not the DEV constant 12).
  h.state.redemptions = Array.from({ length: 7 }, (_, i) => ({ redeemedAt: `2026-01-06T1${i}:00:00Z` }))
}

function userRecord(userId: string, tier: string, genres: string[]): Record<string, unknown> {
  return {
    userId,
    tier,
    musicGenres: genres,
    energy: 60,
    cultural_rootedness: 55,
    sophistication: 50,
    edge: 45,
    spirituality: 40,
  }
}

beforeEach(() => {
  h.sendMock.mockClear()
  h.kvGetMock.mockClear()
  h.getCheckInsByNodeMock.mockClear()
  h.listRedemptionsMock.mockClear()
  loadRichDataset()
})

// ─── getLiveStats (Req 8.1 / 1.1–1.4) ────────────────────────────────────────

describe('getLiveStats derives production metrics (not the DEV_MODE constants)', () => {
  it('pulseScore is the max per-node pulse, rewardsClaimed/totalCheckIns are counted from the dataset', async () => {
    const stats = await getLiveStats(BUSINESS_ID)

    // Derived from the dataset.
    expect(stats.pulseScore).toBe(62) // max(62, 30), never a sum, never 45
    expect(stats.rewardsClaimed).toBe(7) // count of same-day redemption rows
    expect(stats.totalCheckIns).toBe(8) // 5 on node-a + 3 on node-b
    expect(stats.checkInsToday).toBe(8)

    // NOT the DEV_MODE constants — the whole point of the guardrail.
    expect(stats.pulseScore).not.toBe(DEV_LIVE_STATS.pulseScore)
    expect(stats.rewardsClaimed).not.toBe(DEV_LIVE_STATS.rewardsClaimed)
    expect(stats.totalCheckIns).not.toBe(DEV_LIVE_STATS.totalCheckIns)
    expect(stats).not.toEqual(DEV_LIVE_STATS)
  })

  it('honest-absence: no pulse row for any node → pulseScore null, never a fabricated 0 or 45', async () => {
    h.state.pulseByKey = new Map() // no pulse rows at all
    const stats = await getLiveStats(BUSINESS_ID)
    expect(stats.pulseScore).toBeNull()
    expect(stats.pulseScore).not.toBe(0)
    expect(stats.pulseScore).not.toBe(DEV_LIVE_STATS.pulseScore)
  })
})

// ─── getAudienceAnalytics (Req 8.1 / 2.1–2.5) ─────────────────────────────────

describe('getAudienceAnalytics derives production metrics (not the DEV_MODE constants)', () => {
  it('repeatVsNew / tierDistribution / totalUniqueVisitors are derived from the loaded history', async () => {
    const audience = await getAudienceAnalytics(BUSINESS_ID)

    // Dashboard repeat definition: distinct users with >1 check-in are repeat.
    // u1 (2) and u2 (2) → repeat 2; u3,u4,u5,u6 → new 4.
    expect(audience.totalUniqueVisitors).toBe(6)
    expect(audience.repeatVsNew).toEqual({ repeat: 2, new: 4 })

    // tierDistribution / peakHours are computed (6 unique >= the display gate).
    expect(audience.tierDistribution).not.toBeNull()
    expect(audience.peakHours).not.toBeNull()
    expect(Object.keys(audience.tierDistribution ?? {}).length).toBeGreaterThan(0)

    // NOT the DEV_MODE constants.
    expect(audience.totalUniqueVisitors).not.toBe(DEV_AUDIENCE.totalUniqueVisitors)
    expect(audience.repeatVsNew).not.toEqual(DEV_AUDIENCE.repeatVsNew)
    expect(audience.tierDistribution).not.toEqual(DEV_AUDIENCE.tierDistribution)
    expect(audience.peakHours).not.toEqual(DEV_AUDIENCE.peakHours)
  })

  it('honest-absence: below the display threshold → null metric groups, never zeroed numbers', async () => {
    // Two distinct users, one check-in each — under the 5-visitor gate.
    h.state.nodes = [{ nodeId: 'node-a', cityId: 'city-1' }]
    h.state.checkInsByNode = new Map([
      [
        'node-a',
        [
          { userId: 'u1', checkedInAt: '2026-01-05T18:30:00Z' },
          { userId: 'u2', checkedInAt: '2026-01-05T18:45:00Z' },
        ],
      ],
    ])
    const audience = await getAudienceAnalytics(BUSINESS_ID)
    expect(audience.totalUniqueVisitors).toBe(2)
    expect(audience.repeatVsNew).toBeNull()
    expect(audience.tierDistribution).toBeNull()
    expect(audience.peakHours).toBeNull()
  })
})

// ─── getMusicAudience (Req 8.1 / 3.1–3.3) ─────────────────────────────────────

describe('getMusicAudience derives production metrics (not the DEV_MODE stub)', () => {
  it('totalWithMusicPrefs / genreDistribution are derived from real visitor music data', async () => {
    const music = await getMusicAudience(BUSINESS_ID)

    expect(music.hasInsufficientData).toBe(false)
    expect(music.totalWithMusicPrefs).toBe(6)
    expect(Object.keys(music.genreDistribution).length).toBeGreaterThan(0)
    expect(Object.keys(music.archetypeBreakdown).length).toBeGreaterThan(0)

    // NOT the DEV_MODE zero/empty stub.
    expect(music.totalWithMusicPrefs).not.toBe(DEV_MUSIC.totalWithMusicPrefs)
    expect(music.genreDistribution).not.toEqual(DEV_MUSIC.genreDistribution)
    expect(music.archetypeBreakdown).not.toEqual(DEV_MUSIC.archetypeBreakdown)
  })

  it('honest-absence: fewer than the minimum with prefs → hasInsufficientData true, not a fabricated distribution', async () => {
    // Six visitors, but only three declare genres — under the analyzer's gate (5).
    h.state.userRecords = new Map<string, Record<string, unknown>>([
      ['u1', userRecord('u1', 'local', ['amapiano'])],
      ['u2', userRecord('u2', 'regular', ['house'])],
      ['u3', userRecord('u3', 'fixture', ['jazz'])],
      ['u4', { userId: 'u4', tier: 'local' }],
      ['u5', { userId: 'u5', tier: 'legend' }],
      ['u6', { userId: 'u6', tier: 'institution' }],
    ])
    const music = await getMusicAudience(BUSINESS_ID)
    expect(music.hasInsufficientData).toBe(true)
    expect(music.genreDistribution).toEqual({})
    expect(music.archetypeBreakdown).toEqual({})
  })
})
