/**
 * LivePanel Receipt split and Going line (proof-of-demand R4.3, R9.5).
 *
 * Validates: Requirements 4.3, 9.5
 *
 * The live panel is the surface an owner watches during a shift, so it is the
 * one most likely to grow a second wording of the Found_You fact. These tests
 * lock the opposite: the two sentences come from the API verbatim, an arriving
 * `business:checkin` shows its source as a badge and re-reads the split from the
 * server rather than doing client arithmetic, and a walk-in is never badged.
 */
// @vitest-environment jsdom
import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import type { LiveStats } from '@area-code/shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
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
import { LivePanel } from '../LivePanel'

// ─── Fixtures ────────────────────────────────────────────────────────────────

// The exact sentences the backend copy builder produces for the `today` window.
const FOUND_YOU_LINE = '4 people found you on Area Code and checked in today.'
const WALK_IN_LINE = '2 people who were already in the room also checked in.'
const FOUND_YOU_LINE_AFTER = '5 people found you on Area Code and checked in today.'

function liveStats(overrides: Partial<LiveStats> = {}): LiveStats {
  return {
    checkInsToday: 8,
    totalCheckIns: 120,
    rewardsClaimed: 3,
    pulseScore: 41,
    foundYouToday: 4,
    walkInsToday: 2,
    receiptToday: { headline: FOUND_YOU_LINE, walkIn: WALK_IN_LINE },
    // Default: no venue has been counted, so the panel has nothing to seed.
    goingTonight: [],
    ...overrides,
  }
}

function renderPanel(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  render(<LivePanel />, { wrapper })
}

function emitCheckin(payload: Record<string, unknown>): void {
  act(() => {
    mocks.handlers.get('business:checkin')?.forEach((fn) => fn(payload))
  })
}

function emitGoing(payload: Record<string, unknown>): void {
  act(() => {
    mocks.handlers.get('business:going')?.forEach((fn) => fn(payload))
  })
}

function checkinPayload(foundVia: string): Record<string, unknown> {
  return {
    nodeId: 'node-1',
    nodeName: 'The Lookout',
    checkInCount: 9,
    username: 'Thabo',
    timestamp: new Date().toISOString(),
    foundVia,
  }
}

beforeEach(() => {
  mocks.apiGet.mockReset()
  mocks.handlers.clear()
  // Real store, driven through setState and reset per test.
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

describe('LivePanel Receipt (R4.3)', () => {
  it('renders both API sentences verbatim, headline on Found_You', async () => {
    mocks.apiGet.mockResolvedValue(liveStats())

    renderPanel()

    await waitFor(() => expect(screen.getByTestId('live-receipt')).toBeTruthy())
    expect(screen.getByTestId('live-receipt-headline').textContent).toBe(FOUND_YOU_LINE)
    expect(screen.getByTestId('live-receipt-walkin').textContent).toBe(WALK_IN_LINE)
  })

  it('shows the honest zero headline when no one has found the venue today', async () => {
    const zeroHeadline = 'No one has found you on Area Code and checked in today yet.'
    mocks.apiGet.mockResolvedValue(
      liveStats({
        foundYouToday: 0,
        receiptToday: { headline: zeroHeadline, walkIn: WALK_IN_LINE },
      }),
    )

    renderPanel()

    await waitFor(() => expect(screen.getByTestId('live-receipt-headline').textContent).toBe(zeroHeadline))
  })
})

describe('LivePanel business:checkin (R4.3)', () => {
  it('badges the arriving check-in with its source and re-reads the split from the server', async () => {
    mocks.apiGet.mockResolvedValueOnce(liveStats()).mockResolvedValue(
      liveStats({
        foundYouToday: 5,
        receiptToday: { headline: FOUND_YOU_LINE_AFTER, walkIn: WALK_IN_LINE },
      }),
    )

    renderPanel()
    await waitFor(() => expect(screen.getByTestId('live-receipt-headline').textContent).toBe(FOUND_YOU_LINE))

    emitCheckin(checkinPayload('share'))

    // The badge names the source the server resolved for this check-in.
    await waitFor(() => expect(screen.getByTestId('found-via-badge-share')).toBeTruthy())
    expect(screen.getByTestId('found-via-badge-share').textContent).toBe('Found you from a shared link')

    // The sentence is re-read, never re-worded in the client.
    await waitFor(() => expect(screen.getByTestId('live-receipt-headline').textContent).toBe(FOUND_YOU_LINE_AFTER))
  })

  it('does not badge a walk-in', async () => {
    mocks.apiGet.mockResolvedValue(liveStats())

    renderPanel()
    await waitFor(() => expect(screen.getByTestId('live-receipt')).toBeTruthy())

    emitCheckin(checkinPayload('walk_in'))

    await waitFor(() => expect(mocks.apiGet.mock.calls.length).toBeGreaterThan(1))
    expect(screen.queryByTestId('found-via-badge-walk_in')).toBeNull()
    expect(screen.queryByText(/Found you from/)).toBeNull()
  })
})

/**
 * Going on the owner's panel (R9.5). The owner sees the TRUE count, including
 * zero: this is the pipeline before doors, and a drop matters as much as a rise.
 * It is intent, never presence, so it renders as its own line outside the
 * aliveness readouts and never touches the check-in number
 * (`honest-presence.md`, R9.4).
 */
describe('LivePanel business:going (R9.5)', () => {
  function goingPayload(goingCount: number): Record<string, unknown> {
    return { nodeId: 'node-1', nodeName: 'The Lookout', date: '2026-03-06', goingCount }
  }

  it('shows the count the server reported, per venue', async () => {
    mocks.apiGet.mockResolvedValue(liveStats())
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('live-receipt')).toBeTruthy())

    emitGoing(goingPayload(5))

    await waitFor(() => expect(screen.getByTestId('live-going-node-1').textContent).toBe('5 marked going tonight'))
    expect(screen.getByText('The Lookout')).toBeTruthy()
  })

  it('shows zero honestly once the last mark is withdrawn', async () => {
    mocks.apiGet.mockResolvedValue(liveStats())
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('live-receipt')).toBeTruthy())

    emitGoing(goingPayload(1))
    await waitFor(() => expect(screen.getByTestId('live-going-node-1').textContent).toBe('1 marked going tonight'))

    emitGoing(goingPayload(0))

    await waitFor(() => expect(screen.getByTestId('live-going-node-1').textContent).toBe('0 marked going tonight'))
  })

  it('renders no Going line before the server has reported a count', async () => {
    mocks.apiGet.mockResolvedValue(liveStats())
    renderPanel()

    await waitFor(() => expect(screen.getByTestId('live-receipt')).toBeTruthy())
    // A venue nobody counted gets no line, not a zero nobody measured.
    expect(screen.queryByTestId('live-going')).toBeNull()
  })

  it('keeps intent out of the check-in and receipt numbers', async () => {
    mocks.apiGet.mockResolvedValue(liveStats())
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('live-receipt')).toBeTruthy())

    emitGoing(goingPayload(9))

    await waitFor(() => expect(screen.getByTestId('live-going-node-1')).toBeTruthy())
    // The check-in headline and both Receipt sentences are untouched.
    expect(screen.getByText('8')).toBeTruthy()
    expect(screen.getByTestId('live-receipt-headline').textContent).toBe(FOUND_YOU_LINE)
    expect(screen.getByTestId('live-receipt-walkin').textContent).toBe(WALK_IN_LINE)
    // And the going line is never worded as presence.
    expect(screen.getByTestId('live-going-node-1').textContent).not.toMatch(/here|in the room/i)
  })
})

/**
 * The Going seed (R9.5, task 10.4 gap).
 *
 * An owner who opens the panel at 20:00 with marks already recorded must see
 * them. Before the seed the line appeared only after the next toggle, which read
 * as an empty pipeline rather than as the pipeline they had.
 *
 * The socket stays the fresher fact: `business:going` carries the count the
 * server computed at the moment of the toggle, so a later 30-second poll must
 * never overwrite it with an older number.
 */
describe('LivePanel Going seed from live-stats (R9.5)', () => {
  it('shows the marks already recorded, without waiting for a toggle', async () => {
    mocks.apiGet.mockResolvedValue(
      liveStats({ goingTonight: [{ nodeId: 'node-1', nodeName: 'The Lookout', goingCount: 5 }] }),
    )

    renderPanel()

    await waitFor(() => expect(screen.getByTestId('live-going-node-1').textContent).toBe('5 marked going tonight'))
    expect(screen.getByText('The Lookout')).toBeTruthy()
  })

  it('seeds a measured zero, because the owner is entitled to the true number', async () => {
    mocks.apiGet.mockResolvedValue(
      liveStats({ goingTonight: [{ nodeId: 'node-1', nodeName: 'The Lookout', goingCount: 0 }] }),
    )

    renderPanel()

    await waitFor(() => expect(screen.getByTestId('live-going-node-1').textContent).toBe('0 marked going tonight'))
  })

  it('omits a venue the server could not count, rather than showing it as zero', async () => {
    // Two venues, one counted: the uncounted one is absent from the payload and
    // must stay absent from the panel (`honest-presence.md`).
    mocks.apiGet.mockResolvedValue(
      liveStats({ goingTonight: [{ nodeId: 'node-1', nodeName: 'The Lookout', goingCount: 3 }] }),
    )

    renderPanel()

    await waitFor(() => expect(screen.getByTestId('live-going-node-1')).toBeTruthy())
    expect(screen.queryByTestId('live-going-node-2')).toBeNull()
  })

  it('applies a socket update verbatim on top of the seed', async () => {
    mocks.apiGet.mockResolvedValue(
      liveStats({ goingTonight: [{ nodeId: 'node-1', nodeName: 'The Lookout', goingCount: 5 }] }),
    )
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('live-going-node-1').textContent).toBe('5 marked going tonight'))

    act(() => {
      mocks.handlers
        .get('business:going')
        ?.forEach((fn) => fn({ nodeId: 'node-1', nodeName: 'The Lookout', date: '2026-03-06', goingCount: 6 }))
    })

    await waitFor(() => expect(screen.getByTestId('live-going-node-1').textContent).toBe('6 marked going tonight'))
  })

  it('does not let a later poll roll a socket count back', async () => {
    // Poll says 5; the toggle that follows says 6. A fresh poll response (a new
    // object, so the seed effect really re-runs) must leave the socket number.
    mocks.apiGet.mockImplementation(async () =>
      liveStats({ goingTonight: [{ nodeId: 'node-1', nodeName: 'The Lookout', goingCount: 5 }] }),
    )
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('live-going-node-1').textContent).toBe('5 marked going tonight'))

    act(() => {
      mocks.handlers
        .get('business:going')
        ?.forEach((fn) => fn({ nodeId: 'node-1', nodeName: 'The Lookout', date: '2026-03-06', goingCount: 6 }))
    })
    await waitFor(() => expect(screen.getByTestId('live-going-node-1').textContent).toBe('6 marked going tonight'))

    // An arriving check-in triggers a refetch, which resolves the same seed.
    emitCheckin(checkinPayload('map'))

    await waitFor(() => expect(screen.getByTestId('live-going-node-1').textContent).toBe('6 marked going tonight'))
  })
})

/**
 * The two counters (R15.10, task 15.1).
 *
 * `rewardsClaimed` comes from the poll, which counts the day's redemption rows
 * on the server. Before this the panel counted socket events from zero, so a
 * reload lost the day. `checkInsToday` bumps on `business:checkin` so an owner
 * watching the door sees the number move, and both drop their bumps the moment a
 * fresher server value lands, so the client never holds arithmetic the server
 * would disagree with.
 */
describe('LivePanel counters (R15.10)', () => {
  it('shows the rewards claimed today from the poll, with no socket event yet', async () => {
    mocks.apiGet.mockResolvedValue(liveStats({ rewardsClaimed: 6 }))

    renderPanel()

    await waitFor(() => expect(screen.getByTestId('live-rewards-claimed').textContent).toBe('6'))
  })

  it('renders no rewards line when the server counted none', async () => {
    mocks.apiGet.mockResolvedValue(liveStats({ rewardsClaimed: 0 }))

    renderPanel()
    await waitFor(() => expect(screen.getByTestId('live-receipt')).toBeTruthy())

    expect(screen.queryByTestId('live-rewards-claimed')).toBeNull()
  })

  it('bumps the claim count on business:reward_claimed, on top of the server value', async () => {
    mocks.apiGet.mockResolvedValue(liveStats({ rewardsClaimed: 6 }))
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('live-rewards-claimed').textContent).toBe('6'))

    act(() => {
      mocks.handlers.get('business:reward_claimed')?.forEach((fn) => fn({}))
    })

    // 7 immediately: the server value plus this claim, never a count from zero.
    await waitFor(() => expect(screen.getByTestId('live-rewards-claimed').textContent).toBe('7'))
  })

  it('bumps checkInsToday on business:checkin and settles on the re-read value', async () => {
    mocks.apiGet.mockResolvedValueOnce(liveStats()).mockResolvedValue(liveStats({ checkInsToday: 9 }))
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('live-checkins-today').textContent).toBe('8'))

    emitCheckin(checkinPayload('map'))

    // The refetch the arrival triggers answers 9, which is also 8 + this arrival:
    // the bump is dropped and the server's number stands.
    await waitFor(() => expect(screen.getByTestId('live-checkins-today').textContent).toBe('9'))
  })

  it('re-seeds from the poll on reconnect rather than counting on top of a stale number', async () => {
    // A backgrounded tab missed events; the server has moved on to 20 and 11.
    mocks.apiGet
      .mockResolvedValueOnce(liveStats())
      .mockResolvedValue(liveStats({ checkInsToday: 20, rewardsClaimed: 11 }))
    renderPanel()
    await waitFor(() => expect(screen.getByTestId('live-checkins-today').textContent).toBe('8'))

    act(() => {
      mocks.handlers.get('connect')?.forEach((fn) => fn(undefined))
    })

    await waitFor(() => expect(screen.getByTestId('live-checkins-today').textContent).toBe('20'))
    expect(screen.getByTestId('live-rewards-claimed').textContent).toBe('11')
  })
})
