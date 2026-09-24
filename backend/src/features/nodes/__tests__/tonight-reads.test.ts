/**
 * Tonight on the three venue reads (proof-of-demand tasks 9.2 and 9.5).
 *
 * One reader serves the city payload, the node detail and the public node view,
 * so a venue cannot look different depending on which door a consumer came in
 * through. These tests assert:
 *
 *  - the city payload attaches the summary per node, with ONE schedule read per
 *    distinct business rather than one per node (business-wide scope)
 *  - the node detail and the public view carry the same summary
 *  - the Share_Preview snapshot line carries the Tonight headline (task 9.5)
 *  - a business with nothing published reads `tonight: null`, never a
 *    placeholder
 *
 * _Requirements: 8.5, 1.2_
 */

import type { MusicSchedule, ScheduleSlot } from '@area-code/shared/types'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ────────────────────────────────────────────────────────────

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

vi.mock('../repository.js', () => ({
  getNodesByCitySlug: mocks.getNodesByCitySlug,
  getCityBySlug: mocks.getCityBySlug,
  getNodeById: mocks.getNodeById,
  getNodeBySlug: mocks.getNodeBySlug,
}))

// The venue reads also count Going marks (R9.2). Zero here: this suite is about
// Tonight, and the Going count is a separate number that never touches it. The
// count itself is covered in `going-reads.test.ts`.
vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: vi.fn(async () => ({ Count: 0 })) },
  TableNames: { appData: 'area-code-test-app-data' },
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

import { getNodeDetail, getNodePublic, getNodesByCitySlug, getNodeSharePreview } from '../service.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CITY_SLUG = 'johannesburg'
const CITY_ID = 'city-jhb'
const TIMEZONE = 'Africa/Johannesburg'

/** A Friday, comfortably inside the Dated_Slot horizon. */
const FRIDAY = '2026-03-06'
const NOW_MS = new Date(`${FRIDAY}T21:00:00.000+02:00`).getTime()

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
  featuredRewardId: 'reward-1',
}

function schedule(businessId: string, slots: ScheduleSlot[] = [DATED_SLOT]): MusicSchedule {
  return {
    businessId,
    scheduleId: 'default',
    timezone: TIMEZONE,
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
    boostActive: false,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_MS)
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.kvGet.mockResolvedValue(null)
  mocks.kvSet.mockResolvedValue(undefined)
  mocks.kvBatchGet.mockResolvedValue(new Map())
  mocks.getCityBySlug.mockResolvedValue({ id: CITY_ID, slug: CITY_SLUG, name: 'Johannesburg' })
  mocks.getSchedule.mockResolvedValue(null)
  mocks.getRewardById.mockResolvedValue(null)
  mocks.getLivePresenceCount.mockResolvedValue(0)
  mocks.getMomentum.mockResolvedValue('steady')
})

// ─── City payload ────────────────────────────────────────────────────────────

describe('getNodesByCitySlug, Tonight on the city payload (R8.5)', () => {
  it('attaches the summary to every node of the publishing business', async () => {
    mocks.getNodesByCitySlug.mockResolvedValue([
      repoNode('node-a', 'biz-1'),
      repoNode('node-b', 'biz-1'),
      repoNode('node-c', 'biz-2'),
    ])
    mocks.getSchedule.mockImplementation((businessId: string) =>
      Promise.resolve(businessId === 'biz-1' ? schedule('biz-1') : null),
    )
    mocks.getRewardById.mockResolvedValue({ rewardId: 'reward-1', title: 'Free welcome drink', isActive: true })

    const nodes = await getNodesByCitySlug(CITY_SLUG)

    // Business-wide scope: both venues of biz-1 carry the same Tonight.
    expect(nodes[0]).toMatchObject({
      id: 'node-a',
      tonight: { headline: 'Amapiano all night', startsAt: null, rewardTitle: 'Free welcome drink' },
    })
    expect(nodes[1]!.tonight).toEqual(nodes[0]!.tonight)
    // A business with nothing published says nothing.
    expect(nodes[2]).toMatchObject({ id: 'node-c', tonight: null })
  })

  it('reads the schedule once per distinct business, not once per node', async () => {
    mocks.getNodesByCitySlug.mockResolvedValue([
      repoNode('node-a', 'biz-1'),
      repoNode('node-b', 'biz-1'),
      repoNode('node-c', 'biz-1'),
      repoNode('node-d', 'biz-2'),
    ])
    mocks.getSchedule.mockResolvedValue(null)

    await getNodesByCitySlug(CITY_SLUG)

    expect(mocks.getSchedule).toHaveBeenCalledTimes(2)
    expect(mocks.getSchedule.mock.calls.map((call) => call[0]).sort()).toEqual(['biz-1', 'biz-2'])
  })

  it('reads the featured get once even when several venues share it', async () => {
    mocks.getNodesByCitySlug.mockResolvedValue([repoNode('node-a', 'biz-1'), repoNode('node-b', 'biz-1')])
    mocks.getSchedule.mockResolvedValue(schedule('biz-1'))
    mocks.getRewardById.mockResolvedValue({ rewardId: 'reward-1', title: 'Free welcome drink', isActive: true })

    await getNodesByCitySlug(CITY_SLUG)

    expect(mocks.getRewardById).toHaveBeenCalledTimes(1)
  })

  it('does not blank the map when a schedule read fails', async () => {
    mocks.getNodesByCitySlug.mockResolvedValue([repoNode('node-a', 'biz-1')])
    mocks.getSchedule.mockRejectedValue(new Error('dynamo exploded'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const nodes = await getNodesByCitySlug(CITY_SLUG)

    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.tonight).toBeNull()
    // Omitted, not masked: the failure is logged loudly.
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

// ─── Node detail ─────────────────────────────────────────────────────────────

describe('getNodeDetail, Tonight on the venue detail (R8.5, R8.7)', () => {
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

  it('carries the summary resolved from the owning business schedule', async () => {
    mocks.getSchedule.mockResolvedValue(schedule('biz-1'))
    mocks.getRewardById.mockResolvedValue({ rewardId: 'reward-1', title: 'Free welcome drink', isActive: true })

    const detail = await getNodeDetail('node-a')

    expect(mocks.getSchedule).toHaveBeenCalledWith('biz-1', 'default')
    expect(detail.tonight).toMatchObject({ headline: 'Amapiano all night', rewardTitle: 'Free welcome drink' })
  })

  it('reads null when nothing is published', async () => {
    mocks.getSchedule.mockResolvedValue(null)

    expect((await getNodeDetail('node-a')).tonight).toBeNull()
  })
})

// ─── Public node view and the share snapshot ──────────────────────────────────

describe('getNodePublic, Tonight on the public venue view (R8.5, R1.2)', () => {
  beforeEach(() => {
    mocks.getNodeBySlug.mockResolvedValue({
      id: 'node-a',
      name: "Ramona's",
      category: 'nightlife',
      city: { name: 'Johannesburg', slug: CITY_SLUG },
      businessId: 'biz-1',
      headerImageKey: null,
      rewards: [{ id: 'reward-1' }],
    })
  })

  it('carries the summary, replacing the hard-coded null', async () => {
    mocks.getSchedule.mockResolvedValue(schedule('biz-1'))
    mocks.getRewardById.mockResolvedValue({ rewardId: 'reward-1', title: 'Free welcome drink', isActive: true })

    const view = await getNodePublic('ramona')

    expect(view.tonight).toMatchObject({ headline: 'Amapiano all night', startsAt: null })
  })

  it('reads null when nothing is published', async () => {
    expect((await getNodePublic('ramona')).tonight).toBeNull()
  })
})

describe('getNodeSharePreview, the snapshot carries the Tonight headline (task 9.5)', () => {
  beforeEach(() => {
    mocks.getNodeBySlug.mockResolvedValue({
      id: 'node-a',
      name: "Ramona's",
      category: 'nightlife',
      city: { name: 'Johannesburg', slug: CITY_SLUG },
      businessId: 'biz-1',
      headerImageKey: null,
      rewards: [{ id: 'reward-1' }],
    })
  })

  it('puts the headline in the og:description line', async () => {
    mocks.getSchedule.mockResolvedValue(schedule('biz-1'))
    mocks.getLivePresenceCount.mockResolvedValue(12)
    mocks.kvGet.mockResolvedValue('45')

    const preview = await getNodeSharePreview('ramona')

    // Aliveness still leads; Tonight is the anticipation clause after it.
    expect(preview.description).toContain('12 here now')
    expect(preview.description).toContain('Amapiano all night tonight')
  })

  it('shows the start time when the slot has not begun', async () => {
    mocks.getSchedule.mockResolvedValue(
      schedule('biz-1', [{ ...DATED_SLOT, startTime: '23:00', startTimeMin: 1380, endTimeMin: 1439 }]),
    )

    const preview = await getNodeSharePreview('ramona')

    expect(preview.description).toContain('Amapiano all night tonight from 23:00')
  })

  it('omits the Tonight clause entirely when nothing is published', async () => {
    const preview = await getNodeSharePreview('ramona')

    expect(preview.description).not.toContain('tonight')
  })
})
