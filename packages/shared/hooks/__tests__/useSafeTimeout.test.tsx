// @vitest-environment jsdom
/**
 * Proof of Demand R15.25: timers cleared on unmount.
 *
 * `useSafeTimeout` is the one home for "schedule a timeout that cannot outlive
 * the component". `NodeDetailContent` (report and claim success banners) and
 * `StreamingSection` (Spotify success banner) both use it.
 *
 * Validates: Requirements 15.25
 */
import { act, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSafeTimeout } from '../useSafeTimeout'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** Mirrors the success-banner pattern: a handler schedules a state reset. */
function Banner({ onFire, delayMs = 1500 }: { onFire: () => void; delayMs?: number }) {
  const setSafeTimeout = useSafeTimeout()
  const [armed, setArmed] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        setArmed(true)
        setSafeTimeout(() => {
          setArmed(false)
          onFire()
        }, delayMs)
      }}
    >
      {armed ? 'armed' : 'idle'}
    </button>
  )
}

describe('useSafeTimeout (R15.25)', () => {
  it('runs a scheduled callback while the component is mounted', () => {
    const onFire = vi.fn()
    const { container } = render(<Banner onFire={onFire} />)
    const button = container.querySelector('button')!

    act(() => {
      button.click()
    })
    act(() => {
      vi.advanceTimersByTime(1500)
    })

    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('clears a pending timer on unmount so it never fires against an unmounted component', () => {
    const onFire = vi.fn()
    const { container, unmount } = render(<Banner onFire={onFire} />)
    const button = container.querySelector('button')!

    act(() => {
      button.click()
    })
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(onFire).not.toHaveBeenCalled()
  })

  it('clears every pending timer, not only the most recent', () => {
    const onFire = vi.fn()
    const { container, unmount } = render(<Banner onFire={onFire} delayMs={2000} />)
    const button = container.querySelector('button')!

    act(() => {
      button.click()
      button.click()
      button.click()
    })
    expect(vi.getTimerCount()).toBe(3)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(onFire).not.toHaveBeenCalled()
  })
})
