/**
 * DigestCard component tests (weekly-attribution-digest R4.1).
 *
 * Validates: Requirements 4.1
 *
 * The dashboard DigestCard renders the latest Digest from
 * GET /v1/business/digest/latest. The design constraint is one source of truth
 * for copy: the card renders the API-provided copy strings verbatim (the
 * sentences and the tier close) and never re-derives copy in the client.
 * Metric counts may be shown as headline figures; a quiet week shows an honest
 * zero, never a fabricated number.
 *
 * Covers the four states from the design testing strategy:
 *   1. normal   — metrics plus copy sentences render, headline counts shown.
 *   2. deltas   — signed week-over-week chips render from the deltas field.
 *   3. quiet    — zero visits: honest zero headline, quiet-week copy rendered,
 *                 no fabricated numbers.
 *   4. close    — starter upgrade close vs paid full-report close, both taken
 *                 straight from the API copy array (last line).
 */
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ─────────────────────────────────────────────────────────────────

// react-i18next: return the fallback string so assertions read the real chrome
// copy, and keep a stable `t` identity.
vi.mock('react-i18next', () => {
  const t = (_key: string, fallback?: string) => fallback ?? _key
  return { useTranslation: () => ({ t }) }
})

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }))
vi.mock('@area-code/shared/lib/api', () => ({
  api: { get: mocks.apiGet },
}))

// Import AFTER vi.mock so the component resolves the mocked api.
import { DigestCard } from '../DigestCard'

// ─── Fixtures (mirror the backend DigestView shape) ──────────────────────────

// Close lines copied from the backend copy builder constants (digest.ts) so the
// card is asserted against the exact strings the API sends.
const STARTER_UPGRADE_CLOSE = 'The full weekly report adds peak-hours analysis. Upgrade to unlock it.'
const FULL_REPORT_CLOSE = 'Your full weekly report has the complete breakdown. Open it from your dashboard.'

interface DigestMetrics {
  visits: number
  uniqueVisitors: number
  firstTimeVisitors: number
  returningVisitors: number
  redemptions: number
  firstGetIssued: number
  firstGetConversions: number
  busiestDay: string | null
  busiestHour: number | null
}

function metrics(overrides: Partial<DigestMetrics> = {}): DigestMetrics {
  return {
    visits: 23,
    uniqueVisitors: 18,
    firstTimeVisitors: 7,
    returningVisitors: 11,
    redemptions: 6,
    firstGetIssued: 9,
    firstGetConversions: 4,
    busiestDay: 'Friday',
    busiestHour: 20,
    ...overrides,
  }
}

function digestResponse(overrides: {
  metrics?: Partial<DigestMetrics>
  deltas?: Record<string, number> | null
  copy?: string[]
  tierAtBuild?: string
}) {
  return {
    digest: {
      weekStart: '2026-07-06',
      metrics: metrics(overrides.metrics),
      deltas: overrides.deltas ?? null,
      suppressed: [],
      tierAtBuild: overrides.tierAtBuild ?? 'growth',
      copy: overrides.copy ?? [],
      createdAt: '2026-07-06T20:00:00.000Z',
    },
  }
}

// ─── Harness ──────────────────────────────────────────────────────────────

function renderCard(): void {
  // A fresh client per render with retry disabled so an error state resolves
  // immediately rather than retrying.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  render(<DigestCard />, { wrapper })
}

beforeEach(() => {
  mocks.apiGet.mockReset()
})

afterEach(() => {
  cleanup()
})

// ─── Tests ────────────────────────────────────────────────────────────────

describe('DigestCard - normal state (R4.1)', () => {
  it('renders the headline visit count and the API copy sentences verbatim', async () => {
    const sentence = '23 visits recorded through Area Code this week.'
    const secondLine = '7 first-time visitors recorded.'
    mocks.apiGet.mockResolvedValue(digestResponse({ copy: [sentence, secondLine, FULL_REPORT_CLOSE] }))

    renderCard()

    await waitFor(() => expect(screen.getByTestId('digest-card')).toBeTruthy())

    // Headline metric figure shows the recorded visits count.
    const visits = screen.getByTestId('digest-metric-visits')
    expect(visits.textContent).toContain('23')

    // The API copy sentences are rendered verbatim (one source of truth).
    expect(screen.getByText(sentence)).toBeTruthy()
    expect(screen.getByText(secondLine)).toBeTruthy()
  })
})

describe('DigestCard - deltas present (R4.1)', () => {
  it('renders signed week-over-week chips derived from the deltas field', async () => {
    mocks.apiGet.mockResolvedValue(
      digestResponse({
        deltas: { visits: 5, uniqueVisitors: -2 },
        copy: ['23 visits recorded through Area Code this week, up 5 from the previous week.', FULL_REPORT_CLOSE],
      }),
    )

    renderCard()

    await waitFor(() => expect(screen.getByTestId('digest-card')).toBeTruthy())

    // Positive delta chip on the visits figure.
    expect(screen.getByTestId('digest-metric-visits').textContent).toContain('+5')
    // Negative delta chip on the unique-visitors figure.
    expect(screen.getByTestId('digest-metric-unique').textContent).toContain('-2')
  })
})

describe('DigestCard - quiet week (R4.1)', () => {
  it('shows an honest zero headline and the quiet-week copy, no fabricated numbers', async () => {
    const quietSentence =
      'No visits were recorded through Area Code this week. Ask your staff to mention Area Code at the till.'
    mocks.apiGet.mockResolvedValue(
      digestResponse({
        metrics: {
          visits: 0,
          uniqueVisitors: 0,
          firstTimeVisitors: 0,
          returningVisitors: 0,
          redemptions: 0,
          firstGetIssued: 0,
          firstGetConversions: 0,
          busiestDay: null,
          busiestHour: null,
        },
        copy: [quietSentence, STARTER_UPGRADE_CLOSE],
        tierAtBuild: 'starter',
      }),
    )

    renderCard()

    await waitFor(() => expect(screen.getByTestId('digest-card')).toBeTruthy())

    // Honest quiet-week affordance is shown.
    expect(screen.getByTestId('digest-quiet-week')).toBeTruthy()
    // Zero visits render as an honest 0, not hidden or padded.
    expect(screen.getByTestId('digest-metric-visits').textContent).toContain('0')
    // The quiet-week copy comes from the API, rendered verbatim.
    expect(screen.getByText(quietSentence)).toBeTruthy()
  })
})

describe('DigestCard - tier close (R4.1)', () => {
  it('renders the starter upgrade close from the API copy on a starter digest', async () => {
    mocks.apiGet.mockResolvedValue(
      digestResponse({
        tierAtBuild: 'starter',
        copy: ['23 visits recorded through Area Code this week.', STARTER_UPGRADE_CLOSE],
      }),
    )

    renderCard()

    await waitFor(() => expect(screen.getByTestId('digest-card')).toBeTruthy())

    const close = screen.getByTestId('digest-close')
    expect(close.textContent).toBe(STARTER_UPGRADE_CLOSE)
  })

  it('renders the full-report close from the API copy on a paid digest', async () => {
    mocks.apiGet.mockResolvedValue(
      digestResponse({
        tierAtBuild: 'growth',
        copy: ['23 visits recorded through Area Code this week.', FULL_REPORT_CLOSE],
      }),
    )

    renderCard()

    await waitFor(() => expect(screen.getByTestId('digest-card')).toBeTruthy())

    const close = screen.getByTestId('digest-close')
    expect(close.textContent).toBe(FULL_REPORT_CLOSE)
  })
})

describe('DigestCard - empty state (R4.1)', () => {
  it('shows an honest "no digest yet" message when the digest is null (not an error)', async () => {
    mocks.apiGet.mockResolvedValue({ digest: null })

    renderCard()

    await waitFor(() => expect(screen.getByTestId('digest-card-empty')).toBeTruthy())
    expect(screen.queryByTestId('digest-card-error')).toBeNull()
    expect(screen.getByText('No digest yet')).toBeTruthy()
  })
})
