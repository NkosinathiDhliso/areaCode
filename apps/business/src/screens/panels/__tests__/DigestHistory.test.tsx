/**
 * DigestHistory component tests (weekly-attribution-digest R4.1).
 *
 * Validates: Requirements 4.1
 *
 * The dashboard renders a history view of prior weeks from Digest_Rows behind
 * the latest-week card. The list comes from GET /v1/business/digest/history,
 * which returns items newest first with opaque cursor pagination. The view
 * renders them in that reverse-chronological order, appends older pages on
 * demand (passing the returned cursor), and shows an honest empty state when
 * there are no prior digests.
 *
 * Covers:
 *   1. list    — renders a reverse-chronological list of prior digests.
 *   2. paging  — "Load more" passes the cursor and appends the next page.
 *   3. empty   — honest empty state when the history has no items.
 */
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => {
  const t = (_key: string, fallback?: string) => fallback ?? _key
  return { useTranslation: () => ({ t }) }
})

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }))
vi.mock('@area-code/shared/lib/api', () => ({
  api: { get: mocks.apiGet },
}))

// Import AFTER vi.mock so the component resolves the mocked api.
import { DigestHistory } from '../DigestHistory'

// ─── Fixtures (mirror the backend DigestView shape) ──────────────────────────

interface DigestMetricsShape {
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

function metrics(visits: number): DigestMetricsShape {
  return {
    visits,
    uniqueVisitors: visits,
    firstTimeVisitors: 0,
    returningVisitors: visits,
    redemptions: 0,
    firstGetIssued: 0,
    firstGetConversions: 0,
    busiestDay: null,
    busiestHour: null,
  }
}

function digest(weekStart: string, visits: number, copy: string[]) {
  return {
    weekStart,
    metrics: metrics(visits),
    deltas: null,
    suppressed: [],
    tierAtBuild: 'growth',
    copy,
    createdAt: `${weekStart}T20:00:00.000Z`,
  }
}

// ─── Harness ──────────────────────────────────────────────────────────────

function renderHistory(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  render(<DigestHistory />, { wrapper })
}

beforeEach(() => {
  mocks.apiGet.mockReset()
})

afterEach(() => {
  cleanup()
})

// ─── Tests ────────────────────────────────────────────────────────────────

describe('DigestHistory - list (R4.1)', () => {
  it('renders prior digests in the reverse-chronological order the API returns', async () => {
    // API returns newest first (2026-07-06 then 2026-06-29).
    mocks.apiGet.mockResolvedValue({
      items: [
        digest('2026-07-06', 23, ['23 visits recorded through Area Code this week.']),
        digest('2026-06-29', 15, ['15 visits recorded through Area Code this week.']),
      ],
      nextCursor: null,
    })

    renderHistory()

    // History is behind a disclosure toggle: expand it to load the list.
    fireEvent.click(screen.getByTestId('digest-history-toggle'))

    await waitFor(() => expect(screen.getAllByTestId('digest-history-row')).toHaveLength(2))

    const rows = screen.getAllByTestId('digest-history-row')
    // The first rendered row is the newest week (verbatim API copy).
    expect(rows[0]?.textContent).toContain('23 visits recorded through Area Code this week.')
    expect(rows[1]?.textContent).toContain('15 visits recorded through Area Code this week.')
  })
})

describe('DigestHistory - pagination (R4.1)', () => {
  it('passes the returned cursor on Load more and appends the next page', async () => {
    mocks.apiGet
      .mockResolvedValueOnce({
        items: [digest('2026-07-06', 23, ['week one'])],
        nextCursor: 'CURSOR_2',
      })
      .mockResolvedValueOnce({
        items: [digest('2026-06-29', 15, ['week two'])],
        nextCursor: null,
      })

    renderHistory()

    fireEvent.click(screen.getByTestId('digest-history-toggle'))

    // First page loads without a cursor query param.
    await waitFor(() => expect(screen.getAllByTestId('digest-history-row')).toHaveLength(1))
    expect(mocks.apiGet).toHaveBeenNthCalledWith(1, '/v1/business/digest/history')

    // Load more fetches the next page using the returned cursor.
    fireEvent.click(screen.getByTestId('digest-history-load-more'))

    await waitFor(() => expect(screen.getAllByTestId('digest-history-row')).toHaveLength(2))
    expect(mocks.apiGet).toHaveBeenNthCalledWith(2, '/v1/business/digest/history?cursor=CURSOR_2')

    // The next page is appended after the first (still reverse-chronological).
    const rows = screen.getAllByTestId('digest-history-row')
    expect(rows[0]?.textContent).toContain('week one')
    expect(rows[1]?.textContent).toContain('week two')

    // No further page: the Load more control is gone.
    expect(screen.queryByTestId('digest-history-load-more')).toBeNull()
  })
})

describe('DigestHistory - empty state (R4.1)', () => {
  it('shows an honest empty state when there are no prior digests', async () => {
    mocks.apiGet.mockResolvedValue({ items: [], nextCursor: null })

    renderHistory()

    fireEvent.click(screen.getByTestId('digest-history-toggle'))

    await waitFor(() => expect(screen.getByTestId('digest-history-empty')).toBeTruthy())
    expect(screen.queryByTestId('digest-history-row')).toBeNull()
    expect(screen.queryByTestId('digest-history-load-more')).toBeNull()
  })
})
