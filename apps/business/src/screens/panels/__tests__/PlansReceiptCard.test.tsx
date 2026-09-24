// @vitest-environment jsdom
/**
 * The Receipt on the Plans panel (proof-of-demand R6.1, R6.2, R6.3).
 *
 * **Validates: Requirements 6.1, 6.2, 6.3**
 *
 * The panel is rendered whole, because the two things that matter here are
 * relationships between the receipt and the upgrade CTA, not the card alone:
 *
 *   1. The Receipt renders ABOVE the upgrade CTA, for the window the decision is
 *      about (the trial once one has been started).
 *   2. It never gates the CTA. A failed receipt read shows this card's own error
 *      with a retry while the plan buttons below stay present and enabled, so a
 *      receipt outage can never stop someone paying.
 *   3. A zero Found_You window renders the server's next step, deep-linked to
 *      the panel that completes it, and never a zero as the headline.
 *
 * Every sentence is asserted to come from the API verbatim: the Found_You fact
 * has one wording (`buildReceiptCopy`) and the portal never re-derives it.
 */
import { useBusinessStore } from '@area-code/shared/stores/businessStore'
import type { BusinessReceipt } from '@area-code/shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ─────────────────────────────────────────────────────────────────

// Mirrors i18next's two call shapes: `t(key, fallback)` and `t(key, options)`.
// Panel copy now lives in `apps/business/src/i18n/locales/en.json` (R10.6), so
// the interpolating calls pass options, not a fallback string, and the key is
// what the assertions below read.
vi.mock('react-i18next', () => {
  const t = (key: string, second?: string | Record<string, unknown>) => (typeof second === 'string' ? second : key)
  return { useTranslation: () => ({ t }) }
})

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }))
vi.mock('@area-code/shared/lib/api', () => ({
  api: { get: mocks.apiGet, post: mocks.apiPost },
}))

vi.mock('@area-code/shared/stores/businessAuthStore', () => {
  const state = { accessToken: 'token', businessId: 'biz-1' }
  return {
    useBusinessAuthStore: (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state),
  }
})

import { PlansPanel } from '../PlansPanel'

// ─── Fixtures ──────────────────────────────────────────────────────────────

const PLANS = {
  starter: { name: 'Starter', monthlyPriceCents: 0, maxNodes: 1, maxRewards: 3, maxStaff: 2 },
  growth: { name: 'Growth', monthlyPriceCents: 49900, maxNodes: 3, maxRewards: 10, maxStaff: 5, trialDays: 14 },
  pro: { name: 'Pro', monthlyPriceCents: 99900, maxNodes: null, maxRewards: null, maxStaff: null, trialDays: 14 },
  payg: {
    name: 'Pay-as-you-go',
    dailyPriceCents: 9900,
    weeklyPriceCents: 19900,
    maxNodes: 1,
    maxRewards: 3,
    maxStaff: 2,
  },
}

// The renewal moment R6 is about: the trial has run and the business is back on
// starter, so the Growth card carries a live upgrade CTA.
const TRIAL_PROFILE = {
  tier: 'starter',
  trialEndsAt: new Date(Date.now() - 86400000).toISOString(),
  paidUntil: null,
  paidInterval: null,
  paymentGraceUntil: null,
}

function receipt(overrides: Partial<BusinessReceipt> = {}): BusinessReceipt {
  return {
    window: 'trial',
    windowStartUtc: new Date(Date.now() - 11 * 86400000).toISOString(),
    windowEndUtc: new Date().toISOString(),
    foundYouVisitors: 9,
    walkInVisitors: 13,
    headline: '9 people found you on Area Code and checked in during your trial.',
    walkIn: '13 people who were already in the room also checked in.',
    firstTimers: '6 of them had never been in before.',
    bySource: 'Recorded sources: 6 from the map, 2 from a shared link.',
    measuredFrom: null,
    nextStep: null,
    ...overrides,
  }
}

/** Route the panel's three reads; the receipt read is per-test. */
function routeReads(receiptRead: () => Promise<unknown>, profile: Record<string, unknown> = TRIAL_PROFILE): void {
  mocks.apiGet.mockImplementation((url: string) => {
    if (url === '/v1/business/plans') return Promise.resolve(PLANS)
    if (url === '/v1/business/me') return Promise.resolve(profile)
    if (url.startsWith('/v1/business/receipt')) return receiptRead()
    if (url.startsWith('/v1/business/subscription-payments')) return Promise.resolve({ items: [], nextCursor: null })
    return Promise.resolve({ items: [], nextCursor: null })
  })
}

function renderPanel(): HTMLElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { container } = render(<PlansPanel />, { wrapper })
  return container
}

/** The plan-card upgrade button (Growth), the CTA the receipt sits above. */
function upgradeCta(container: HTMLElement): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === 'biz.plans.subscribe' || b.textContent === 'biz.plans.startTrial',
  )
  if (!button) throw new Error('no upgrade CTA rendered')
  return button as HTMLButtonElement
}

beforeEach(() => {
  mocks.apiGet.mockReset()
  mocks.apiPost.mockReset()
  useBusinessStore.setState({ currentPanel: 'plans' })
})

afterEach(() => {
  cleanup()
})

// ─── Placement and window ──────────────────────────────────────────────────

describe('PlansPanel receipt, placement (R6.2)', () => {
  it('renders the Receipt above the upgrade CTA', async () => {
    routeReads(() => Promise.resolve(receipt()))

    const container = renderPanel()

    await waitFor(() => expect(screen.getByTestId('plans-receipt')).toBeTruthy())

    const card = screen.getByTestId('plans-receipt')
    const cta = upgradeCta(container)
    // DOCUMENT_POSITION_FOLLOWING: the CTA comes after the receipt card.
    expect(card.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('asks for the trial window while a trial has been started', async () => {
    routeReads(() => Promise.resolve(receipt()))

    renderPanel()

    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith('/v1/business/receipt?window=trial'))
  })

  it('asks for the paid window for a business that went straight to paying', async () => {
    routeReads(() => Promise.resolve(receipt({ window: 'paid' })), {
      ...TRIAL_PROFILE,
      trialEndsAt: null,
      paidUntil: new Date(Date.now() + 10 * 86400000).toISOString(),
      paidInterval: 'monthly',
    })

    renderPanel()

    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith('/v1/business/receipt?window=paid'))
  })

  it('renders every sentence the API worded, and no locally built number', async () => {
    const body = receipt()
    routeReads(() => Promise.resolve(body))

    renderPanel()

    await waitFor(() => expect(screen.getByTestId('plans-receipt')).toBeTruthy())
    expect(screen.getByTestId('plans-receipt-headline').textContent).toBe(body.headline)
    expect(screen.getByTestId('plans-receipt-walkin').textContent).toBe(body.walkIn)
    expect(screen.getByTestId('plans-receipt-firsttimers').textContent).toBe(body.firstTimers)
    expect(screen.getByTestId('plans-receipt-bysource').textContent).toBe(body.bySource)
    // Nothing to say honestly about a fully measured window.
    expect(screen.queryByTestId('plans-receipt-measuredfrom')).toBeNull()
    expect(screen.queryByTestId('plans-receipt-nextstep')).toBeNull()
  })
})

// ─── Zero state ────────────────────────────────────────────────────────────

describe('PlansPanel receipt, zero Found_You (R6.3)', () => {
  const zero = receipt({
    foundYouVisitors: 0,
    walkInVisitors: 0,
    headline: 'No one has found you on Area Code and checked in during your trial yet.',
    walkIn: 'No check-ins were recorded from people already in the room.',
    firstTimers: null,
    bySource: null,
    nextStep: { step: 'qr', text: 'Turn on QR check-in and put the code where customers order.' },
  })

  it('shows the checklist next step instead of a zero headline', async () => {
    routeReads(() => Promise.resolve(zero))

    renderPanel()

    await waitFor(() => expect(screen.getByTestId('plans-receipt-nextstep')).toBeTruthy())
    expect(screen.getByTestId('plans-receipt-nextstep').textContent).toBe(zero.nextStep?.text)
    expect(screen.getByTestId('plans-receipt-headline').textContent).not.toMatch(/\b0\b/)
  })

  it('deep-links the next step to the panel that completes it', async () => {
    routeReads(() => Promise.resolve(zero))

    const container = renderPanel()

    await waitFor(() => expect(screen.getByTestId('plans-receipt-nextstep-cta')).toBeTruthy())

    act(() => {
      screen.getByTestId('plans-receipt-nextstep-cta').click()
    })

    // `qr` is completed on the settings panel, per the checklist's own mapping.
    expect(useBusinessStore.getState().currentPanel).toBe('settings')
    // The zero state is an invitation, not a gate: the upgrade CTA is still live.
    expect(upgradeCta(container).disabled).toBe(false)
  })

  it('omits the deep link when the next step is reach, which no panel completes', async () => {
    routeReads(() =>
      Promise.resolve(
        receipt({
          foundYouVisitors: 0,
          headline: 'No one has found you on Area Code and checked in during your trial yet.',
          firstTimers: null,
          bySource: null,
          nextStep: { step: null, text: 'Share your venue link with your regulars, and publish what is on tonight.' },
        }),
      ),
    )

    renderPanel()

    await waitFor(() => expect(screen.getByTestId('plans-receipt-nextstep')).toBeTruthy())
    expect(screen.queryByTestId('plans-receipt-nextstep-cta')).toBeNull()
  })
})

// ─── The receipt never blocks the CTA ──────────────────────────────────────

describe('PlansPanel receipt, never blocks the upgrade CTA (R6.2)', () => {
  it('keeps the CTA usable when the receipt read fails', async () => {
    routeReads(() => Promise.reject(new Error('receipt read exploded')))
    mocks.apiPost.mockResolvedValue({ checkoutUrl: '#stub' })

    const container = renderPanel()

    await waitFor(() => expect(screen.getByTestId('plans-receipt-error')).toBeTruthy())
    // No raw error text, and a retry of its own.
    expect(screen.getByTestId('plans-receipt-error').textContent).not.toContain('exploded')
    expect(screen.getByTestId('plans-receipt-retry')).toBeTruthy()

    const cta = upgradeCta(container)
    expect(cta.disabled).toBe(false)

    await act(async () => {
      cta.click()
    })

    expect(mocks.apiPost).toHaveBeenCalledWith('/v1/business/checkout', { plan: 'growth', interval: 'monthly' })
  })

  it('shows its own loading state while the read is in flight, CTA already live', async () => {
    routeReads(() => new Promise(() => {}))

    const container = renderPanel()

    await waitFor(() => expect(screen.getByTestId('plans-receipt-loading')).toBeTruthy())
    expect(upgradeCta(container).disabled).toBe(false)
    expect(screen.queryByTestId('plans-receipt')).toBeNull()
  })

  it('re-reads the Receipt when its retry is pressed', async () => {
    routeReads(() => Promise.reject(new Error('down')))

    renderPanel()

    await waitFor(() => expect(screen.getByTestId('plans-receipt-retry')).toBeTruthy())

    routeReads(() => Promise.resolve(receipt()))
    await act(async () => {
      screen.getByTestId('plans-receipt-retry').click()
    })

    await waitFor(() => expect(screen.getByTestId('plans-receipt')).toBeTruthy())
  })
})
