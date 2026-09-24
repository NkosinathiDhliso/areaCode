// @vitest-environment jsdom
/**
 * The Boost_Scoreboard per purchase (proof-of-demand R7.1, R7.4, R7.5).
 *
 * **Validates: Requirements 7.1, 7.4, 7.5**
 *
 * Three things matter here, and they are the three the requirement names:
 *
 *   1. Counts always render, for both windows, zeros included.
 *   2. The comparison renders only when the server says the two samples support
 *      it. Below the Suppression_Floor the card says why instead of implying a
 *      trend.
 *   3. A window that recorded nothing is an honest zero state: no failure
 *      wording, no claim, and never a causal verb anywhere on the card.
 */
import type { BoostScoreboardView } from '@area-code/shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => {
  const t = (key: string, fallback?: string) => fallback ?? key
  return { useTranslation: () => ({ t }) }
})

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }))
vi.mock('@area-code/shared/lib/api', () => ({ api: { get: mocks.apiGet } }))

import { BoostScoreboardCard } from '../BoostScoreboardCard'

// ─── Fixtures ──────────────────────────────────────────────────────────────

const BOOST_ID = 'chk_boost_1'

function scoreboard(overrides: Partial<BoostScoreboardView> = {}): BoostScoreboardView {
  return {
    boostId: BOOST_ID,
    nodeId: 'node-a',
    windowClosed: true,
    window: {
      windowStartUtc: '2026-03-06T18:00:00.000Z',
      windowEndUtc: '2026-03-06T20:00:00.000Z',
      checkIns: 11,
      visitors: 9,
      foundYou: 6,
      walkIns: 3,
    },
    baseline: {
      windowStartUtc: '2026-02-27T18:00:00.000Z',
      windowEndUtc: '2026-02-27T20:00:00.000Z',
      checkIns: 7,
      visitors: 7,
      foundYou: 2,
      walkIns: 5,
    },
    comparable: true,
    delta: { checkIns: 4, visitors: 2, foundYou: 4, walkIns: -2 },
    ...overrides,
  }
}

function renderCard(): HTMLElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { container } = render(<BoostScoreboardCard boostId={BOOST_ID} />, { wrapper })
  return container
}

beforeEach(() => {
  mocks.apiGet.mockReset()
})

afterEach(() => {
  cleanup()
})

// ─── Counts ────────────────────────────────────────────────────────────────

describe('BoostScoreboardCard — counts always render (R7.1, R7.4)', () => {
  it('reads the scoreboard for the purchase it was given', async () => {
    mocks.apiGet.mockResolvedValue(scoreboard())

    renderCard()

    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith(`/v1/business/boosts/${BOOST_ID}/scoreboard`))
  })

  it('reports both windows, with Found_You as the highlighted line', async () => {
    mocks.apiGet.mockResolvedValue(scoreboard())

    renderCard()

    await waitFor(() => expect(screen.getByTestId(`boost-scoreboard-${BOOST_ID}`)).toBeTruthy())

    expect(screen.getByTestId(`boost-scoreboard-foundyou-${BOOST_ID}`).textContent).toContain('6 found you')
    const window = screen.getByTestId(`boost-scoreboard-window-${BOOST_ID}`).textContent ?? ''
    expect(window).toContain('11 check-ins from 9 people')
    expect(window).toContain('6 found you')
    expect(window).toContain('3 already in the room')
    const baseline = screen.getByTestId(`boost-scoreboard-baseline-${BOOST_ID}`).textContent ?? ''
    expect(baseline).toContain('Same hours last week')
    expect(baseline).toContain('7 check-ins from 7 people')
    expect(baseline).toContain('2 found you')
    expect(baseline).toContain('5 already in the room')
  })

  it('renders zeros as counts, for both windows', async () => {
    mocks.apiGet.mockResolvedValue(
      scoreboard({
        window: { ...scoreboard().window, checkIns: 0, visitors: 0, foundYou: 0, walkIns: 0 },
        baseline: { ...scoreboard().baseline, checkIns: 0, visitors: 0, foundYou: 0, walkIns: 0 },
        comparable: false,
        delta: null,
      }),
    )

    renderCard()

    await waitFor(() => expect(screen.getByTestId(`boost-scoreboard-${BOOST_ID}`)).toBeTruthy())
    expect(screen.getByTestId(`boost-scoreboard-window-${BOOST_ID}`).textContent).toContain('0 check-ins from 0 people')
    expect(screen.getByTestId(`boost-scoreboard-baseline-${BOOST_ID}`).textContent).toContain(
      '0 check-ins from 0 people',
    )
  })

  it('says a window is still open rather than presenting it as settled', async () => {
    mocks.apiGet.mockResolvedValue(scoreboard({ windowClosed: false }))

    renderCard()

    await waitFor(() => expect(screen.getByTestId(`boost-scoreboard-open-${BOOST_ID}`)).toBeTruthy())
  })
})

// ─── The comparison ────────────────────────────────────────────────────────

describe('BoostScoreboardCard — the comparison is conditional (R7.3, R7.5)', () => {
  it('shows the signed difference when the samples support it', async () => {
    mocks.apiGet.mockResolvedValue(scoreboard())

    renderCard()

    await waitFor(() => expect(screen.getByTestId(`boost-scoreboard-delta-${BOOST_ID}`)).toBeTruthy())
    const delta = screen.getByTestId(`boost-scoreboard-delta-${BOOST_ID}`).textContent ?? ''
    expect(delta).toContain('+4 found you')
    expect(delta).toContain('+4 check-ins')
    expect(screen.queryByTestId(`boost-scoreboard-nocompare-${BOOST_ID}`)).toBeNull()
  })

  it('reports a quieter window than last week as a negative difference', async () => {
    mocks.apiGet.mockResolvedValue(scoreboard({ delta: { checkIns: -3, visitors: -2, foundYou: -1, walkIns: -1 } }))

    renderCard()

    await waitFor(() => expect(screen.getByTestId(`boost-scoreboard-delta-${BOOST_ID}`)).toBeTruthy())
    expect(screen.getByTestId(`boost-scoreboard-delta-${BOOST_ID}`).textContent).toContain('-1 found you')
  })

  it('renders no comparison when the server withheld it, and says why', async () => {
    mocks.apiGet.mockResolvedValue(scoreboard({ comparable: false, delta: null }))

    renderCard()

    await waitFor(() => expect(screen.getByTestId(`boost-scoreboard-nocompare-${BOOST_ID}`)).toBeTruthy())
    expect(screen.queryByTestId(`boost-scoreboard-delta-${BOOST_ID}`)).toBeNull()
    // The counts are not withheld with it.
    expect(screen.getByTestId(`boost-scoreboard-window-${BOOST_ID}`)).toBeTruthy()
    expect(screen.getByTestId(`boost-scoreboard-baseline-${BOOST_ID}`)).toBeTruthy()
  })

  it('renders no comparison even if a delta arrives alongside comparable false', async () => {
    mocks.apiGet.mockResolvedValue(
      scoreboard({ comparable: false, delta: { checkIns: 9, visitors: 9, foundYou: 9, walkIns: 0 } }),
    )

    renderCard()

    await waitFor(() => expect(screen.getByTestId(`boost-scoreboard-${BOOST_ID}`)).toBeTruthy())
    expect(screen.queryByTestId(`boost-scoreboard-delta-${BOOST_ID}`)).toBeNull()
  })
})

// ─── The zero state ────────────────────────────────────────────────────────

describe('BoostScoreboardCard — an empty window is neither a failure nor a claim (R7.5)', () => {
  const empty = scoreboard({
    window: { ...scoreboard().window, checkIns: 0, visitors: 0, foundYou: 0, walkIns: 0 },
    comparable: false,
    delta: null,
  })

  it('states what was recorded without a zero-headline claim', async () => {
    mocks.apiGet.mockResolvedValue(empty)

    const container = renderCard()

    await waitFor(() => expect(screen.getByTestId(`boost-scoreboard-zero-${BOOST_ID}`)).toBeTruthy())
    expect(screen.getByTestId(`boost-scoreboard-foundyou-${BOOST_ID}`).textContent).toBe(
      'No one found you on Area Code during this window.',
    )
    // Not an error, and not the loading state either.
    expect(screen.queryByTestId(`boost-scoreboard-error-${BOOST_ID}`)).toBeNull()
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/failed|error|sorry/i)
  })

  it('omits the zero line once the window recorded something', async () => {
    mocks.apiGet.mockResolvedValue(scoreboard())

    renderCard()

    await waitFor(() => expect(screen.getByTestId(`boost-scoreboard-${BOOST_ID}`)).toBeTruthy())
    expect(screen.queryByTestId(`boost-scoreboard-zero-${BOOST_ID}`)).toBeNull()
  })

  it('never describes the boost as having caused a visit, in any state', async () => {
    for (const body of [scoreboard(), empty, scoreboard({ windowClosed: false, comparable: false, delta: null })]) {
      mocks.apiGet.mockReset()
      mocks.apiGet.mockResolvedValue(body)

      const container = renderCard()
      await waitFor(() => expect(screen.getByTestId(`boost-scoreboard-${BOOST_ID}`)).toBeTruthy())

      expect(container.textContent ?? '').not.toMatch(/brought|drove|driven|generated|boosted|revenue|ticket|spend/i)
      cleanup()
    }
  })
})

// ─── Loading and failure ───────────────────────────────────────────────────

describe('BoostScoreboardCard — its own loading and error states (R7.4)', () => {
  it('shows a loading state while the read is in flight, and no numbers', async () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}))

    renderCard()

    await waitFor(() => expect(screen.getByTestId(`boost-scoreboard-loading-${BOOST_ID}`)).toBeTruthy())
    expect(screen.queryByTestId(`boost-scoreboard-${BOOST_ID}`)).toBeNull()
  })

  it('states that the window could not be read, with no raw error text', async () => {
    mocks.apiGet.mockRejectedValue(new Error('scoreboard read exploded'))

    const container = renderCard()

    await waitFor(() => expect(screen.getByTestId(`boost-scoreboard-error-${BOOST_ID}`)).toBeTruthy())
    expect(container.textContent ?? '').not.toContain('exploded')
    // No half-read numbers next to the failure.
    expect(screen.queryByTestId(`boost-scoreboard-window-${BOOST_ID}`)).toBeNull()
  })

  it('re-reads when its retry is pressed', async () => {
    mocks.apiGet.mockRejectedValue(new Error('down'))

    renderCard()

    await waitFor(() => expect(screen.getByTestId(`boost-scoreboard-retry-${BOOST_ID}`)).toBeTruthy())

    mocks.apiGet.mockReset()
    mocks.apiGet.mockResolvedValue(scoreboard())
    await act(async () => {
      screen.getByTestId(`boost-scoreboard-retry-${BOOST_ID}`).click()
    })

    await waitFor(() => expect(screen.getByTestId(`boost-scoreboard-${BOOST_ID}`)).toBeTruthy())
  })
})
