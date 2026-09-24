/**
 * Admin surfaces: email overflow and the SAST clock (proof-of-demand R15.14,
 * R15.15).
 *
 * An owner email is long and arbitrary, so on a 375px admin screen it has to
 * truncate rather than push the venue and staff counts out of view.
 *
 * The entitlement end date is a wall-clock value with no offset attached. Read in
 * the device timezone it lands hours away from the date the admin typed, which
 * silently moves when a venue lapses off the map. It is read as SAST, the
 * venue's clock, through the one shared helper.
 *
 * **Validates: Requirements 15.14, 15.15**
 */
// @vitest-environment jsdom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}))

vi.mock('@area-code/shared/lib/api', () => ({
  api: { get: mocks.apiGet, post: mocks.apiPost, put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}))

vi.mock('../stores/adminAuthStore', () => ({
  useAdminAuthStore: (selector: (s: { role: string }) => unknown) => selector({ role: 'super_admin' }),
}))

import { SetTierDialog } from '../components/SetTierDialog'
import { BusinessManagement } from '../screens/BusinessManagement'

const LONG_EMAIL = 'accounts.payable.and.venue.manager@an-extremely-long-venue-domain-name.co.za'

beforeEach(() => {
  mocks.apiGet.mockReset()
  mocks.apiPost.mockReset()
})

afterEach(() => {
  cleanup()
})

// ─── Email overflow ─────────────────────────────────────────────────────────

describe('BusinessManagement business email on a narrow screen (R15.14)', () => {
  it('truncates the owner email and keeps the counts on their own line', async () => {
    mocks.apiGet.mockResolvedValue({
      items: [
        {
          id: 'biz-1',
          businessName: 'The Long Named Rooftop Bar and Grill',
          email: LONG_EMAIL,
          tier: 'growth',
          nodeCount: 2,
          staffCount: 5,
          activeRewardCount: 3,
          trialEndsAt: null,
          paidUntil: null,
          paidInterval: null,
          paymentGraceUntil: null,
        },
      ],
    })

    const { container } = render(<BusinessManagement />)
    const search = container.querySelector('input[type="text"]') as HTMLInputElement
    fireEvent.change(search, { target: { value: 'rooftop' } })
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Search')!)

    await waitFor(() => expect(container.textContent).toContain(LONG_EMAIL))

    const emailCell = container.querySelector(`span[title="${LONG_EMAIL}"]`) as HTMLElement
    expect(emailCell).toBeTruthy()
    expect(emailCell.className).toContain('truncate')
    // The counts sit in a sibling span, so a long email cannot displace them.
    const counts = emailCell.nextElementSibling as HTMLElement
    expect(counts.textContent).toContain('2 nodes')
    expect(counts.textContent).toContain('5 staff')
  })
})

// ─── datetime-local as SAST ─────────────────────────────────────────────────

describe('SetTierDialog entitlement end date is SAST (R15.15)', () => {
  function renderDialog() {
    const onSaved = vi.fn()
    const onClose = vi.fn()
    const view = render(<SetTierDialog businessId="biz-1" initialTier="growth" onClose={onClose} onSaved={onSaved} />)
    return { ...view, onSaved, onClose }
  }

  function fill(container: HTMLElement, reason: string, paidUntil: string): void {
    fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, { target: { value: reason } })
    fireEvent.change(container.querySelector('input[type="datetime-local"]') as HTMLInputElement, {
      target: { value: paidUntil },
    })
  }

  it('sends the typed wall clock as the matching UTC instant, two hours back', async () => {
    mocks.apiPost.mockResolvedValue({})
    const { container } = renderDialog()

    fill(container, 'Launch partner comp', '2030-06-15T18:30')
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Set Tier')!)

    await waitFor(() => expect(mocks.apiPost).toHaveBeenCalledTimes(1))
    expect(mocks.apiPost).toHaveBeenCalledWith('/v1/admin/businesses/biz-1/set-tier', {
      tier: 'growth',
      reason: 'Launch partner comp',
      paidUntil: '2030-06-15T16:30:00.000Z',
    })
  })

  it('seeds the field with a SAST wall clock, not a UTC one', () => {
    const { container } = renderDialog()
    const input = container.querySelector('input[type="datetime-local"]') as HTMLInputElement
    const expected = new Date(Date.now() + 2 * 60 * 60 * 1000)
    expected.setUTCMonth(expected.getUTCMonth() + 1)
    // Same SAST calendar date as one month from now (the minute may tick over).
    expect(input.value.slice(0, 10)).toBe(expected.toISOString().slice(0, 10))
  })

  it('refuses a past date and sends nothing', async () => {
    const { container } = renderDialog()

    fill(container, 'Backdated comp', '2020-01-01T10:00')
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Set Tier')!)

    await waitFor(() => expect(container.textContent).toContain('must be a valid date in the future'))
    expect(mocks.apiPost).not.toHaveBeenCalled()
  })

  it('labels the field with the timezone the admin is typing in', () => {
    const { container } = renderDialog()
    expect(container.textContent).toContain('Entitlement end date (SAST)')
  })
})
