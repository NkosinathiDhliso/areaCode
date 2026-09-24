/**
 * The Going count on the venue reads (proof-of-demand R9.2, task 10.1).
 *
 * The count travels with `tonight` on the three reads a venue can be seen
 * through, so the card, the detail block and a shared link can never disagree
 * about how many people marked going. These tests assert:
 *
 *  - the city payload carries the count for venues with a Tonight, and costs one
 *    count read per such venue rather than one per venue on the map
 *  - a venue with no Tonight reports `null`: not measured, never a zero nobody
 *    counted, because the card can only show the count with a Tonight
 *  - the node detail carries the true count, and `viewerGoing` only when the
 *    request identified a consumer
 *  - the public view carries the same count for a stranger with a link
 *  - a count that fails to read is omitted and logged, and never blanks the map
 *
 * The threshold itself is a surfacing rule, applied by the surface (task 10.3),
 * not by these reads: the owner-facing panel needs the true count including zero.
 *
 * _Requirements: 9.2_
 */

import type { MusicSchedule, ScheduleSlot } from '@area-code/shared/types'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  kvBatchGet: vi.fn(),
  getNodesByCitySlug: vi.fn(),
  getCityBySlug: vi.fn(),
  getNodeById: vi.fn(),
  getNodeBySlug: vi.fn(),
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
  getNodesByCitySlug: mocks.getNodesByCitySlug,
  getCityBySlug: mocks.getCityBySlug,
  getNodeById: mocks.getNodeById,
  getNodeBySlug: mocks.getNodeBySlug,
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

import { goingVenuePk, goingVenueSk } from '../going.js'
import { getNodeDetail, getNodePublic, getNodesByCitySlug } from '../service.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CITY_SLUG = 'johannesburg'
const FRIDAY = '2026-03-06'
const NOW_MS = new Date(`${FRIDAY}T21:00:00.000+02:00`).getTime()
const VIEWER = 'user-nomsa'

const DATED_SLOT: ScheduleSlot = {
  slotId: 'dated-1',
  dayOfWeek: 'FRI',
  date: FRIDAY,
  startTime: '20:00',
  endTime: '23:59',
  startTimeMin: 1200,
  endTimeMin: 1439,
  mode: 'blanket',
  genres: ['amapiano'],
  headline: 'Amapiano all night',
}

function schedule(businessId: string, slots: ScheduleSlot[] = [DATED_SLOT]): MusicSchedule {
  return {
    businessId,
    scheduleId: 'default',
    timezone: 'Africa/Johannesburg',
    slots,
    updatedAt: '2026-03-01T00:00:00.000Z',
    schemaVersion: 1,
  }
}

function repoNode(id: string, businessId: string) {
  return {
    id,
    name: `${id} name`,
    slug: `${id}-slug`,
    category: 'nightlife',
    lat: -26.2041,
    lng: 28.0473,
    claimStatus: 'claimed',
    nodeColour: '#888',
    nodeIcon: null,
    isVerified: true,
    headerImageKey: null,
    socialLinks: {},
    businessId,
    businessTier: 'growth',
    boostUntil: null,
  }
}

/** Marks in the mocked table, keyed `pk|sk`. */
const marks = new Set<string>()

function mark(nodeId: string, userId: string, date = FRIDAY): void {
  marks.add(`${goingVenuePk(nodeId, date)}|${goingVenueSk(userId)}`)
}

/** Node ids the payload assembly actually counted. */
function countedNodeIds(): string[] {
  return mocks.send.mock.calls
    .filter(([command]) => command?.constructor?.name === 'QueryCommand')
    .map(([command]) => String((command as { input: any }).input.ExpressionAttributeValues[':pk']))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_MS)
  marks.clear()
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.kvGet.mockResolvedValue(null)
  mocks.kvSet.mockResolvedValue(undefined)
  mocks.kvBatchGet.mockResolvedValue(new Map())
  mocks.getCityBySlug.mockResolvedValue({ id: 'city-jhb', slug: CITY_SLUG, name: 'Johannesburg' })
  mocks.getSchedule.mockResolvedValue(null)
  mocks.getRewardById.mockResolvedValue(null)
  mocks.getLivePresenceCount.mockResolvedValue(0)
  mocks.getMomentum.mockResolvedValue('steady')
  mocks.send.mockImplementation(async (command: { constructor: { name: string }; input: any }) => {
    if (command.constructor.name === 'QueryCommand') {
      const pk = command.input.ExpressionAttributeValues[':pk'] as string
      return { Count: [...marks].filter((id) => id.startsWith(`${pk}|`)).length }
    }
    if (command.constructor.name === 'GetCommand') {
      const { pk, sk } = command.input.Key as { pk: string; sk: string }
      return { Item: marks.has(`${pk}|${sk}`) ? { markedAt: '2026-03-06T19:00:00.000Z' } : undefined }
    }
    return {}
  })
})

// ─── City payload ────────────────────────────────────────────────────────────

describe('getNodesByCitySlug, the Going count on the card payload (R9.2)', () => {
  it('carries the count for a venue with a Tonight', async () => {
    mocks.getNodesByCitySlug.mockResolvedValue([repoNode('node-a', 'biz-1')])
    mocks.getSchedule.mockResolvedValue(schedule('biz-1'))
    mark('node-a', 'user-1')
    mark('node-a', 'user-2')
    mark('node-a', 'user-3')

    const nodes = await getNodesByCitySlug(CITY_SLUG)

    expect(nodes[0]).toMatchObject({ id: 'node-a', goingCount: 3 })
  })

  it('reports null, not zero, for a venue with nothing on tonight', async () => {
    mocks.getNodesByCitySlug.mockResolvedValue([repoNode('node-a', 'biz-1')])
    mark('node-a', 'user-1')

    const nodes = await getNodesByCitySlug(CITY_SLUG)

    expect(nodes[0]).toMatchObject({ tonight: null, goingCount: null })
  })

  it('counts only the venues whose count the card could show', async () => {
    mocks.getNodesByCitySlug.mockResolvedValue([
      repoNode('node-a', 'biz-1'),
      repoNode('node-b', 'biz-1'),
      repoNode('node-c', 'biz-2'),
    ])
    mocks.getSchedule.mockImplementation((businessId: string) =>
      Promise.resolve(businessId === 'biz-1' ? schedule('biz-1') : null),
    )

    await getNodesByCitySlug(CITY_SLUG)

    // biz-1's two venues have a Tonight; biz-2's venue is never counted.
    expect(countedNodeIds().sort()).toEqual([goingVenuePk('node-a', FRIDAY), goingVenuePk('node-b', FRIDAY)])
  })

  it('omits the count and logs when a partition cannot be counted', async () => {
    mocks.getNodesByCitySlug.mockResolvedValue([repoNode('node-a', 'biz-1')])
    mocks.getSchedule.mockResolvedValue(schedule('biz-1'))
    mocks.send.mockRejectedValue(new Error('dynamo exploded'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const nodes = await getNodesByCitySlug(CITY_SLUG)

    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.goingCount).toBeNull()
    expect(nodes[0]!.tonight).not.toBeNull()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

// ─── Node detail ─────────────────────────────────────────────────────────────

describe('getNodeDetail, the Going count and the viewer state (R9.2)', () => {
  beforeEach(() => {
    mocks.getNodeById.mockResolvedValue({
      id: 'node-a',
      nodeId: 'node-a',
      name: 'Ramona',
      slug: 'ramona',
      category: 'nightlife',
      businessId: 'biz-1',
      city: { name: 'Johannesburg', slug: CITY_SLUG },
      rewards: [],
      boostUntil: null,
    })
  })

  it('carries the true count, including zero, with no Tonight needed', async () => {
    const detail = await getNodeDetail('node-a')

    expect(detail.goingCount).toBe(0)
  })

  it('says whether this consumer marked going', async () => {
    mark('node-a', VIEWER)

    expect(await getNodeDetail('node-a', VIEWER)).toMatchObject({ goingCount: 1, viewerGoing: true })
    expect(await getNodeDetail('node-a', 'user-someone-else')).toMatchObject({ goingCount: 1, viewerGoing: false })
  })

  it('says nothing about a viewer it cannot identify', async () => {
    mark('node-a', VIEWER)

    const detail = await getNodeDetail('node-a')

    expect(detail.goingCount).toBe(1)
    expect('viewerGoing' in detail).toBe(false)
  })
})

// ─── Public view ─────────────────────────────────────────────────────────────

describe('getNodePublic, the Going count for a stranger with a link (R9.2)', () => {
  beforeEach(() => {
    mocks.getNodeBySlug.mockResolvedValue({
      id: 'node-a',
      name: "Ramona's",
      category: 'nightlife',
      city: { name: 'Johannesburg', slug: CITY_SLUG },
      businessId: 'biz-1',
      headerImageKey: null,
      rewards: [],
    })
  })

  it('carries the same count the detail read reports', async () => {
    mark('node-a', 'user-1')
    mark('node-a', 'user-2')

    const view = await getNodePublic('ramona')

    expect(view.goingCount).toBe(2)
    // Intent is its own number: it never joins the live presence count.
    expect(view.liveCheckInCount).toBe(0)
  })
})
