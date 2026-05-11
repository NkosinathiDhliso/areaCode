import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the KV module before importing the module under test
vi.mock('../../../shared/kv/dynamodb-kv.js', () => ({
  kvGet: vi.fn(),
  kvSet: vi.fn(),
  kvIncr: vi.fn(),
}))

import {
  checkRateLimit,
  checkDailyCap,
  checkOwnerRateLimit,
  checkDisputeLimit,
  recordSignalSubmission,
  recordOwnerSignalSubmission,
  recordDisputeSubmission,
} from '../rate-limits.js'
import { kvGet, kvSet, kvIncr } from '../../../shared/kv/dynamodb-kv.js'

const mockKvGet = vi.mocked(kvGet)
const mockKvSet = vi.mocked(kvSet)
const mockKvIncr = vi.mocked(kvIncr)

beforeEach(() => {
  vi.clearAllMocks()
})

// ============================================================================
// checkRateLimit
// ============================================================================

describe('checkRateLimit', () => {
  it('allows submission when no rate limit or correction window exists', async () => {
    mockKvGet.mockResolvedValue(null)

    const result = await checkRateLimit('user-1', 'node-1', 'genre_playing')

    expect(result.allowed).toBe(true)
    expect(result.isCorrection).toBe(false)
    expect(result.correctionSortKey).toBeUndefined()
  })

  it('allows correction when correction window exists', async () => {
    // First call checks correction window, second checks rate limit
    mockKvGet.mockImplementation(async (key: string) => {
      if (key.includes('signal-correction:')) return '2025-01-15T22:30:00.000Z#user-1'
      return null
    })

    const result = await checkRateLimit('user-1', 'node-1', 'genre_playing')

    expect(result.allowed).toBe(true)
    expect(result.isCorrection).toBe(true)
    expect(result.correctionSortKey).toBe('2025-01-15T22:30:00.000Z#user-1')
  })

  it('blocks submission when rate limit exists and no correction window', async () => {
    mockKvGet.mockImplementation(async (key: string) => {
      if (key.includes('signal-correction:')) return null
      if (key.includes('signal-rate:')) return '1'
      return null
    })

    const result = await checkRateLimit('user-1', 'node-1', 'genre_playing')

    expect(result.allowed).toBe(false)
    expect(result.isCorrection).toBe(false)
  })

  it('uses correct key format for rate limit check', async () => {
    mockKvGet.mockResolvedValue(null)

    await checkRateLimit('user-123', 'node-456', 'queue_length')

    expect(mockKvGet).toHaveBeenCalledWith('signal-correction:user-123:node-456:queue_length')
    expect(mockKvGet).toHaveBeenCalledWith('signal-rate:user-123:node-456:queue_length')
  })

  it('prioritizes correction window over rate limit', async () => {
    // Both correction window and rate limit exist
    mockKvGet.mockImplementation(async (key: string) => {
      if (key.includes('signal-correction:')) return 'sort-key-123'
      if (key.includes('signal-rate:')) return '1'
      return null
    })

    const result = await checkRateLimit('user-1', 'node-1', 'genre_playing')

    // Correction window takes priority — allowed as correction
    expect(result.allowed).toBe(true)
    expect(result.isCorrection).toBe(true)
    expect(result.correctionSortKey).toBe('sort-key-123')
  })
})

// ============================================================================
// checkDailyCap
// ============================================================================

describe('checkDailyCap', () => {
  it('allows submission when no daily count exists', async () => {
    mockKvGet.mockResolvedValue(null)

    const result = await checkDailyCap('user-1')

    expect(result.allowed).toBe(true)
    expect(result.count).toBe(0)
  })

  it('allows submission when count is below 50', async () => {
    mockKvGet.mockResolvedValue('49')

    const result = await checkDailyCap('user-1')

    expect(result.allowed).toBe(true)
    expect(result.count).toBe(49)
  })

  it('blocks submission when count is at 50', async () => {
    mockKvGet.mockResolvedValue('50')

    const result = await checkDailyCap('user-1')

    expect(result.allowed).toBe(false)
    expect(result.count).toBe(50)
  })

  it('blocks submission when count exceeds 50', async () => {
    mockKvGet.mockResolvedValue('55')

    const result = await checkDailyCap('user-1')

    expect(result.allowed).toBe(false)
    expect(result.count).toBe(55)
  })

  it('uses correct key format with today date', async () => {
    mockKvGet.mockResolvedValue(null)
    const today = new Date().toISOString().slice(0, 10)

    await checkDailyCap('user-abc')

    expect(mockKvGet).toHaveBeenCalledWith(`signal-daily:user-abc:${today}`)
  })
})

// ============================================================================
// checkOwnerRateLimit
// ============================================================================

describe('checkOwnerRateLimit', () => {
  it('allows submission when no owner rate limit exists', async () => {
    mockKvGet.mockResolvedValue(null)

    const result = await checkOwnerRateLimit('user-1', 'node-1', 'genre_playing')

    expect(result.allowed).toBe(true)
  })

  it('blocks submission when owner rate limit exists', async () => {
    mockKvGet.mockResolvedValue('1')

    const result = await checkOwnerRateLimit('user-1', 'node-1', 'genre_playing')

    expect(result.allowed).toBe(false)
  })

  it('uses correct key format', async () => {
    mockKvGet.mockResolvedValue(null)

    await checkOwnerRateLimit('owner-1', 'node-99', 'queue_length')

    expect(mockKvGet).toHaveBeenCalledWith('signal-owner-rate:owner-1:node-99:queue_length')
  })
})

// ============================================================================
// checkDisputeLimit
// ============================================================================

describe('checkDisputeLimit', () => {
  it('allows dispute when no daily count exists', async () => {
    mockKvGet.mockResolvedValue(null)

    const result = await checkDisputeLimit('biz-1')

    expect(result.allowed).toBe(true)
  })

  it('allows dispute when count is below 5', async () => {
    mockKvGet.mockResolvedValue('4')

    const result = await checkDisputeLimit('biz-1')

    expect(result.allowed).toBe(true)
  })

  it('blocks dispute when count is at 5', async () => {
    mockKvGet.mockResolvedValue('5')

    const result = await checkDisputeLimit('biz-1')

    expect(result.allowed).toBe(false)
  })

  it('uses correct key format with today date', async () => {
    mockKvGet.mockResolvedValue(null)
    const today = new Date().toISOString().slice(0, 10)

    await checkDisputeLimit('biz-abc')

    expect(mockKvGet).toHaveBeenCalledWith(`signal-dispute-daily:biz-abc:${today}`)
  })
})

// ============================================================================
// recordSignalSubmission
// ============================================================================

describe('recordSignalSubmission', () => {
  it('sets rate limit, correction window, and increments daily cap', async () => {
    mockKvSet.mockResolvedValue(undefined)
    mockKvIncr.mockResolvedValue(1)

    await recordSignalSubmission('user-1', 'node-1', 'genre_playing', '2025-01-15T22:30:00.000Z#user-1')

    // Rate limit: 5-minute TTL (300s)
    expect(mockKvSet).toHaveBeenCalledWith(
      'signal-rate:user-1:node-1:genre_playing',
      '1',
      300
    )

    // Correction window: 2-minute TTL (120s) with signal sort key
    expect(mockKvSet).toHaveBeenCalledWith(
      'signal-correction:user-1:node-1:genre_playing',
      '2025-01-15T22:30:00.000Z#user-1',
      120
    )

    // Daily cap increment
    const today = new Date().toISOString().slice(0, 10)
    expect(mockKvIncr).toHaveBeenCalledWith(
      `signal-daily:user-1:${today}`,
      90000 // 86400 + 3600
    )
  })

  it('executes all three operations in parallel', async () => {
    const callOrder: string[] = []
    mockKvSet.mockImplementation(async (key: string) => {
      callOrder.push(`set:${key.split(':')[0]}`)
    })
    mockKvIncr.mockImplementation(async (key: string) => {
      callOrder.push(`incr:${key.split(':')[0]}`)
      return 1
    })

    await recordSignalSubmission('user-1', 'node-1', 'genre_playing', 'sort-key')

    // All three should have been called
    expect(mockKvSet).toHaveBeenCalledTimes(2)
    expect(mockKvIncr).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// recordOwnerSignalSubmission
// ============================================================================

describe('recordOwnerSignalSubmission', () => {
  it('sets 30-minute rate limit for owner', async () => {
    mockKvSet.mockResolvedValue(undefined)

    await recordOwnerSignalSubmission('owner-1', 'node-1', 'genre_playing')

    expect(mockKvSet).toHaveBeenCalledWith(
      'signal-owner-rate:owner-1:node-1:genre_playing',
      '1',
      1800
    )
  })
})

// ============================================================================
// recordDisputeSubmission
// ============================================================================

describe('recordDisputeSubmission', () => {
  it('increments daily dispute counter', async () => {
    mockKvIncr.mockResolvedValue(1)

    await recordDisputeSubmission('biz-1')

    const today = new Date().toISOString().slice(0, 10)
    expect(mockKvIncr).toHaveBeenCalledWith(
      `signal-dispute-daily:biz-1:${today}`,
      90000 // 86400 + 3600
    )
  })
})
