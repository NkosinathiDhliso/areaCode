/**
 * Portal Hardening item D — admin detail drill-down surfacing tests.
 *
 * Task 4.3 surfacing tests, frontend half. Proves that each surfaced detail
 * view issues its read call(s) against the previously-unsurfaced admin
 * endpoints and renders the returned data:
 *
 *  - ConsumerDetailPanel issues the three user reads
 *    (`/v1/admin/users/:userId`, `/v1/admin/users/:userId/check-ins`,
 *    `/v1/admin/consent/:userId`) and renders the profile, check-in, and
 *    consent sections.
 *  - BusinessDetailPanel issues the business read
 *    (`/v1/admin/businesses/:businessId`) and renders the overview.
 *
 * The shared api client is stubbed so no real network call leaves the test.
 *
 * **Validates: Requirements 4.1, 4.5**
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

// ─── Mocks ──────────────────────────────────────────────────────────────────

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }))

vi.mock('@area-code/shared/lib/api', () => ({
  api: {
    get: getMock,
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    setTokenProvider: vi.fn(),
    setRefreshHandler: vi.fn(),
    setRefreshPath: vi.fn(),
    ensureValidToken: vi.fn(),
  },
  setApiErrorHandler: vi.fn(),
  onTokenRefresh: vi.fn(() => () => {}),
}))

// react-i18next: return the fallback string so copy is deterministic.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}))

import { api } from '@area-code/shared/lib/api'
import { ConsumerDetailPanel } from '../components/ConsumerDetailPanel'
import { BusinessDetailPanel } from '../components/BusinessDetailPanel'

afterEach(() => {
  vi.clearAllMocks()
})

describe('ConsumerDetailPanel surfaces the three user reads (R4.1)', () => {
  it('issues user, check-ins, and consent reads and renders them', async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/v1/admin/users/u-1') {
        return Promise.resolve({
          userId: 'u-1',
          username: 'Thandi',
          email: 'thandi@example.com',
          tier: 'regular',
          totalCheckIns: 12,
          cityId: 'jhb',
          createdAt: '2024-01-01T00:00:00.000Z',
          consentRecords: [],
          pushTokens: [],
          notificationPrefs: {},
        })
      }
      if (url === '/v1/admin/users/u-1/check-ins') {
        return Promise.resolve([
          {
            id: 'ci-1',
            nodeId: 'n-1',
            checkedInAt: '2024-02-02T10:00:00.000Z',
            type: 'checkin',
            node: { name: 'Kitchener', slug: 'kitchener' },
          },
        ])
      }
      if (url === '/v1/admin/consent/u-1') {
        return Promise.resolve([
          { consentVersion: 'v1.0', analyticsOptIn: true, consentedAt: '2024-01-01T00:00:00.000Z' },
        ])
      }
      return Promise.reject(new Error(`unexpected url ${url}`))
    })

    const { getByText } = render(<ConsumerDetailPanel userId="u-1" onClose={() => {}} />)

    await waitFor(() => {
      expect(getByText('Thandi')).toBeTruthy()
    })

    // All three reads were issued against the surfaced endpoints.
    const calledUrls = (api.get as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(calledUrls).toContain('/v1/admin/users/u-1')
    expect(calledUrls).toContain('/v1/admin/users/u-1/check-ins')
    expect(calledUrls).toContain('/v1/admin/consent/u-1')

    // Returned data renders in each section.
    expect(getByText('thandi@example.com')).toBeTruthy()
    expect(getByText('Kitchener')).toBeTruthy()
    expect(getByText(/Analytics: opted in/)).toBeTruthy()
  })
})

describe('BusinessDetailPanel surfaces the business read (R4.1)', () => {
  it('issues the business detail read and renders it', async () => {
    ;(api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      businessId: 'b-1',
      businessName: 'The Grind',
      email: 'owner@grind.co.za',
      tier: 'growth',
      isActive: true,
      registrationNumber: '2020/123456/07',
      trialEndsAt: null,
      createdAt: '2023-06-01T00:00:00.000Z',
      nodes: [{ id: 'n-1', name: 'The Grind Braamfontein', slug: 'grind-braam', claimStatus: 'claimed' }],
      staffAccounts: [{ id: 's-1', name: 'Sipho', isActive: true }],
    })

    const { getByText } = render(<BusinessDetailPanel businessId="b-1" onClose={() => {}} />)

    await waitFor(() => {
      expect(getByText('The Grind')).toBeTruthy()
    })

    const calledUrls = (api.get as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])
    expect(calledUrls).toContain('/v1/admin/businesses/b-1')

    expect(getByText('owner@grind.co.za')).toBeTruthy()
    expect(getByText('The Grind Braamfontein')).toBeTruthy()
    expect(getByText('Sipho')).toBeTruthy()
  })
})
