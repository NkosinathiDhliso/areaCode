/**
 * Feature: Proof of demand, Property 5: Going isolation (server side).
 *
 * A Going mark is INTENT. The person is not in the room. So no Going count, of
 * any size, may move a single aliveness number or a single owner-facing measured
 * number (`.kiro/steering/honest-presence.md`, R9.4).
 *
 * The property is asserted as an invariance: the venue reads are run twice over
 * the same venue, once with an arbitrary number of Going marks and once with
 * none, and every field except the two Going fields must be identical. If anyone
 * ever folds the count into the pulse score, the live count, the momentum label
 * or the Pulse_State that drives beam brightness, this fails.
 *
 * The Receipt arm is stronger than invariance: consumers who marked going but
 * never checked in must be absent from the Receipt entirely, so intent can never
 * be sold to an owner as a visit.
 *
 * The `vibeRank` order and the beam geometry are the consumer-side half of the
 * same property and live with the code they govern, in
 * `apps/web/src/lib/__tests__/goingIsolation.property.test.ts`.
 *
 * Validates: Requirements 9.4
 */

import fc from 'fast-check'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  kvBatchGet: vi.fn(),
  getNodeById: vi.fn(),
  getNodeBySlug: vi.fn(),
  getNodesByCitySlug: vi.fn(),
  getCityBySlug: vi.fn(),
  getSchedule: vi.fn(),
  getRewardById: vi.fn(),
  getLivePresenceCount: vi.fn(),
  getMomentum: vi.fn(),
  send: vi.fn(),
}))

vi.mock('../../../shared/config/env.js', () => ({
  DEV_MODE: false,
  APP_ENV: 'test',
  AWS_REGION: 'af-south-1',
  requireEnv: (_name: string, devDefault?: string) => devDefault ?? 'test-value',
  mediaCdnBaseUrl: () => 'https://cdn.example.test',
  webBaseUrl: () => 'https://areacode.co.za',
}))

vi.mock('../../../shared/kv/dynamodb-kv.js', () => ({
  kvGet: mocks.kvGet,
  kvSet: mocks.kvSet,
  kvBatchGet: mocks.kvBatchGet,
  kvDel: vi.fn(),
}))

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.send },
  TableNames: { appData: 'area-code-test-app-data' },
}))

vi.mock('../repository.js', () => ({
  getNodeById: mocks.getNodeById,
  getNodeBySlug: mocks.getNodeBySlug,
  getNodesByCitySlug: mocks.getNodesByCitySlug,
  getCityBySlug: mocks.getCityBySlug,
}))

vi.mock('../../music/schedule-repository.js', () => ({
  DEFAULT_SCHEDULE_ID: 'default',
  getSchedule: mocks.getSchedule,
}))

vi.mock('../../rewards/dynamodb-repository.js', () => ({
  getRewardById: mocks.getRewardById,
  getActiveRewardsByNodeId: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../presence/repository.js', () => ({
  getLivePresenceCount: mocks.getLivePresenceCount,
  getMomentum: mocks.getMomentum,
}))

import { computeReceipt, type ReceiptCheckIn } from '../../reports/receipt.js'
import { pulseStateFromScore, rankGetsByVibe, type GetRankSignals } from '../../rewards/ranking.js'
import { getNodeDetail, getNodePresence, getNodePublic } from '../service.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CITY_SLUG = 'johannesburg'
const NODE_ID = 'node-ramonas'
const NOW_MS = new Date('2026-03-06T21:00:00.000+02:00').getTime()

/** Going marks the mocked table reports for the venue. */
let goingMarks = 0

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_MS)
  goingMarks = 0
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.kvSet.mockResolvedValue(undefined)
  mocks.kvBatchGet.mockResolvedValue(new Map())
  mocks.getCityBySlug.mockResolvedValue({ id: 'city-jhb', slug: CITY_SLUG, name: 'Johannesburg' })
  mocks.getSchedule.mockResolvedValue(null)
  mocks.getRewardById.mockResolvedValue(null)
  mocks.getNodeById.mockResolvedValue({
    id: NODE_ID,
    nodeId: NODE_ID,
    name: 'Ramona',
    slug: 'ramonas',
    category: 'nightlife',
    businessId: 'biz-1',
    city: { name: 'Johannesburg', slug: CITY_SLUG },
    rewards: [],
    boostUntil: null,
  })
  mocks.getNodeBySlug.mockResolvedValue({
    id: NODE_ID,
    name: 'Ramona',
    category: 'nightlife',
    city: { name: 'Johannesburg', slug: CITY_SLUG },
    businessId: 'biz-1',
    headerImageKey: null,
    rewards: [],
  })
  // Every Going read goes through the document client; nothing else does.
  mocks.send.mockImplementation(async (command: { constructor: { name: string } }) => {
    if (command.constructor.name === 'QueryCommand') return { Count: goingMarks }
    if (command.constructor.name === 'GetCommand') return { Item: undefined }
    return {}
  })
})

/** A venue's honest aliveness inputs, independent of anything Going. */
interface Aliveness {
  pulseKvValue: number
  livePresenceCount: number
  momentum: 'filling_up' | 'winding_down' | 'steady'
}

const alivenessArb: fc.Arbitrary<Aliveness> = fc.record({
  pulseKvValue: fc.integer({ min: 0, max: 200 }),
  livePresenceCount: fc.integer({ min: 0, max: 120 }),
  momentum: fc.constantFrom('filling_up' as const, 'winding_down' as const, 'steady' as const),
})

function applyAliveness(a: Aliveness): void {
  mocks.kvGet.mockResolvedValue(String(a.pulseKvValue))
  mocks.getLivePresenceCount.mockResolvedValue(a.livePresenceCount)
  mocks.getMomentum.mockResolvedValue(a.momentum)
}

/** The read without its Going fields: what must not move. */
function withoutGoing<T extends Record<string, unknown>>(payload: T): Omit<T, 'goingCount' | 'viewerGoing'> {
  const {
    goingCount: _count,
    viewerGoing: _viewer,
    ...rest
  } = payload as T & {
    goingCount?: unknown
    viewerGoing?: unknown
  }
  return rest as Omit<T, 'goingCount' | 'viewerGoing'>
}

// ─── Property 5: the venue reads ─────────────────────────────────────────────

describe('Property 5: no Going count moves an aliveness number', () => {
  it('leaves the venue detail identical apart from the Going fields', async () => {
    await fc.assert(
      fc.asyncProperty(alivenessArb, fc.integer({ min: 0, max: 500 }), async (aliveness, marks) => {
        applyAliveness(aliveness)

        goingMarks = 0
        const quiet = await getNodeDetail(NODE_ID)
        goingMarks = marks
        const withMarks = await getNodeDetail(NODE_ID)

        expect(withoutGoing(withMarks)).toEqual(withoutGoing(quiet))
        expect(withMarks.goingCount).toBe(marks)
        // Pulse_State drives beam brightness and the state label; it is a pure
        // function of the pulse score, which Going cannot touch.
        expect(pulseStateFromScore(withMarks.pulseScore)).toBe(pulseStateFromScore(quiet.pulseScore))
      }),
      { numRuns: 100 },
    )
  })

  it('leaves the public venue view identical apart from the Going count', async () => {
    await fc.assert(
      fc.asyncProperty(alivenessArb, fc.integer({ min: 0, max: 500 }), async (aliveness, marks) => {
        applyAliveness(aliveness)

        goingMarks = 0
        const quiet = await getNodePublic('ramonas')
        goingMarks = marks
        const withMarks = await getNodePublic('ramonas')

        expect(withoutGoing(withMarks)).toEqual(withoutGoing(quiet))
        // The live count is who is actually there, never who said they would be.
        expect(withMarks.liveCheckInCount).toBe(aliveness.livePresenceCount)
      }),
      { numRuns: 100 },
    )
  })

  it('leaves the presence read, count and momentum, untouched', async () => {
    await fc.assert(
      fc.asyncProperty(alivenessArb, fc.integer({ min: 0, max: 500 }), async (aliveness, marks) => {
        applyAliveness(aliveness)

        goingMarks = marks
        const presence = await getNodePresence(NODE_ID)

        expect(presence.livePresenceCount).toBe(aliveness.livePresenceCount)
        expect(presence.momentum).toBe(aliveness.momentum)
      }),
      { numRuns: 100 },
    )
  })
})

// ─── Property 5: ranking ─────────────────────────────────────────────────────

/** Ranking signals with a Going count riding along, as a payload would carry it. */
const rankedVenuesArb = fc.array(
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 6 }),
    tasteMatch: fc.integer({ min: 0, max: 5 }),
    aliveness: fc.integer({ min: 0, max: 100 }),
    tierMultiplier: fc.constantFrom(1.0, 1.3, 1.6),
    hasLiveGets: fc.boolean(),
    distanceMeters: fc.integer({ min: 0, max: 20_000 }),
    goingCount: fc.integer({ min: 0, max: 500 }),
  }),
  { minLength: 2, maxLength: 12 },
)

describe('Property 5: no Going count moves the order', () => {
  it('ranks gets identically whether or not a Going count rides along', () => {
    fc.assert(
      fc.property(rankedVenuesArb, (venues) => {
        const withGoing = rankGetsByVibe(venues).map((v) => v.id)
        const withoutGoingCount = rankGetsByVibe(
          venues.map(({ goingCount: _drop, ...signals }) => signals as GetRankSignals),
        ).map((v) => v.id)

        expect(withGoing).toEqual(withoutGoingCount)
      }),
      { numRuns: 200 },
    )
  })

  it('never lets the most-marked venue climb over a more alive one', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 500 }), (alivenessGap, marks) => {
        const alive = {
          id: 'alive',
          tasteMatch: 0,
          aliveness: alivenessGap,
          tierMultiplier: 1.0,
          hasLiveGets: false,
          distanceMeters: 9_000,
          goingCount: 0,
        }
        const merelyIntended = { ...alive, id: 'intended', aliveness: 0, distanceMeters: 10, goingCount: marks }

        expect(rankGetsByVibe([merelyIntended, alive]).map((v) => v.id)).toEqual(['alive', 'intended'])
      }),
      { numRuns: 100 },
    )
  })
})

// ─── Property 5: the Receipt ─────────────────────────────────────────────────

const WINDOW = { windowStartUtc: '2026-03-02T22:00:00.000Z', windowEndUtc: '2026-03-09T22:00:00.000Z' }

describe('Property 5: intent never enters the Receipt', () => {
  it('counts only consumers who checked in, whatever the Going rows say', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            userId: fc.string({ minLength: 1, maxLength: 5 }).map((s) => `visitor-${s}`),
            foundVia: fc.constantFrom('map', 'share', 'search', 'push', 'walk_in'),
          }),
          { maxLength: 15 },
        ),
        fc.array(
          fc.string({ minLength: 1, maxLength: 5 }).map((s) => `intender-${s}`),
          { maxLength: 15 },
        ),
        (visits, goingOnlyUserIds) => {
          const checkIns: ReceiptCheckIn[] = visits.map((v) => ({
            userId: v.userId,
            checkedInAt: '2026-03-06T19:00:00.000Z',
            foundVia: v.foundVia,
          }))

          // The consumers who only marked going are handed to the Receipt the
          // one way intent could ever leak in: as an earliest-visit map entry.
          const earliest: Record<string, string> = {}
          for (const userId of goingOnlyUserIds) {
            earliest[userId] = '2026-03-06T18:00:00.000Z'
          }

          const receipt = computeReceipt(checkIns, WINDOW, earliest)

          // The only inhabitants of the Receipt are people who actually came.
          expect(receipt.uniqueVisitors).toBe(new Set(visits.map((v) => v.userId)).size)
          expect(receipt.foundYouVisitors + receipt.walkInVisitors).toBe(receipt.uniqueVisitors)
          expect(receipt.foundYouFirstTimers).toBeLessThanOrEqual(receipt.foundYouVisitors)
          // Nobody who merely marked going appears anywhere in the numbers.
          expect(JSON.stringify(receipt)).not.toContain('intender')
        },
      ),
      { numRuns: 150 },
    )
  })
})
