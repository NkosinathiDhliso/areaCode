// @vitest-environment jsdom
/**
 * Component/hook tests for the checkout-return state machine (billing-revenue-integrity
 * R6). Drives `useCheckoutReturn` and renders `CheckoutReturnBanner` through a
 * small harness so the polled state and per-state copy are asserted together.
 *
 * `api.get` is mocked via `vi.hoisted` so the factory can reference mutable mock
 * state, and fake timers drive the 2s poll cadence (per tech.md).
 *
 * **Validates: Requirements 6.1, 6.2, 6.3**
 */
import { render, act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CheckoutReturnBanner } from '../CheckoutReturnBanner'
import type { ReturnProfile } from '../checkoutReturnState'
import { useCheckoutReturn } from '../useCheckoutReturn'

// api.get mock, hoisted so the vi.mock factory below can close over it.
const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }))

vi.mock('@area-code/shared/lib/api', () => ({
  api: { get: mocks.apiGet },
}))

// Fixed clock so paidUntil comparisons are deterministic under fake timers.
const NOW = new Date('2026-07-09T00:00:00.000Z')
const PAID_UNTIL = new Date('2026-08-09T00:00:00.000Z').toISOString()

const PAID_PROFILE: ReturnProfile = { tier: 'growth', paidUntil: PAID_UNTIL }
const UNPAID_PROFILE: ReturnProfile = { tier: 'starter', paidUntil: null }

// Renders the banner driven by the real hook, matching how the panels wire it.
function Harness({ onProfile = () => {} }: { onProfile?: (p: ReturnProfile) => void }) {
  const { returnState, dismiss } = useCheckoutReturn<ReturnProfile>({ onProfile })
  return <CheckoutReturnBanner state={returnState} onDismiss={dismiss} />
}

// Sets window.location.search in a jsdom-friendly way (replaceState updates it).
function setReturnUrl(search: string) {
  window.history.replaceState({}, '', `/plans${search}`)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  mocks.apiGet.mockReset()
})

afterEach(() => {
  cleanup()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

describe('useCheckoutReturn - success poll (R6.1)', () => {
  it('renders the activating message while the poll is in flight', async () => {
    setReturnUrl('?status=success')
    // Never lands, so the state stays activating within the window.
    mocks.apiGet.mockResolvedValue(UNPAID_PROFILE)

    const { container } = render(<Harness />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(container.textContent).toContain('Confirming your payment')
  })

  it('renders confirmed once a poll sees the paid state land', async () => {
    setReturnUrl('?status=success')
    // First poll (immediate) not landed; second poll (after 2s) lands.
    mocks.apiGet.mockResolvedValueOnce(UNPAID_PROFILE).mockResolvedValue(PAID_PROFILE)

    const onProfile = vi.fn()
    const { container } = render(<Harness onProfile={onProfile} />)

    // Immediate poll resolves: still activating.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(container.textContent).toContain('Confirming your payment')

    // Advance one poll interval: paid state lands, banner confirms.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(container.textContent).toContain('Payment confirmed')
    expect(container.textContent).toContain('Your plan is now active')
    expect(onProfile).toHaveBeenCalledWith(PAID_PROFILE)
  })
})

describe('useCheckoutReturn - timeout (R6.2)', () => {
  it('renders the support message after 60s with no landing', async () => {
    setReturnUrl('?status=success')
    mocks.apiGet.mockResolvedValue(UNPAID_PROFILE)

    const { container } = render(<Harness />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(container.textContent).toContain('still processing')
    expect(container.textContent).toContain('support@areacode.co.za')
    // Never a false success.
    expect(container.textContent).not.toContain('Payment confirmed')
  })
})

describe('useCheckoutReturn - cancelled / failed (R6.3)', () => {
  it('renders the cancelled message and never polls', async () => {
    setReturnUrl('?status=cancelled')

    const { container } = render(<Harness />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(container.textContent).toContain('Checkout cancelled. No payment was taken.')
    expect(mocks.apiGet).not.toHaveBeenCalled()
  })

  it('renders the failed message and never polls', async () => {
    setReturnUrl('?status=failed')

    const { container } = render(<Harness />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(container.textContent).toContain('did not go through')
    expect(container.textContent).toContain('no charge was made')
    expect(mocks.apiGet).not.toHaveBeenCalled()
  })
})

describe('useCheckoutReturn - URL param stripping (R6.3)', () => {
  it('strips the ?status param from the URL on mount for a terminal status', async () => {
    setReturnUrl('?status=cancelled')
    expect(window.location.search).toContain('status')

    render(<Harness />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(window.location.search).not.toContain('status')
  })

  it('strips the ?status param on mount for a success return', async () => {
    setReturnUrl('?status=success')
    mocks.apiGet.mockResolvedValue(UNPAID_PROFILE)
    expect(window.location.search).toContain('status')

    render(<Harness />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(window.location.search).not.toContain('status')
  })

  it('renders nothing (idle) when there is no return status', async () => {
    setReturnUrl('')

    const { container } = render(<Harness />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(container.textContent).toBe('')
    expect(mocks.apiGet).not.toHaveBeenCalled()
  })
})
