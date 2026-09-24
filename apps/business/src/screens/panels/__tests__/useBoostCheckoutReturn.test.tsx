// @vitest-environment jsdom
/**
 * Component/hook tests for the boost checkout-return flow (billing-revenue-integrity
 * R6, boost path, task 10.1; proof-of-demand R15.11, task 15.2). Drives
 * `useBoostCheckoutReturn` and renders `CheckoutReturnBanner` through a small
 * harness so the polled state and per-state copy are asserted together.
 *
 * The boost path has no absolute paid tier to poll for, so it waits for THE
 * purchase the owner just paid for, identified by the `yocoCheckoutId` the
 * return URL carries. The count baseline this replaced was taken at the first
 * poll, so a webhook that landed before that poll was already inside the
 * baseline and the banner said "still processing" forever.
 *
 * `api.get` is mocked via `vi.hoisted` and fake timers drive the 2s poll
 * cadence (per tech.md).
 *
 * **Validates: Requirements 6.1, 6.2, 6.3, 15.11**
 */
import { render, act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CheckoutReturnBanner } from '../CheckoutReturnBanner'
import { rememberPendingBoostCheckout, useBoostCheckoutReturn } from '../useCheckoutReturn'

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

// The checkout the owner is paying for on this return leg.
const AWAITED = 'chk-new'

// Only older purchases: the awaited one has not been persisted yet.
const BASELINE = purchases(row('2026-07-08T10:00:00.000Z', 'chk-old'))
// The awaited purchase has landed.
const GREW = purchases(row('2026-07-09T00:00:05.000Z', AWAITED), row('2026-07-08T10:00:00.000Z', 'chk-old'))

// Renders the banner driven by the real hook, matching how BoostPanel wires it.
function Harness() {
  const { returnState, dismiss } = useBoostCheckoutReturn(BUSINESS_ID)
  return <CheckoutReturnBanner state={returnState} onDismiss={dismiss} />
}

function setReturnUrl(search: string) {
  window.history.replaceState({}, '', `/boost${search}`)
}

// The success URL Yoco sends the owner back to, after `BoostPanel` has handed
// the pending checkout id to the return leg.
function setSuccessReturn(checkoutId: string = AWAITED) {
  rememberPendingBoostCheckout(checkoutId)
  setReturnUrl('?status=success')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-09T00:00:00.000Z'))
  mocks.apiGet.mockReset()
  window.sessionStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

describe('useBoostCheckoutReturn - success poll (R6.1, R15.11)', () => {
  it('stays activating while the awaited purchase has not been persisted', async () => {
    setSuccessReturn()
    mocks.apiGet.mockResolvedValue(BASELINE)

    const { container } = render(<Harness />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(container.textContent).toContain('Confirming your payment')
    expect(mocks.apiGet).toHaveBeenCalledWith(`/v1/business/${BUSINESS_ID}/boost-purchases`)
  })

  it('confirms once the awaited purchase appears', async () => {
    setSuccessReturn()
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

  /**
   * The defect this task fixes (R15.11). The webhook landed while the owner was
   * still being redirected, so the row is already in the list on the very first
   * poll. A count baseline captured at that poll could never see growth; the
   * awaited id is visible immediately.
   */
  it('confirms on the first poll when the webhook landed before it', async () => {
    setSuccessReturn()
    mocks.apiGet.mockResolvedValue(GREW)

    const { container } = render(<Harness />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(container.textContent).toContain('Payment confirmed')
    expect(container.textContent).not.toContain('still processing')
  })

  it('does not confirm when a different purchase lands', async () => {
    setSuccessReturn('chk-mine')
    // A different boost of the same business lands during the window.
    mocks.apiGet.mockResolvedValue(GREW)

    const { container } = render(<Harness />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000)
    })

    expect(container.textContent).toContain('Confirming your payment')
  })

  it('reads the awaited id from the return URL when it is already there', async () => {
    setReturnUrl(`?status=success&checkoutId=${AWAITED}`)
    mocks.apiGet.mockResolvedValue(GREW)

    const { container } = render(<Harness />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(container.textContent).toContain('Payment confirmed')
  })
})

describe('useBoostCheckoutReturn - timeout (R6.2)', () => {
  it('shows the support message after 60s with no new row', async () => {
    setSuccessReturn()
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
  it('strips the return params on mount for a success return', async () => {
    setSuccessReturn()
    mocks.apiGet.mockResolvedValue(BASELINE)
    expect(window.location.search).toContain('status')

    render(<Harness />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(window.location.search).not.toContain('status')
    expect(window.location.search).not.toContain('checkoutId')
  })

  it('consumes the pending id once, so a refresh does not re-await a done purchase', async () => {
    setSuccessReturn()
    mocks.apiGet.mockResolvedValue(BASELINE)

    render(<Harness />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(window.sessionStorage.getItem('areaCode.pendingBoostCheckoutId')).toBeNull()
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
