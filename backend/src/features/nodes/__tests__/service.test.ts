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

    // Batched pulse read, not a per-node loop.
    expect(mocks.kvBatchGet).toHaveBeenCalledTimes(1)
    expect(mocks.kvBatchGet).toHaveBeenCalledWith([`pulse:${CITY_ID}:node-a`, `pulse:${CITY_ID}:node-b`])

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
