// @vitest-environment jsdom
/**
 * OnboardingChecklistCard component tests (proof-of-demand R5.1, R5.2).
 *
 * Validates: Requirements 5.1, 5.2
 *
 * The card is driven by GET /v1/business/me/onboarding-status. It renders one
 * row per flag, each deep-linking to the panel that completes it, renders
 * nothing once all four flags are true, and never shows an empty card on a
 * failed read (loading and error states are its own, with a retry).
 *
 * Five states: loading, error (with retry), incomplete (four rows), complete
 * (hidden), and the per-row deep link.
 */
import { useBusinessStore } from '@area-code/shared/stores/businessStore'
import type { OnboardingStatus } from '@area-code/shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ─────────────────────────────────────────────────────────────────

// react-i18next: return the fallback so assertions read the real chrome copy.
vi.mock('react-i18next', () => {
  const t = (_key: string, fallback?: string) => fallback ?? _key
  return { useTranslation: () => ({ t }) }
})

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }))
vi.mock('@area-code/shared/lib/api', () => ({
  api: { get: mocks.apiGet },
}))

// Import AFTER vi.mock so the component resolves the mocked api. The Zustand
// store is the real one, driven through setState.
import { OnboardingChecklistCard, PANEL_BY_ONBOARDING_STEP } from '../OnboardingChecklistCard'

// ─── Fixtures ──────────────────────────────────────────────────────────────

function status(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return { hasNode: false, hasReward: false, hasStaff: false, hasQr: false, ...overrides }
}

const STEPS = ['venue', 'reward', 'staff', 'qr'] as const

function renderCard(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  render(<OnboardingChecklistCard />, { wrapper })
}

beforeEach(() => {
  mocks.apiGet.mockReset()
  useBusinessStore.setState({ currentPanel: 'live' })
})

afterEach(() => {
  cleanup()
})

// ─── Tests ────────────────────────────────────────────────────────────────

describe('OnboardingChecklistCard - loading state (R5.1)', () => {
  it('shows its own loading state while the status read is in flight', async () => {
    mocks.apiGet.mockReturnValue(new Promise(() => {}))

    renderCard()

    await waitFor(() => expect(screen.getByTestId('onboarding-checklist-loading')).toBeTruthy())
    expect(screen.queryByTestId('onboarding-checklist')).toBeNull()
    expect(screen.queryByTestId('onboarding-checklist-error')).toBeNull()
  })
})

describe('OnboardingChecklistCard - error state (R5.1)', () => {
  it('shows an error with a retry, not an empty card, when the read fails', async () => {
    mocks.apiGet.mockRejectedValue(new Error('network down'))

    renderCard()

    await waitFor(() => expect(screen.getByTestId('onboarding-checklist-error')).toBeTruthy())
    // A failed read must never read as "you are all set".
    expect(screen.queryByTestId('onboarding-checklist')).toBeNull()
    expect(screen.getByTestId('onboarding-checklist-retry')).toBeTruthy()
    // No raw error text.
    expect(screen.getByTestId('onboarding-checklist-error').textContent).not.toContain('network down')
  })

  it('re-reads the status when retry is pressed', async () => {
    mocks.apiGet.mockRejectedValueOnce(new Error('network down'))

    renderCard()

    await waitFor(() => expect(screen.getByTestId('onboarding-checklist-retry')).toBeTruthy())

    mocks.apiGet.mockResolvedValue(status({ hasNode: true }))
    await act(async () => {
      screen.getByTestId('onboarding-checklist-retry').click()
    })

    await waitFor(() => expect(screen.getByTestId('onboarding-checklist')).toBeTruthy())
    expect(mocks.apiGet).toHaveBeenCalledTimes(2)
  })
})

describe('OnboardingChecklistCard - incomplete checklist (R5.1, R5.2)', () => {
  it('renders one row per flag while any flag is false', async () => {
    mocks.apiGet.mockResolvedValue(status({ hasNode: true, hasReward: true }))

    renderCard()

    await waitFor(() => expect(screen.getByTestId('onboarding-checklist')).toBeTruthy())

    for (const step of STEPS) {
      expect(screen.getByTestId(`onboarding-row-${step}`)).toBeTruthy()
    }
    // Two of four done.
    expect(screen.getByTestId('onboarding-checklist-progress').textContent).toContain('2 of 4')
  })

  it('renders a row for a single false flag and keeps the completed rows visible', async () => {
    mocks.apiGet.mockResolvedValue(status({ hasNode: true, hasReward: true, hasStaff: true }))

    renderCard()

    await waitFor(() => expect(screen.getByTestId('onboarding-checklist')).toBeTruthy())
    expect(screen.getByTestId('onboarding-row-qr')).toBeTruthy()
    expect(screen.getByTestId('onboarding-checklist-progress').textContent).toContain('3 of 4')
  })
})

describe('OnboardingChecklistCard - complete checklist (R5.2)', () => {
  it('renders nothing once all four flags are true', async () => {
    mocks.apiGet.mockResolvedValue(status({ hasNode: true, hasReward: true, hasStaff: true, hasQr: true }))

    renderCard()

    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByTestId('onboarding-checklist-loading')).toBeNull())

    expect(screen.queryByTestId('onboarding-checklist')).toBeNull()
    expect(screen.queryByTestId('onboarding-checklist-error')).toBeNull()
    for (const step of STEPS) {
      expect(screen.queryByTestId(`onboarding-row-${step}`)).toBeNull()
    }
  })
})

describe('OnboardingChecklistCard - deep links (R5.1)', () => {
  it('navigates each row to the panel that completes its step', async () => {
    mocks.apiGet.mockResolvedValue(status())

    renderCard()

    await waitFor(() => expect(screen.getByTestId('onboarding-checklist')).toBeTruthy())

    for (const step of STEPS) {
      useBusinessStore.setState({ currentPanel: 'live' })
      act(() => {
        screen.getByTestId(`onboarding-row-${step}`).click()
      })
      expect(useBusinessStore.getState().currentPanel).toBe(PANEL_BY_ONBOARDING_STEP[step])
    }
  })

  it('maps every step to a panel (one home for the mapping)', () => {
    expect(PANEL_BY_ONBOARDING_STEP).toEqual({
      venue: 'settings',
      reward: 'rewards',
      staff: 'settings',
      qr: 'settings',
    })
  })
})
