/**
 * Staff honest lapsed-business state (cross-portal-lifecycle-alignment R3.1).
 *
 * The Lapsed_Business_Banner renders on the staff home when the bootstrap read
 * reports `businessState: 'lapsed'`, and NOT when it is active. Critically, the
 * validator stays mounted in the lapsed case — the banner never blocks scanning
 * of already-earned codes (R3.2).
 *
 * **Validates: Requirements 3.1**
 */
// @vitest-environment jsdom
import { render, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockApiGet = vi.fn()

vi.mock('@area-code/shared/lib/api', () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }),
}))

vi.mock('../../stores/staffAuthStore', () => ({
  useStaffAuthStore: () => ({ staffName: 'Sam', businessId: 'biz-1', logout: vi.fn() }),
}))

// Child surfaces are exercised elsewhere; stub them to isolate the banner logic.
vi.mock('../../components/StaffValidator', () => ({
  StaffValidator: () => <div data-testid="validator">validator</div>,
}))
vi.mock('../../components/FirstGetIssuer', () => ({ FirstGetIssuer: () => null }))
vi.mock('../../components/VibeDeclaration', () => ({ VibeDeclaration: () => null }))
vi.mock('../../components/MyRank', () => ({ MyRank: () => null }))
vi.mock('../../components/RecentRedemptions', () => ({ RecentRedemptions: () => null }))

import { StaffHome } from '../StaffHome'

const BANNER_TEXT = 'no longer active'

describe('StaffHome — Lapsed_Business_Banner (R3.1)', () => {
  beforeEach(() => {
    mockApiGet.mockReset()
  })
  afterEach(() => {
    cleanup()
  })

  it('shows the banner and keeps the validator when the business is lapsed', async () => {
    mockApiGet.mockResolvedValue({ businessName: 'Cafe', businessState: 'lapsed', isActive: false })
    const { container, getByTestId } = render(<StaffHome />)
    await waitFor(() => {
      expect(container.textContent).toContain(BANNER_TEXT)
    })
    // The validator stays available so earned codes can still be scanned (R3.2).
    expect(getByTestId('validator')).toBeTruthy()
  })

  it('does not show the banner when the business is active', async () => {
    mockApiGet.mockResolvedValue({ businessName: 'Cafe', businessState: 'active', isActive: true })
    const { container, getByTestId } = render(<StaffHome />)
    await waitFor(() => {
      expect(getByTestId('validator')).toBeTruthy()
    })
    expect(container.textContent).not.toContain(BANNER_TEXT)
  })
})
