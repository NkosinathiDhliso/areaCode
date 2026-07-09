// @vitest-environment jsdom
/**
 * Component/hook tests for the boost checkout-return flow (billing-revenue-integrity
 * R6, boost path, task 10.1). Drives `useBoostCheckoutReturn` and renders
 * `CheckoutReturnBanner` through a small harness so the polled state and
 * per-state copy are asserted together.
 *
 * The boost path has no absolute paid tier to poll for: activation confirms
 * when a NEW boost purchase row appears in the boost purchases list. The first
 * poll captures a baseline (count + newest row); a later growth confirms.
 *
 * `api.get` is mocked via `vi.hoisted` and fake timers drive the 2s poll
 * cadence (per tech.md).
 *
 * **Validates: Requirements 6.1, 6.2, 6.3**
 */
import { render, act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CheckoutReturnBanner } from '../CheckoutReturnBanner'
import { useBoostCheckoutReturn } from '../useCheckoutReturn'

// api.get mock, hoisted so the vi.mock factory below can close over it.
const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }))

vi.mock('@area-code/shared/lib/api', () => ({
  api: { get: mocks.apiGet },
}))

const BUSINESS_ID = 'biz-123'

function row(paidAt: string, yocoCheckoutId: string) {
  return { paidAt, yocoCheckoutId }
}

// A boost purchases list with the given rows and no next page.
function purchases(...rows: Array<{ paidAt: string; yocoCheckoutId: string }>) {
  return { items: rows, nextCursor: null }
}

const BASELINE = purchases(row('2026-07-08T10:00:00.000Z', 'chk-old'))
const GREW = purchases(row('2026-07-09T00:00:05.000Z', 'chk-new'), row('2026-07-08T10:00:00.000Z', 'chk-old'))

// Renders the banner driven by the real hook, matching how BoostPanel wires it.
function Harness() {
  const { returnState, dismiss } = useBoostCheckoutReturn(BUSINESS_ID)
  return <CheckoutReturnBanner state={returnState} onDismiss={dismiss} />
}

function setReturnUrl(search: string) {
  window.history.replaceState({}, '', `/boost${search}`)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-09T00:00:00.000Z'))
  mocks.apiGet.mockReset()
})

afterEach(() => {
  cleanup()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

describe('useBoostCheckoutReturn - success poll (R6.1)', () => {
  it('stays activating while the boost list has not grown', async () => {
    setReturnUrl('?status=success')
    mocks.apiGet.mockResolvedValue(BASELINE)

    const { container } = render(<Harness />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(container.textContent).toContain('Confirming your payment')
    expect(mocks.apiGet).toHaveBeenCalledWith(`/v1/business/${BUSINESS_ID}/boost-purchases`)
  })

  it('confirms once a new boost row appears', async () => {
    setReturnUrl('?status=success')
    // First poll: baseline captured (not landed). Second poll: list grew.
    mocks.apiGet.mockResolvedValueOnce(BASELINE).mockResolvedValue(GREW)

    const { container } = render(<Harness />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(container.textContent).toContain('Confirming your payment')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(container.textContent).toContain('Payment confirmed')
  })
})

describe('useBoostCheckoutReturn - timeout (R6.2)', () => {
  it('shows the support message after 60s with no new row', async () => {
    setReturnUrl('?status=success')
    mocks.apiGet.mockResolvedValue(BASELINE)

    const { container } = render(<Harness />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(container.textContent).toContain('still processing')
    expect(container.textContent).toContain('support@areacode.co.za')
    expect(container.textContent).not.toContain('Payment confirmed')
  })
})

describe('useBoostCheckoutReturn - cancelled / failed (R6.3)', () => {
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
    expect(mocks.apiGet).not.toHaveBeenCalled()
  })
})

describe('useBoostCheckoutReturn - URL param stripping (R6.3)', () => {
  it('strips the ?status param on mount for a success return', async () => {
    setReturnUrl('?status=success')
    mocks.apiGet.mockResolvedValue(BASELINE)
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
