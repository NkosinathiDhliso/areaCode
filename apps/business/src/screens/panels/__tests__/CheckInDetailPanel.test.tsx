/**
 * Check-ins panel Found_You badge (proof-of-demand R4.4).
 *
 * Validates: Requirements 4.4
 *
 * Each row shows where the consumer found the venue, from the server-derived
 * `foundVia` on the row. A walk-in carries no badge: "already in the room" is
 * the absence of a source, and badging it would read as a claim the platform
 * never measured. Rows arriving live on `business:checkin_detail` are badged the
 * same way as rows loaded from history, so the two paths cannot disagree.
 */
// @vitest-environment jsdom
import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => {
  const t = (key: string, fallback?: string) => fallback ?? key
  return { useTranslation: () => ({ t }) }
})

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, Set<(payload: unknown) => void>>()
  const socket = {
    on(event: string, fn: (payload: unknown) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(fn)
      return socket
    },
    off(event: string, fn: (payload: unknown) => void) {
      handlers.get(event)?.delete(fn)
      return socket
    },
  }
  return { apiGet: vi.fn(), handlers, socket }
})

vi.mock('@area-code/shared/lib/api', () => ({ api: { get: mocks.apiGet } }))
vi.mock('@area-code/shared/lib/socket', () => ({ getSocket: () => mocks.socket }))
vi.mock('@area-code/shared/hooks/useSocketRoom', () => ({ useSocketRoom: () => undefined }))

// Import AFTER the mocks so the panel resolves them.
import { CheckInDetailPanel } from '../CheckInDetailPanel'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function entry(displayName: string, foundVia: string) {
  return {
    displayName,
    tier: 'local',
    visitCount: 1,
    timestamp: new Date().toISOString(),
    foundVia,
  }
}

beforeEach(() => {
  mocks.apiGet.mockReset()
  mocks.handlers.clear()
  useBusinessAuthStore.setState({
    accessToken: 'token-1',
    businessId: 'biz-1',
    isAuthenticated: true,
  })
})

afterEach(() => {
  cleanup()
  useBusinessAuthStore.setState({ accessToken: null, businessId: null, isAuthenticated: false })
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CheckInDetailPanel Found_You badge (R4.4)', () => {
  it('badges each row with the source the server recorded', async () => {
    mocks.apiGet.mockResolvedValue({
      items: [entry('Naledi K.', 'map'), entry('Sipho D.', 'share'), entry('Lerato P.', 'push')],
      nextCursor: null,
    })

    render(<CheckInDetailPanel />)

    await waitFor(() => expect(screen.getByTestId('found-via-badge-map')).toBeTruthy())
    expect(screen.getByTestId('found-via-badge-map').textContent).toBe('Found you from the map')
    expect(screen.getByTestId('found-via-badge-share').textContent).toBe('Found you from a shared link')
    expect(screen.getByTestId('found-via-badge-push').textContent).toBe('Found you from a notification')
  })

  it('shows no badge on a walk-in row, while still showing the row', async () => {
    mocks.apiGet.mockResolvedValue({ items: [entry('Thabo M.', 'walk_in')], nextCursor: null })

    render(<CheckInDetailPanel />)

    await waitFor(() => expect(screen.getByText('Thabo M.')).toBeTruthy())
    expect(screen.queryByText(/Found you from/)).toBeNull()
  })

  it('badges a row that arrives live on the socket', async () => {
    mocks.apiGet.mockResolvedValue({ items: [], nextCursor: null })

    render(<CheckInDetailPanel />)
    await waitFor(() => expect(screen.getByText('No check-ins for this date')).toBeTruthy())

    act(() => {
      mocks.handlers.get('business:checkin_detail')?.forEach((fn) => fn(entry('Zanele N.', 'search')))
    })

    await waitFor(() => expect(screen.getByTestId('found-via-badge-search').textContent).toBe('Found you from search'))
  })
})

/**
 * "Today" is the SAST date (R15.12, task 15.3).
 *
 * The check-in detail partition is keyed by the SAST calendar date (R15.8). At
 * 23:30 UTC the UTC date is already tomorrow, so the panel used to ask for a
 * partition that does not exist yet and an owner closing up at 01:30 SAST saw an
 * empty night.
 */
describe('CheckInDetailPanel today (R15.12)', () => {
  const AFTER_UTC_MIDNIGHT_BEFORE_SAST = new Date('2026-03-06T23:30:00.000Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(AFTER_UTC_MIDNIGHT_BEFORE_SAST)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('requests the SAST date, not the UTC date', async () => {
    mocks.apiGet.mockResolvedValue({ items: [], nextCursor: null })

    render(<CheckInDetailPanel />)

    await vi.waitFor(() => expect(mocks.apiGet).toHaveBeenCalled())
    const url = mocks.apiGet.mock.calls[0]?.[0] as string
    // 23:30 UTC on the 6th is 01:30 SAST on the 7th.
    expect(url).toContain('date=2026-03-07')
    expect(url).not.toContain('date=2026-03-06')
  })

  it('appends a live row while the SAST day it was stamped with is on screen', async () => {
    mocks.apiGet.mockResolvedValue({ items: [], nextCursor: null })

    render(<CheckInDetailPanel />)
    await vi.waitFor(() => expect(mocks.apiGet).toHaveBeenCalled())

    act(() => {
      mocks.handlers.get('business:checkin_detail')?.forEach((fn) => fn(entry('Naledi K.', 'map')))
    })

    await vi.waitFor(() => expect(screen.getByText('Naledi K.')).toBeTruthy())
  })
})
