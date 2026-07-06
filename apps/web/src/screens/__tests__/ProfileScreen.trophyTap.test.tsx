// @vitest-environment jsdom
/**
 * Component tests for the Trophy_Tap trigger wired into `ProfileScreen`
 * (rank-prestige task 10.5).
 *
 * Covers the rank-card tap-burst behaviour (design D5, Requirements 4.2, 4.5,
 * 8.2):
 *  - three fast pointerdowns (each within TROPHY_TAP_GAP_MS) open the overlay
 *    and fire the short haptic tick exactly once,
 *  - two fast pointerdowns do nothing (below TROPHY_TAP_COUNT),
 *  - three slow pointerdowns (each gap > TROPHY_TAP_GAP_MS) never fire: a slow
 *    tap restarts the count,
 *  - a tap while the overlay is open is ignored (the detector never re-arms),
 *    the overlay's own click dismisses, and a later single tap does not reopen.
 *
 * The real pure detector (`createRapidTapDetector`) drives the timing off
 * `Date.now`, which fake timers control, so gap boundaries are deterministic.
 * `haptic` and `useUnclaimedRewards` are mocked with `vi.hoisted`; the api
 * client is stubbed to a never-resolving promise so the profile queries stay
 * pending and never overwrite the store-driven tier. `RankTrophyOverlay` is
 * light-stubbed to a testid that renders only while `playing` and calls
 * `onDone` on click, so assertions target ProfileScreen's wiring, not overlay
 * internals. The real Zustand stores are driven via setState and reset in
 * beforeEach. No network, no WebGL.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useUserStore } from '@area-code/shared/stores/userStore'
import { TROPHY_TAP_GAP_MS } from '@area-code/shared/lib/rapidTap'
import type { User } from '@area-code/shared/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Short haptic tick fired on a successful burst (Requirement 4.4). Hoisted so
// the mock factory can reference the mutable spy (tech.md: vi.hoisted mocks).
const hapticMock = vi.hoisted(() => vi.fn())
vi.mock('@area-code/shared/lib/haptics', () => ({ haptic: hapticMock }))

// The wallet hook hits the network in real life; stub it to an empty wallet so
// no RedemptionCodeCard renders and no request is made.
vi.mock('@area-code/shared/hooks', () => ({ useUnclaimedRewards: () => ({ rewards: [] }) }))

// No network: the three profile queries stay pending forever, so their
// success handlers (which call setUser and would overwrite the tier) never run.
vi.mock('@area-code/shared/lib/api', () => ({
  api: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(), delete: vi.fn() },
}))

// Light stub: the overlay is present only while `playing`, and its own click
// dismisses via onDone. This keeps the test focused on ProfileScreen's trigger
// wiring rather than the overlay's animation/dismissal internals (covered by
// RankTrophyOverlay.test.tsx).
vi.mock('../../components/RankTrophyOverlay', () => ({
  RankTrophyOverlay: ({ playing, onDone }: { tier: string; playing: boolean; onDone: () => void }) =>
    playing ? <div data-testid="trophy-overlay" onClick={onDone} /> : null,
}))

import { ProfileScreen } from '../ProfileScreen'

const USER: User = {
  id: 'user-1',
  username: 'nomvula',
  displayName: 'Nomvula',
  avatarUrl: null,
  tier: 'fixture',
  totalCheckIns: 12,
} as User

function renderProfile() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ProfileScreen onNavigate={vi.fn()} />
    </QueryClientProvider>,
  )
}

/** Fire one pointerdown on the rank card, then advance the clock by `gapMs`. */
function tapRankCard(gapMs: number) {
  fireEvent.pointerDown(screen.getByTestId('rank-card'))
  vi.advanceTimersByTime(gapMs)
}

// A gap comfortably inside the burst window, and one comfortably outside it.
const FAST_GAP = Math.floor(TROPHY_TAP_GAP_MS / 2)
const SLOW_GAP = TROPHY_TAP_GAP_MS + 100

beforeEach(() => {
  vi.useFakeTimers()
  hapticMock.mockReset()
  useConsumerAuthStore.setState({ isAuthenticated: true })
  useUserStore.setState({ user: USER, tier: 'fixture', totalCheckIns: 12, streakCount: 2 })
})

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('ProfileScreen Trophy_Tap trigger', () => {
  it('opens the overlay and fires the haptic once on three fast taps (R4.2)', () => {
    renderProfile()

    // No overlay before any tap.
    expect(screen.queryByTestId('trophy-overlay')).toBeNull()

    // Three consecutive taps, each within TROPHY_TAP_GAP_MS of the previous.
    tapRankCard(FAST_GAP)
    tapRankCard(FAST_GAP)
    tapRankCard(FAST_GAP)

    expect(screen.getByTestId('trophy-overlay')).toBeTruthy()
    expect(hapticMock).toHaveBeenCalledTimes(1)
    expect(hapticMock).toHaveBeenCalledWith(10)
  })

  it('does nothing on two fast taps (below the burst threshold) (R4.2)', () => {
    renderProfile()

    tapRankCard(FAST_GAP)
    tapRankCard(FAST_GAP)

    expect(screen.queryByTestId('trophy-overlay')).toBeNull()
    expect(hapticMock).not.toHaveBeenCalled()
  })

  it('does nothing on three slow taps: a slow tap restarts the count (R4.2)', () => {
    renderProfile()

    // Each gap exceeds TROPHY_TAP_GAP_MS, so the count never reaches three.
    tapRankCard(SLOW_GAP)
    tapRankCard(SLOW_GAP)
    tapRankCard(SLOW_GAP)

    expect(screen.queryByTestId('trophy-overlay')).toBeNull()
    expect(hapticMock).not.toHaveBeenCalled()
  })

  it('ignores taps while open, dismisses on overlay click, and does not re-trigger (R4.5, R8.2)', () => {
    renderProfile()

    // Open the overlay with a fast burst.
    tapRankCard(FAST_GAP)
    tapRankCard(FAST_GAP)
    tapRankCard(FAST_GAP)
    expect(screen.getByTestId('trophy-overlay')).toBeTruthy()
    expect(hapticMock).toHaveBeenCalledTimes(1)

    // A tap while open is ignored: the detector never re-arms, so no extra
    // haptic and the overlay is unaffected.
    tapRankCard(FAST_GAP)
    expect(screen.getByTestId('trophy-overlay')).toBeTruthy()
    expect(hapticMock).toHaveBeenCalledTimes(1)

    // The overlay's own click dismisses it (onDone).
    fireEvent.click(screen.getByTestId('trophy-overlay'))
    expect(screen.queryByTestId('trophy-overlay')).toBeNull()

    // A single tap after dismissal must not reopen it (no re-trigger).
    tapRankCard(FAST_GAP)
    expect(screen.queryByTestId('trophy-overlay')).toBeNull()
    expect(hapticMock).toHaveBeenCalledTimes(1)
  })
})
