import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the Who-Is-Here endpoint service logic.
 * Validates: Requirements 2.1, 2.2, 3.1, 3.2, 3.3
 */

// Mock the repository module
vi.mock('../../shared/db/prisma.js', () => ({
  prisma: {},
  isDbAvailable: false,
}))

vi.mock('../../shared/redis/client.js', () => ({
  redis: { zrevrange: vi.fn(), zrevrank: vi.fn(), zscore: vi.fn() },
}))

import { getWhoIsHere } from '../service.js'

describe('getWhoIsHere', () => {
  it('returns totalCount and tierDistribution for anonymous viewers (DEV_MODE)', async () => {
    const result = await getWhoIsHere('00000000-0000-0000-0000-000000000001')

    expect(result).toHaveProperty('totalCount')
    expect(result).toHaveProperty('tierDistribution')
    expect(result).toHaveProperty('friends')
    expect(typeof result.totalCount).toBe('number')
    expect(result.totalCount).toBeGreaterThanOrEqual(0)
    expect(typeof result.tierDistribution).toBe('object')
  })

  it('returns empty friends array for anonymous viewers (DEV_MODE)', async () => {
    const result = await getWhoIsHere('00000000-0000-0000-0000-000000000001')

    expect(Array.isArray(result.friends)).toBe(true)
    expect(result.friends).toHaveLength(0)
  })

  it('response shape matches WhoIsHereResponse interface (DEV_MODE)', async () => {
    const result = await getWhoIsHere('00000000-0000-0000-0000-000000000001')

    // totalCount is a number
    expect(typeof result.totalCount).toBe('number')

    // tierDistribution is a Record<string, number>
    for (const [key, value] of Object.entries(result.tierDistribution)) {
      expect(typeof key).toBe('string')
      expect(typeof value).toBe('number')
    }

    // friends is an array
    expect(Array.isArray(result.friends)).toBe(true)
  })

  it('tierDistribution values sum to totalCount (DEV_MODE)', async () => {
    const result = await getWhoIsHere('00000000-0000-0000-0000-000000000001')

    const tierSum = Object.values(result.tierDistribution).reduce((sum, count) => sum + count, 0)
    expect(tierSum).toBe(result.totalCount)
  })
})
