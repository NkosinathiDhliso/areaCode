/**
 * Component tests for the honest empty state on the public auth landing
 * (portal-hardening item A, task 1.2).
 *
 * Item A removed the fabricated `FALLBACK_TRENDING` constant and its masking
 * `.catch`. The trending query now surfaces `undefined` on failure, so the
 * "Trending Now" card is simply absent (honest empty state) rather than
 * rendering invented venues. Genuine data still renders, including the Live
 * badge.
 *
 * The api client is mocked (no network); RUM is stubbed. react-i18next is not
 * initialised in unit tests, so `t(key, fallback)` returns the inline English
 * fallback, which is what we assert on. The QueryClient uses `retryDelay: 0`
 * so the query-level `retry: 1` resolves instantly.
 *
 * Validates: Requirements 1.1, 1.2, 1.3
 */
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Raw source of the component under test, imported cwd-independently via Vite's
// ?raw so the "no fabricated data" assertion reads the real file.
import authLandingSource from '../AuthLanding.tsx?raw'

const apiGet = vi.fn()
vi.mock('@area-code/shared/lib/api', () => ({ api: { get: (url: string) => apiGet(url) } }))
vi.mock('@area-code/shared/lib/rum', () => ({ recordEvent: vi.fn() }))

import { AuthLanding } from '../AuthLanding'

// The invented venues that the removed FALLBACK_TRENDING used to render. None
// of these may ever appear on the public landing again.
const OLD_FALLBACK_NAMES = ['Maboneng Precinct', 'Umhlanga Promenade']

function renderLanding() {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AuthLanding onNavigate={vi.fn()} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiGet.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('AuthLanding honest trending empty state', () => {
  it('shows no fabricated venues and no Trending card when the query fails (R1.1, R1.2, R1.4)', async () => {
    apiGet.mockRejectedValue(new Error('network down'))
    renderLanding()

    // The page still renders its static sections without crashing (R1.4).
    expect(screen.getByText('About Area Code')).toBeTruthy()
    // Hero/logo still present.
    expect(screen.getByText('Area Code')).toBeTruthy()

    // Let the query (with retry: 1) settle into its failed state.
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/v1/nodes/trending'))

    // No invented venue names from the old fallback (R1.1, R1.2).
    for (const name of OLD_FALLBACK_NAMES) {
      expect(screen.queryByText(name)).toBeNull()
    }

    // The Trending card is absent entirely (honest empty state).
    expect(screen.queryByText('Trending Now')).toBeNull()
    // No Live badge without real data.
    expect(screen.queryByText('Live')).toBeNull()
  })

  it('renders genuine trending items with the Live badge when the query resolves (R1.3)', async () => {
    apiGet.mockResolvedValue({
      items: [
        { name: 'Real Venue One', area: 'Cape Town', state: 'popping', checkIns: 12, category: 'nightlife' },
        { name: 'Real Venue Two', area: 'Johannesburg', state: 'buzzing', checkIns: 8, category: 'food' },
      ],
    })
    renderLanding()

    // Genuine data renders unchanged.
    await waitFor(() => expect(screen.getByText('Real Venue One')).toBeTruthy())
    expect(screen.getByText('Real Venue Two')).toBeTruthy()
    // The Trending card header and the Live badge both show with real data (R1.3).
    expect(screen.getByText('Trending Now')).toBeTruthy()
    expect(screen.getByText('Live')).toBeTruthy()

    // Even with real data, the old fabricated names never appear.
    for (const name of OLD_FALLBACK_NAMES) {
      expect(screen.queryByText(name)).toBeNull()
    }
  })

  it('no longer defines FALLBACK_TRENDING in the source file (R1.2)', () => {
    expect(authLandingSource).not.toContain('FALLBACK_TRENDING')
  })
})
