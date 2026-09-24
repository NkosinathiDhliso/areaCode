// @vitest-environment jsdom
/**
 * Dashboard navigation: the Tonight entry (proof-of-demand R8.3).
 *
 * Validates: Requirements 8.3
 *
 * Tonight is a first-class panel beside the weekly Music Schedule, not a link
 * inside it. Tapping the nav entry selects the panel in the one business store
 * and mounts the form.
 */
import { useBusinessStore } from '@area-code/shared/stores/businessStore'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ─────────────────────────────────────────────────────────────────

// Real copy, so the nav label asserted here is the label an owner reads.
vi.mock('react-i18next', async () => {
  const dict = (await import('../../i18n/locales/en.json')).default as Record<string, string>
  const t = (key: string, fallback?: string) => dict[key] ?? fallback ?? key
  return { useTranslation: () => ({ t }) }
})

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }))
vi.mock('@area-code/shared/lib/api', () => ({ api: { get: mocks.apiGet } }))

vi.mock('@area-code/shared/stores/businessAuthStore', () => {
  const state = { logout: vi.fn(), hasPermission: () => true, role: 'owner' }
  return { useBusinessAuthStore: (selector: (s: typeof state) => unknown) => selector(state) }
})

// Only the panel under test and the default panel can mount; stub both so the
// assertion is about navigation, not about their own data reads.
vi.mock('../panels/TonightForm', () => ({
  TonightForm: () => <div data-testid="tonight-form-stub" />,
}))
vi.mock('../panels/LivePanel', () => ({
  LivePanel: () => <div data-testid="live-panel-stub" />,
}))
vi.mock('../panels/OnboardingChecklistCard', () => ({
  OnboardingChecklistCard: () => null,
  PANEL_BY_ONBOARDING_STEP: { venue: 'settings', reward: 'rewards', staff: 'settings', qr: 'settings' },
}))

import { BusinessDashboard } from '../BusinessDashboard'

beforeEach(() => {
  mocks.apiGet.mockReset()
  mocks.apiGet.mockResolvedValue({ items: [{ id: 'node-1', businessId: 'biz-1', name: 'Venue' }] })
  useBusinessStore.setState({ currentPanel: 'live', nodes: [] })
})

afterEach(() => {
  cleanup()
})

describe('BusinessDashboard - Tonight nav entry (R8.3)', () => {
  it('renders a Tonight entry alongside Music Schedule and opens the panel on tap', async () => {
    render(<BusinessDashboard />)

    const entry = await waitFor(() => screen.getByRole('button', { name: 'Tonight' }))
    expect(screen.getByRole('button', { name: 'Music Schedule' })).toBeTruthy()

    await act(async () => {
      entry.click()
    })

    expect(useBusinessStore.getState().currentPanel).toBe('tonight')
    await waitFor(() => expect(screen.getByTestId('tonight-form-stub')).toBeTruthy())
  })
})
