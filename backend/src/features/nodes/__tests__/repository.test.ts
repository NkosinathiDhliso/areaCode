/**
 * Integration tests for the nodes repository — specifically the paid-tier
 * visibility filter in `getNodesByCitySlug`.
 *
 * The map only shows venues whose owning business is on a paid tier
 * (starter, payg, growth, pro). Free-tier businesses are excluded entirely.
 * This test pins that behaviour so a future refactor cannot accidentally
 * expose free-tier venues on the consumer map.
 *
 * _Requirements: map visibility = paid subscription only_
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ───────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const sendMock = vi.fn()
  const findBusinessById = vi.fn()
  return { sendMock, findBusinessById }
})

vi.mock('../../../shared/db/dynamodb.js', () => ({
  documentClient: { send: mocks.sendMock },
  TableNames: {
    nodes: 'nodes',
    appData: 'app-data',
  },
}))

vi.mock('../../business/repository.js', () => ({
  findBusinessById: mocks.findBusinessById,
}))

// Stub out unused imports that the repository pulls in
vi.mock('../../rewards/dynamodb-repository.js', () => ({
  getActiveRewardsByNodeId: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../check-in/dynamodb-repository.js', () => ({
  getCheckInsByNode: vi.fn().mockResolvedValue({ checkIns: [] }),
}))

vi.mock('../../auth/dynamodb-repository.js', () => ({
  getUserById: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../../shared/db/entities.js', () => ({
  generateId: vi.fn(() => 'mock-id'),
}))

vi.mock('../dynamodb-repository.js', () => ({
  getNodeById: vi.fn(),
  getNodeBySlug: vi.fn(),
  createNode: vi.fn(),
  updateNode: vi.fn(),
}))

import { getNodesByCitySlug } from '../repository.js'

beforeEach(() => {
  mocks.sendMock.mockReset()
  mocks.findBusinessById.mockReset()
})

describe('getNodesByCitySlug — paid-tier filter', () => {
  const CITY_SLUG = 'johannesburg'
  const CITY_ID = 'city-jhb'

  function setupCityLookup() {
    // First call: GetCommand for city lookup
    mocks.sendMock.mockImplementation(async (cmd: unknown) => {
      const input = (cmd as { input?: Record<string, unknown> })?.input ?? {}

      // City lookup (GetCommand with pk starting with CITY#)
      if ('Key' in input) {
        const key = input['Key'] as { pk?: string }
        if (key?.pk === `CITY#${CITY_SLUG}`) {
          return { Item: { cityId: CITY_ID, name: 'Johannesburg', slug: CITY_SLUG } }
        }
      }

      // Nodes scan (ScanCommand with FilterExpression)
      if ('FilterExpression' in input) {
        return { Items: [] }
      }

      return {}
    })
  }

  it('returns zero nodes when the only business has tier = "free"', async () => {
    mocks.sendMock.mockImplementation(async (cmd: unknown) => {
      const input = (cmd as { input?: Record<string, unknown> })?.input ?? {}

      if ('Key' in input) {
        const key = input['Key'] as { pk?: string }
        if (key?.pk === `CITY#${CITY_SLUG}`) {
          return { Item: { cityId: CITY_ID, name: 'Johannesburg', slug: CITY_SLUG } }
        }
      }

      if ('FilterExpression' in input) {
        return {
          Items: [
            {
              nodeId: 'node-free-venue',
              name: 'Free Venue',
              slug: 'free-venue',
              category: 'nightlife',
              lat: -26.2,
              lng: 28.0,
              cityId: CITY_ID,
              isActive: true,
              businessId: 'biz-free',
              claimStatus: 'claimed',
            },
          ],
        }
      }

      return {}
    })

    // Business is on the free tier
    mocks.findBusinessById.mockResolvedValue({
      id: 'biz-free',
      name: 'Free Business',
      tier: 'free',
    })

    const nodes = await getNodesByCitySlug(CITY_SLUG)

    expect(nodes).toHaveLength(0)
  })

  it('returns nodes for businesses on paid tiers (starter, payg, growth, pro)', async () => {
    const paidTiers = ['starter', 'payg', 'growth', 'pro'] as const

    mocks.sendMock.mockImplementation(async (cmd: unknown) => {
      const input = (cmd as { input?: Record<string, unknown> })?.input ?? {}

      if ('Key' in input) {
        const key = input['Key'] as { pk?: string }
        if (key?.pk === `CITY#${CITY_SLUG}`) {
          return { Item: { cityId: CITY_ID, name: 'Johannesburg', slug: CITY_SLUG } }
        }
      }

      if ('FilterExpression' in input) {
        return {
          Items: paidTiers.map((tier, i) => ({
            nodeId: `node-${tier}`,
            name: `${tier} Venue`,
            slug: `${tier}-venue`,
            category: 'nightlife',
            lat: -26.2 + i * 0.01,
            lng: 28.0,
            cityId: CITY_ID,
            isActive: true,
            businessId: `biz-${tier}`,
            claimStatus: 'claimed',
          })),
        }
      }

      return {}
    })

    // Each business is on a different paid tier
    mocks.findBusinessById.mockImplementation(async (id: string) => {
      const tier = id.replace('biz-', '')
      return { id, name: `${tier} Business`, tier }
    })

    const nodes = await getNodesByCitySlug(CITY_SLUG)

    expect(nodes).toHaveLength(4)
    expect(nodes.map((n) => n.id).sort()).toEqual(paidTiers.map((t) => `node-${t}`).sort())
  })

  it('excludes free-tier nodes while including paid-tier nodes in the same city', async () => {
    mocks.sendMock.mockImplementation(async (cmd: unknown) => {
      const input = (cmd as { input?: Record<string, unknown> })?.input ?? {}

      if ('Key' in input) {
        const key = input['Key'] as { pk?: string }
        if (key?.pk === `CITY#${CITY_SLUG}`) {
          return { Item: { cityId: CITY_ID, name: 'Johannesburg', slug: CITY_SLUG } }
        }
      }

      if ('FilterExpression' in input) {
        return {
          Items: [
            {
              nodeId: 'node-paid',
              name: 'Paid Venue',
              slug: 'paid-venue',
              category: 'nightlife',
              lat: -26.2,
              lng: 28.0,
              cityId: CITY_ID,
              isActive: true,
              businessId: 'biz-paid',
              claimStatus: 'claimed',
            },
            {
              nodeId: 'node-free',
              name: 'Free Venue',
              slug: 'free-venue',
              category: 'coffee',
              lat: -26.21,
              lng: 28.01,
              cityId: CITY_ID,
              isActive: true,
              businessId: 'biz-free',
              claimStatus: 'claimed',
            },
          ],
        }
      }

      return {}
    })

    mocks.findBusinessById.mockImplementation(async (id: string) => {
      if (id === 'biz-paid') return { id, name: 'Paid Business', tier: 'growth' }
      if (id === 'biz-free') return { id, name: 'Free Business', tier: 'free' }
      return null
    })

    const nodes = await getNodesByCitySlug(CITY_SLUG)

    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.id).toBe('node-paid')
    expect(nodes[0]!.name).toBe('Paid Venue')
  })

  it('excludes nodes without a businessId (orphan/legacy nodes)', async () => {
    mocks.sendMock.mockImplementation(async (cmd: unknown) => {
      const input = (cmd as { input?: Record<string, unknown> })?.input ?? {}

      if ('Key' in input) {
        const key = input['Key'] as { pk?: string }
        if (key?.pk === `CITY#${CITY_SLUG}`) {
          return { Item: { cityId: CITY_ID, name: 'Johannesburg', slug: CITY_SLUG } }
        }
      }

      if ('FilterExpression' in input) {
        return {
          Items: [
            {
              nodeId: 'node-orphan',
              name: 'Orphan Venue',
              slug: 'orphan-venue',
              category: 'food',
              lat: -26.2,
              lng: 28.0,
              cityId: CITY_ID,
              isActive: true,
              // No businessId
              claimStatus: 'unclaimed',
            },
          ],
        }
      }

      return {}
    })

    const nodes = await getNodesByCitySlug(CITY_SLUG)

    expect(nodes).toHaveLength(0)
    // findBusinessById should never be called for orphan nodes
    expect(mocks.findBusinessById).not.toHaveBeenCalled()
  })

  it('returns empty array when city does not exist', async () => {
    mocks.sendMock.mockImplementation(async (cmd: unknown) => {
      const input = (cmd as { input?: Record<string, unknown> })?.input ?? {}

      if ('Key' in input) {
        return { Item: undefined }
      }

      return {}
    })

    const nodes = await getNodesByCitySlug('nonexistent-city')

    expect(nodes).toHaveLength(0)
  })
})
