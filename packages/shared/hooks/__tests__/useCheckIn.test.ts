// @vitest-environment jsdom
/**
 * `useCheckIn` 429 handling: the limiter's own copy reaches the consumer (R15.9).
 *
 * **Validates: Requirements 15.9**
 *
 * There are two different 429s on this route and they mean different things:
 *
 *   - the per-venue check-in cooldown, which carries `cooldownUntil` and is
 *     rendered as "you can check in here again in N"
 *   - the burst rate limit on the route, which carries the limiter's own sentence
 *
 * The hook must render the server's sentence for the second case rather than
 * overwriting it with a generic one, so the copy lives in exactly one place (the
 * limiter config) and a throttled attempt never reads as a broken screen.
 */

import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import type { ApiError } from '../../lib/api'
import { useErrorStore } from '../../stores/errorStore'
import type { CheckInRequest } from '../../types'

const apiMock = vi.hoisted(() => ({ post: vi.fn() }))

vi.mock('../../lib/api', () => ({ api: apiMock }))

import { useCheckIn } from '../useCheckIn'

const payload = { nodeId: 'node-1', type: 'presence' } as unknown as CheckInRequest

const apiError = (overrides: Partial<ApiError>): ApiError => ({
  error: 'too_many_requests',
  message: 'server message',
  statusCode: 429,
  ...overrides,
})

async function attempt(err: ApiError) {
  apiMock.post.mockRejectedValue(err)
  const { result } = renderHook(() => useCheckIn())
  await act(async () => {
    await result.current.checkIn(payload)
  })
  return result
}

beforeEach(() => {
  apiMock.post.mockReset()
  useErrorStore.setState({ error: null })
})

describe('useCheckIn 429 copy by limiter (R15.9)', () => {
  it('renders the route limiter sentence the server sent', async () => {
    const result = await attempt(apiError({ message: 'Too many check-in attempts, wait 42 seconds.' }))

    expect(result.current.error).toBe('Too many check-in attempts, wait 42 seconds.')
    expect(useErrorStore.getState().error).toBe('Too many check-in attempts, wait 42 seconds.')
  })

  it('renders the venue cooldown in minutes when cooldownUntil is present', async () => {
    const cooldownUntil = new Date(Date.now() + 5 * 60_000).toISOString()
    const result = await attempt(apiError({ cooldownUntil } as Partial<ApiError>))

    expect(result.current.error).toBe('You can check in here again in 5m.')
  })

  it('falls back to one plain sentence when the server sent no copy', async () => {
    const result = await attempt(apiError({ message: undefined as unknown as string }))

    expect(result.current.error).toBe('Easy there - too many check-ins. Try again in a moment.')
  })

  it('never renders technical text from the error object', async () => {
    const result = await attempt(apiError({ message: 'Too many check-in attempts, wait 5 seconds.' }))

    expect(result.current.error).not.toContain('429')
    expect(result.current.error).not.toContain('ratelimit:')
  })
})
