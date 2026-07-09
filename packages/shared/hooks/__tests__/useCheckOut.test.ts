// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { ERROR_COPY } from '../../constants/error-copy'
import type { ApiError } from '../../lib/api'
import type { CheckOutResponse } from '../../types'

// Mock the shared API client. `vi.hoisted` lets the factory reference this
// mutable mock state even though the mock is hoisted above the imports.
const apiMock = vi.hoisted(() => ({
  post: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: apiMock,
}))

import { useCheckOut } from '../useCheckOut'
import { usePresenceStore } from '../../stores/presenceStore'
import { useErrorStore } from '../../stores/errorStore'

const NODE = 'node-123'

const success = (state: CheckOutResponse['presenceState']): CheckOutResponse => ({
  nodeId: NODE,
  presenceState: state,
  dwellSeconds: state === 'checked_out' ? 42 : null,
})

const apiError = (overrides: Partial<ApiError>): ApiError => ({
  error: 'error',
  message: 'server message',
  statusCode: 500,
  ...overrides,
})

beforeEach(() => {
  apiMock.post.mockReset()
  // Drive the real stores via setState and reset before each test.
  usePresenceStore.setState({ activePresence: { [NODE]: { checkedInAt: 1 } } })
  useErrorStore.setState({ error: null })
})

describe('useCheckOut', () => {
  it('clears local presence on a successful check_out', async () => {
    apiMock.post.mockResolvedValue(success('checked_out'))
    const { result } = renderHook(() => useCheckOut())

    let res: CheckOutResponse | null = null
    await act(async () => {
      res = await result.current.checkOut(NODE)
    })

    expect(apiMock.post).toHaveBeenCalledWith('/v1/check-out', { nodeId: NODE })
    expect(res).toEqual(success('checked_out'))
    expect(usePresenceStore.getState().isPresent(NODE)).toBe(false)
    expect(result.current.error).toBeNull()
    expect(useErrorStore.getState().error).toBeNull()
  })

  it('treats no_active_presence as success: clears presence and shows no error', async () => {
    apiMock.post.mockResolvedValue(success('no_active_presence'))
    const { result } = renderHook(() => useCheckOut())

    let res: CheckOutResponse | null = null
    await act(async () => {
      res = await result.current.checkOut(NODE)
    })

    expect(res).toEqual(success('no_active_presence'))
    expect(usePresenceStore.getState().isPresent(NODE)).toBe(false)
    expect(result.current.error).toBeNull()
    expect(useErrorStore.getState().error).toBeNull()
  })

  describe('status-code keyed error messages', () => {
    const cases: Array<{ name: string; err: ApiError; expected: string }> = [
      {
        name: '429 rate limit',
        err: apiError({ statusCode: 429, message: undefined as unknown as string }),
        expected: 'Easy there - too many requests. Try again in a moment.',
      },
      {
        name: '401 unauthenticated',
        err: apiError({ statusCode: 401 }),
        expected: 'Please sign in to check out.',
      },
      {
        name: '403 forbidden',
        err: apiError({ statusCode: 403 }),
        expected: 'Check-out is disabled for this account.',
      },
      {
        name: '5xx server error',
        err: apiError({ statusCode: 500, message: ERROR_COPY.serverError }),
        expected: ERROR_COPY.serverError,
      },
    ]

    for (const { name, err, expected } of cases) {
      it(`maps ${name} to its specific message and surfaces it via useErrorStore`, async () => {
        apiMock.post.mockRejectedValue(err)
        const { result } = renderHook(() => useCheckOut())

        let res: CheckOutResponse | null = success('checked_out')
        await act(async () => {
          res = await result.current.checkOut(NODE)
        })

        // A failure never reports a successful check-out.
        expect(res).toBeNull()
        expect(result.current.error).toBe(expected)
        expect(useErrorStore.getState().error).toBe(expected)
        // Local presence is untouched on failure (only success clears it).
        expect(usePresenceStore.getState().isPresent(NODE)).toBe(true)
      })
    }

    it('shows remaining cooldown time on a 429 with cooldownUntil', async () => {
      const cooldownUntil = new Date(Date.now() + 5 * 60_000).toISOString()
      apiMock.post.mockRejectedValue(apiError({ statusCode: 429, cooldownUntil } as Partial<ApiError>))
      const { result } = renderHook(() => useCheckOut())

      await act(async () => {
        await result.current.checkOut(NODE)
      })

      expect(result.current.error).toBe('Too many requests. Try again in 5m.')
      expect(useErrorStore.getState().error).toBe('Too many requests. Try again in 5m.')
    })
  })

  it('in-flight guard prevents a second concurrent request', async () => {
    // First call hangs until we resolve it manually, simulating a request that
    // is still in flight when a second click fires.
    let resolveFirst: (value: CheckOutResponse) => void = () => {}
    const firstCall = new Promise<CheckOutResponse>((resolve) => {
      resolveFirst = resolve
    })
    apiMock.post.mockReturnValueOnce(firstCall)

    const { result } = renderHook(() => useCheckOut())

    let firstResult: Promise<CheckOutResponse | null> = Promise.resolve(null)
    let secondResult: CheckOutResponse | null = success('checked_out')
    await act(async () => {
      firstResult = result.current.checkOut(NODE)
      // Second call while the first is still pending - must be rejected by the guard.
      secondResult = await result.current.checkOut(NODE)
    })

    // The guard returns null immediately for the second call and never hits the API.
    expect(secondResult).toBeNull()
    expect(apiMock.post).toHaveBeenCalledTimes(1)

    // Resolve the first call and confirm it completes normally.
    await act(async () => {
      resolveFirst(success('checked_out'))
      await firstResult
    })
    expect(apiMock.post).toHaveBeenCalledTimes(1)
    expect(usePresenceStore.getState().isPresent(NODE)).toBe(false)
  })
})
