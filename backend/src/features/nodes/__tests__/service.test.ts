/**
 * Unit tests for the nodes service City_Nodes_Read cache (audit-gap-closure R2.3, R2.6).
 *
 * `service.getNodesByCitySlug` fronts the assembled city payload with the KV
 * store so concurrent map loads share one assembly:
 *  - a warm cache (kvGet hit) is served verbatim without reassembling
 *  - a cold cache (kvGet miss) assembles from the repository + batched pulse
 *    read, then kvSet's the payload with the 45s TTL
 *  - a corrupt cache entry is treated as a miss (reassembled), never served
 *  - the returned node shape is unchanged (id, name, slug, category, lat, lng,
 *    pulseScore, and the rest of the read model) so clients and vibeRank are
 *    unaffected
 *
 * DEV_MODE is forced off so the live (non-fixture) path is exercised.
 *
 * _Requirements: 2.3, 2.6_
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  kvBatchGet: vi.fn(),
  getNodesByCitySlug: vi.fn(),
  getCityBySlug: vi.fn(),
}))

vi.mock('../../../shared/config/env.js', () => ({
  DEV_MODE: false,
  APP_ENV: 'test',
  AWS_REGION: 'af-south-1',
  requireEnv: (_name: string, devDefault?: string) => devDefault ?? 'test-value',
}))

vi.mock('../../../shared/kv/dynamodb-kv.js', () => ({
  kvGet: mocks.kvGet,
  kvSet: mocks.kvSet,
  kvBatchGet: mocks.kvBatchGet,
}))

vi.mock('../repository.js', () => ({
  getNodesByCitySlug: mocks.getNodesByCitySlug,
  getCityBySlug: mocks.getCityBySlug,
}))

import { getNodesByCitySlug } from '../service.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CITY_SLUG = 'johannesburg'
const CITY_ID = 'city-jhb'
const CACHE_KEY = `nodes:city:${CITY_SLUG}`
const EXPECTED_TTL = 45

/** A node exactly as the repository read model emits it (audit-gap-closure R2.6). */
function repoNode(id: string) {
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
    businessTier: 'growth',
    boostUntil: null,
    boostActive: false,
  }
}

beforeEach(() => {
  mocks.kvGet.mockReset()
  mocks.kvSet.mockReset()
  mocks.kvBatchGet.mockReset()
  mocks.getNodesByCitySlug.mockReset()
  mocks.getCityBySlug.mockReset()
})

describe('service.getNodesByCitySlug — assembled payload cache (R2.3)', () => {
  it('serves the cached payload on a kvGet hit without reassembling', async () => {
    const cachedPayload = [{ ...repoNode('node-cached'), pulseScore: 88 }]
    mocks.kvGet.mockResolvedValue(JSON.stringify(cachedPayload))

    const result = await getNodesByCitySlug(CITY_SLUG)

    expect(result).toEqual(cachedPayload)
    // Cache hit short-circuits: no reassembly, no rewrite.
    expect(mocks.getNodesByCitySlug).not.toHaveBeenCalled()
    expect(mocks.kvBatchGet).not.toHaveBeenCalled()
    expect(mocks.kvSet).not.toHaveBeenCalled()
    expect(mocks.kvGet).toHaveBeenCalledWith(CACHE_KEY)
  })

  it('assembles then caches with a 45s TTL on a kvGet miss', async () => {
    mocks.kvGet.mockResolvedValue(null)
    mocks.getNodesByCitySlug.mockResolvedValue([repoNode('node-a'), repoNode('node-b')])
    mocks.getCityBySlug.mockResolvedValue({ id: CITY_ID, slug: CITY_SLUG, name: 'Johannesburg' })
    mocks.kvBatchGet.mockResolvedValue(
      new Map([
        [`pulse:${CITY_ID}:node-a`, '42'],
        [`pulse:${CITY_ID}:node-b`, '7'],
      ]),
    )

    const result = await getNodesByCitySlug(CITY_SLUG)

    // Assembled from source with pulse seeded from the batched KV read.
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 'node-a', pulseScore: 42 })
    expect(result[1]).toMatchObject({ id: 'node-b', pulseScore: 7 })

    // One batched read carrying both key sets, not a per-node loop and not a
    // second round trip for presence (proof-of-demand R15.6).
    expect(mocks.kvBatchGet).toHaveBeenCalledTimes(1)
    expect(mocks.kvBatchGet).toHaveBeenCalledWith([
      `pulse:${CITY_ID}:node-a`,
      `presence:count:node-a`,
      `pulse:${CITY_ID}:node-b`,
      `presence:count:node-b`,
    ])

    // Payload written back to KV with the 45s TTL under the per-city key.
    expect(mocks.kvSet).toHaveBeenCalledTimes(1)
    const [key, serialized, ttl] = mocks.kvSet.mock.calls[0]!
    expect(key).toBe(CACHE_KEY)
    expect(ttl).toBe(EXPECTED_TTL)
    expect(JSON.parse(serialized as string)).toEqual(result)
  })

  it('treats a corrupt cache entry as a miss and reassembles', async () => {
    mocks.kvGet.mockResolvedValue('{ this is not valid json')
    mocks.getNodesByCitySlug.mockResolvedValue([repoNode('node-a')])
    mocks.getCityBySlug.mockResolvedValue({ id: CITY_ID, slug: CITY_SLUG, name: 'Johannesburg' })
    mocks.kvBatchGet.mockResolvedValue(new Map([[`pulse:${CITY_ID}:node-a`, '15']]))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await getNodesByCitySlug(CITY_SLUG)

    // Corrupt entry is never served; source is reassembled and re-cached.
    expect(mocks.getNodesByCitySlug).toHaveBeenCalledTimes(1)
    expect(result[0]).toMatchObject({ id: 'node-a', pulseScore: 15 })
    expect(mocks.kvSet).toHaveBeenCalledWith(CACHE_KEY, expect.any(String), EXPECTED_TTL)
    // Corruption is surfaced, not silently masked.
    expect(errSpy).toHaveBeenCalled()

    errSpy.mockRestore()
  })
})

describe('service.getNodesByCitySlug — unchanged response shape (R2.6)', () => {
  it('returns node objects carrying the same fields plus the seeded pulseScore', async () => {
    mocks.kvGet.mockResolvedValue(null)
    mocks.getNodesByCitySlug.mockResolvedValue([repoNode('node-shape')])
    mocks.getCityBySlug.mockResolvedValue({ id: CITY_ID, slug: CITY_SLUG, name: 'Johannesburg' })
    mocks.kvBatchGet.mockResolvedValue(new Map([[`pulse:${CITY_ID}:node-shape`, '55']]))

    const result = await getNodesByCitySlug(CITY_SLUG)

    expect(result).toHaveLength(1)
    const node = result[0]!
    // All repository read-model fields preserved verbatim.
    expect(node).toMatchObject({
      id: 'node-shape',
      name: 'node-shape name',
      slug: 'node-shape-slug',
      category: 'nightlife',
      lat: -26.2041,
      lng: 28.0473,
      claimStatus: 'claimed',
      nodeColour: '#888',
      nodeIcon: null,
      isVerified: true,
      headerImageKey: null,
      businessTier: 'growth',
      boostUntil: null,
      boostActive: false,
    })
    // Plus the pulse seed the service layer adds.
    expect(node).toHaveProperty('pulseScore', 55)
  })

  it('seeds pulseScore 0 when the batched pulse read has no entry for a node', async () => {
    mocks.kvGet.mockResolvedValue(null)
    mocks.getNodesByCitySlug.mockResolvedValue([repoNode('node-nopulse')])
    mocks.getCityBySlug.mockResolvedValue({ id: CITY_ID, slug: CITY_SLUG, name: 'Johannesburg' })
    mocks.kvBatchGet.mockResolvedValue(new Map())

    const result = await getNodesByCitySlug(CITY_SLUG)

    expect(result[0]).toHaveProperty('pulseScore', 0)
  })
})

// ─── First-paint live counts (proof-of-demand R15.6) ────────────────────────
//
// The map's first paint used to show "Be the first in" on a busy venue until the
// first socket event arrived, because the REST payload carried no live count.
// The assembly now seeds it from the presence counters, read in the SAME batched
// KV call as pulse so the hot path stays at one round trip.

describe('service.getNodesByCitySlug — presence seed on first paint (R15.6)', () => {
  beforeEach(() => {
    mocks.kvGet.mockResolvedValue(null)
    mocks.getCityBySlug.mockResolvedValue({ id: CITY_ID, slug: CITY_SLUG, name: 'Johannesburg' })
  })

  it('seeds liveCheckInCount from the presence counter in the same batched read', async () => {
    mocks.getNodesByCitySlug.mockResolvedValue([repoNode('node-busy'), repoNode('node-empty')])
    mocks.kvBatchGet.mockResolvedValue(
      new Map<string, string>([
        [`pulse:${CITY_ID}:node-busy`, '60'],
        // Counters are stored as DynamoDB numbers, so the value arrives numeric.
        ['presence:count:node-busy', 12 as unknown as string],
      ]),
    )

    const result = await getNodesByCitySlug(CITY_SLUG)

    expect(result[0]).toMatchObject({ id: 'node-busy', pulseScore: 60, liveCheckInCount: 12 })
    // Absent counter means nobody is there, honestly zero.
    expect(result[1]).toMatchObject({ id: 'node-empty', pulseScore: 0, liveCheckInCount: 0 })
  })

  it('reads presence once for the whole city, not once per venue', async () => {
    const nodes = Array.from({ length: 25 }, (_, i) => repoNode(`node-${i}`))
    mocks.getNodesByCitySlug.mockResolvedValue(nodes)
    mocks.kvBatchGet.mockResolvedValue(new Map())

    await getNodesByCitySlug(CITY_SLUG)

    expect(mocks.kvBatchGet).toHaveBeenCalledTimes(1)
    const [keys] = mocks.kvBatchGet.mock.calls[0]! as [string[]]
    expect(keys.filter((key) => key.startsWith('presence:count:'))).toHaveLength(25)
  })

  it('never derives a live count from the pulse score', async () => {
    // A high pulse with nobody present must read as zero live, never as a crowd
    // inferred from the score (`honest-presence.md`).
    mocks.getNodesByCitySlug.mockResolvedValue([repoNode('node-loud')])
    mocks.kvBatchGet.mockResolvedValue(new Map([[`pulse:${CITY_ID}:node-loud`, '90']]))

    const result = await getNodesByCitySlug(CITY_SLUG)

    expect(result[0]).toMatchObject({ pulseScore: 90, liveCheckInCount: 0 })
  })
})

// ─── Loud logging on assembly failure (proof-of-demand R15.7) ───────────────

describe('service.getNodesByCitySlug — assembly failures are loud (R15.7)', () => {
  it('logs at error level with the city slug when the aliveness read fails', async () => {
    mocks.kvGet.mockResolvedValue(null)
    mocks.getNodesByCitySlug.mockResolvedValue([repoNode('node-a')])
    mocks.getCityBySlug.mockResolvedValue({ id: CITY_ID, slug: CITY_SLUG, name: 'Johannesburg' })
    mocks.kvBatchGet.mockRejectedValue(new Error('BatchGetItem throttled'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await getNodesByCitySlug(CITY_SLUG)

    // The map still renders the venues; the failure is visible, not swallowed.
    expect(result).toHaveLength(1)
    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(String(errSpy.mock.calls[0]![0])).toContain(CITY_SLUG)

    errSpy.mockRestore()
  })

  it('logs at error level when the city row is missing', async () => {
    mocks.kvGet.mockResolvedValue(null)
    mocks.getNodesByCitySlug.mockResolvedValue([repoNode('node-a')])
    mocks.getCityBySlug.mockResolvedValue(null)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await getNodesByCitySlug(CITY_SLUG)

    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(String(errSpy.mock.calls[0]![0])).toContain(CITY_SLUG)

    errSpy.mockRestore()
  })
})
