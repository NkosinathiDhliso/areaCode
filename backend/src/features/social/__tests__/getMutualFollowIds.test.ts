import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for getMutualFollowIds
 * Validates: Requirements 5.1, 5.2, 5.3
 */

// Mock prisma before importing the module
vi.mock('../../../shared/db/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}))

// Re-export Prisma utilities (not mocked — we need the real sql tag)
vi.mock('@prisma/client', async () => {
  const actual = await vi.importActual<typeof import('@prisma/client')>('@prisma/client')
  return actual
})

import { getMutualFollowIds } from '../repository.js'
import { prisma } from '../../../shared/db/prisma.js'

const mockQueryRaw = vi.mocked(prisma.$queryRaw)

describe('getMutualFollowIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty set when candidateIds is empty', async () => {
    const result = await getMutualFollowIds('viewer-1', [])
    expect(result).toEqual(new Set())
    expect(mockQueryRaw).not.toHaveBeenCalled()
  })

  it('returns mutual follow IDs from query results', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { following_id: 'user-a' },
      { following_id: 'user-c' },
    ])

    const result = await getMutualFollowIds('viewer-1', ['user-a', 'user-b', 'user-c'])

    expect(result).toEqual(new Set(['user-a', 'user-c']))
    expect(mockQueryRaw).toHaveBeenCalledOnce()
  })

  it('returns empty set when no mutual follows exist', async () => {
    mockQueryRaw.mockResolvedValueOnce([])

    const result = await getMutualFollowIds('viewer-1', ['user-a', 'user-b'])

    expect(result).toEqual(new Set())
  })

  it('returns empty set on DB error (safe fallback)', async () => {
    mockQueryRaw.mockRejectedValueOnce(new Error('DB connection timeout'))

    const result = await getMutualFollowIds('viewer-1', ['user-a'])

    expect(result).toEqual(new Set())
  })

  it('returns a Set (not an array)', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ following_id: 'user-a' }])

    const result = await getMutualFollowIds('viewer-1', ['user-a'])

    expect(result).toBeInstanceOf(Set)
  })

  it('handles single candidate ID', async () => {
    mockQueryRaw.mockResolvedValueOnce([{ following_id: 'user-x' }])

    const result = await getMutualFollowIds('viewer-1', ['user-x'])

    expect(result).toEqual(new Set(['user-x']))
  })
})
