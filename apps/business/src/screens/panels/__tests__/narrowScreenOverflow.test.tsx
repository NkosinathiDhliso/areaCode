/**
 * Narrow-screen overflow on owner surfaces (proof-of-demand R15.14).
 *
 * The baseline device is 375px. A four-column metrics table cannot fit there at
 * a readable size, so it keeps a minimum width and its wrapper scrolls
 * sideways: the numbers stay legible and the page itself never scrolls
 * horizontally. Long reward titles and long invite emails truncate instead of
 * pushing the numbers, the expiry date, or the row actions off screen.
 *
 * jsdom has no layout engine, so these tests assert the structure that produces
 * the behaviour (the scroll container, the min width, `min-w-0` on the flex
 * parent, `truncate` on the text) rather than measured pixels. Visual fidelity
 * at 375px is checked by hand.
 *
 * **Validates: Requirements 15.14**
 */
// @vitest-environment jsdom
import { render, cleanup, waitFor, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}))

vi.mock('../NodeEditorPanel', () => ({ NodeEditorPanel: () => null }))

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  showError: vi.fn(),
  setPanel: vi.fn(),
}))

vi.mock('@area-code/shared/lib/api', () => ({
  api: { get: mocks.apiGet, post: mocks.apiPost, patch: mocks.apiPatch, delete: mocks.apiDelete },
}))

vi.mock('@area-code/shared/stores/businessStore', () => ({
  useBusinessStore: (selector?: (state: unknown) => unknown) => {
    const state = { setPanel: mocks.setPanel }
    return selector ? selector(state) : state
  },
}))

vi.mock('@area-code/shared/stores/errorStore', () => ({
  useErrorStore: { getState: () => ({ showError: mocks.showError }) },
}))

import { RewardMetricsPanel } from '../RewardMetricsPanel'
import { SettingsPanel } from '../SettingsPanel'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const LONG_TITLE = 'Two-for-one craft lager every Thursday before nine, house rules apply'
const LONG_EMAIL = 'aphiwe.nomvete.frontofhouse.manager@really-long-venue-domain.co.za'

function summaryItem(rewardId: string, title: string) {
  return {
    rewardId,
    title,
    claimRate: 0.42,
    timeToClaimMinutes: 95,
    redemptionRate: 0.31,
    isLowPerformance: true,
  }
}

beforeEach(() => {
  mocks.apiGet.mockReset()
  mocks.apiPost.mockReset()
})

afterEach(() => {
  cleanup()
})

// ─── RewardMetricsPanel ───────────────────────────────────────────────────────

describe('RewardMetricsPanel on a narrow screen (R15.14)', () => {
  async function renderPanel(): Promise<HTMLElement> {
    mocks.apiGet.mockResolvedValue({ items: [summaryItem('rw-1', LONG_TITLE)] })
    const { container } = render(<RewardMetricsPanel />)
    await waitFor(() => expect(container.textContent).toContain('Claim Rate'))
    return container
  }

  it('wraps the four-column table in a horizontal scroll container', async () => {
    const container = await renderPanel()
    const wrapper = container.querySelector('[data-testid="reward-metrics-scroll"]')
    expect(wrapper).toBeTruthy()
    expect(wrapper!.className).toContain('overflow-x-auto')
    // The old `overflow-hidden` clipped the last column instead of scrolling.
    expect(wrapper!.className).not.toContain('overflow-hidden')
  })

  it('keeps the table at a readable minimum width inside the scroller', async () => {
    const container = await renderPanel()
    const wrapper = container.querySelector('[data-testid="reward-metrics-scroll"]')
    const table = wrapper!.firstElementChild as HTMLElement
    expect(table.className).toMatch(/min-w-\[/)
  })

  it('truncates a long reward title instead of reflowing the row', async () => {
    const container = await renderPanel()
    const titleCell = container.querySelector(`span[title="${LONG_TITLE}"]`) as HTMLElement
    expect(titleCell).toBeTruthy()
    expect(titleCell.className).toContain('truncate')
    // The full title stays reachable on hover once it is clipped.
    expect(titleCell.getAttribute('title')).toBe(LONG_TITLE)
    // A truncating child needs a shrinkable flex parent to clip at all.
    expect((titleCell.parentElement as HTMLElement).className).toContain('min-w-0')
  })

  it('keeps every metric column present so scrolling reveals real data', async () => {
    const container = await renderPanel()
    expect(container.textContent).toContain('42%')
    expect(container.textContent).toContain('1h 35m')
    expect(container.textContent).toContain('31%')
  })
})

// ─── SettingsPanel invite and staff emails ────────────────────────────────────

describe('SettingsPanel emails on a narrow screen (R15.14)', () => {
  function mockSettings(): void {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString()
    mocks.apiGet.mockImplementation((url: string) => {
      if (url === '/v1/business/me') {
        return Promise.resolve({ id: 'biz-1', tier: 'growth', trialEndsAt: null, digestEmailOptOut: false })
      }
      if (url === '/v1/business/staff') {
        return Promise.resolve({ items: [{ id: 'st-1', name: 'Aphiwe', email: LONG_EMAIL, cognitoSub: 'sub-1' }] })
      }
      if (url === '/v1/business/staff/invites') {
        return Promise.resolve({
          items: [
            {
              id: 'inv-1',
              inviteToken: 'tok-1',
              invitedEmail: LONG_EMAIL,
              accepted: false,
              expiresAt,
              createdAt: new Date().toISOString(),
            },
          ],
        })
      }
      return Promise.resolve({})
    })
  }

  it('truncates a long pending-invite email and keeps the row actions reachable', async () => {
    mockSettings()
    const { container } = render(<SettingsPanel />)
    await waitFor(() => expect(container.textContent).toContain('Pending invites'))

    const emailCells = Array.from(container.querySelectorAll('span')).filter((s) => s.textContent === LONG_EMAIL)
    // Once in the pending invite row, once on the active staff member.
    expect(emailCells.length).toBe(2)
    for (const cell of emailCells) {
      expect(cell.className).toContain('truncate')
      expect((cell.parentElement as HTMLElement).className).toContain('min-w-0')
    }

    // The Revoke control must not be squeezed out by the email beside it.
    const revoke = screen.getByText('Revoke')
    expect((revoke.parentElement as HTMLElement).className).toContain('shrink-0')
  })
})
