// @vitest-environment jsdom
/**
 * Component tests for `RankTrophyOverlay` (rank-prestige task 10.4).
 *
 * Covers the Trophy_Tap celebration behaviour (design D6/D7, Requirements 5.4,
 * 5.5, 5.6, 5.7, 5.8, 5.9):
 *  - renders nothing while `playing` is false (profile screen undisturbed),
 *  - renders the badge + rank label (getTierLabel) for every tier, aria-hidden,
 *  - dismisses (onDone exactly once) on click, Escape, the per-rank auto-dismiss
 *    timer, and never double-fires when the hard-cap timer also elapses,
 *  - reduced-motion renders the static variant (no effect/shimmer layers) and
 *    auto-dismisses at TROPHY_REDUCED_MOTION_DURATION_MS,
 *  - cleans up the keydown listener and timers on unmount.
 *
 * `reducedMotion` is mocked via `vi.hoisted` so both the full-motion and
 * reduced-motion branches can be driven from one mutable flag. Timers are faked
 * to exercise the auto-dismiss and hard-cap guards deterministically. No
 * network, no WebGL.
 */
import { getTierLabel } from '@area-code/shared/constants/tier-levels'
import type { Tier } from '@area-code/shared/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getTrophyDescriptor,
  TROPHY_MAX_DURATION_MS,
  TROPHY_REDUCED_MOTION_DURATION_MS,
} from '../../lib/trophyAnimations'
import { RankTrophyOverlay } from '../RankTrophyOverlay'

// Mutable mock state so a single mock factory can drive both the full-motion
// and reduced-motion paths (tech.md: mock shared hooks with vi.hoisted).
const motionMock = vi.hoisted(() => ({ reduced: false }))

vi.mock('../../lib/reducedMotion', () => ({
  reducedMotion: () => motionMock.reduced,
}))

const TIERS: readonly Tier[] = ['local', 'regular', 'fixture', 'institution', 'legend']

beforeEach(() => {
  motionMock.reduced = false
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('RankTrophyOverlay', () => {
  it('renders nothing and never fires onDone while not playing (R5.8)', () => {
    const onDone = vi.fn()
    const { container } = render(<RankTrophyOverlay tier="legend" playing={false} onDone={onDone} />)

    expect(container.querySelector('.trophy-overlay')).toBeNull()
    expect(container.firstChild).toBeNull()

    // No timers were armed, so time passing cannot trigger a dismissal.
    vi.advanceTimersByTime(TROPHY_MAX_DURATION_MS + 1000)
    expect(onDone).not.toHaveBeenCalled()
  })

  it.each(TIERS)('renders the rank label and an aria-hidden root for tier "%s" (R5.7, R5.9)', (tier) => {
    const { container } = render(<RankTrophyOverlay tier={tier} playing onDone={vi.fn()} />)

    // The human-facing rank label goes through the one getTierLabel bridge.
    expect(screen.getByText(getTierLabel(tier))).toBeTruthy()

    // The whole decorative layer is hidden from assistive tech (R5.7).
    const root = container.querySelector('.trophy-overlay')
    expect(root).toBeTruthy()
    expect(root?.getAttribute('aria-hidden')).toBe('true')
  })

  it('dismisses once when the overlay is clicked (R5.4)', () => {
    const onDone = vi.fn()
    const { container } = render(<RankTrophyOverlay tier="fixture" playing onDone={onDone} />)

    const root = container.querySelector('.trophy-overlay') as HTMLElement
    fireEvent.click(root)
    // A second click in the same play must not fire again (doneFiredRef guard).
    fireEvent.click(root)

    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('dismisses once on Escape keydown (R5.4)', () => {
    const onDone = vi.fn()
    render(<RankTrophyOverlay tier="regular" playing onDone={onDone} />)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('ignores non-Escape keys and only dismisses on Escape (R5.4)', () => {
    const onDone = vi.fn()
    render(<RankTrophyOverlay tier="local" playing onDone={onDone} />)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(onDone).not.toHaveBeenCalled()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('fires onDone via the per-rank auto-dismiss timer, exactly once through the hard cap (R5.4)', () => {
    const onDone = vi.fn()
    const { durationMs } = getTrophyDescriptor('institution')
    render(<RankTrophyOverlay tier="institution" playing onDone={onDone} />)

    // Just before the per-rank duration, nothing has fired yet.
    vi.advanceTimersByTime(durationMs - 1)
    expect(onDone).not.toHaveBeenCalled()

    // The per-rank auto-dismiss timer elapses.
    vi.advanceTimersByTime(1)
    expect(onDone).toHaveBeenCalledTimes(1)

    // The hard-cap timer (TROPHY_MAX_DURATION_MS) must not double-fire.
    vi.advanceTimersByTime(TROPHY_MAX_DURATION_MS)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  describe('reduced motion (static variant)', () => {
    beforeEach(() => {
      motionMock.reduced = true
    })

    it('renders the static badge/label and omits all effect and shimmer layers (R5.5)', () => {
      const { container } = render(<RankTrophyOverlay tier="legend" playing onDone={vi.fn()} />)

      // Static variants of the badge and label are present.
      expect(container.querySelector('.trophy-badge-static')).toBeTruthy()
      expect(container.querySelector('.trophy-label-static')).toBeTruthy()

      // No animated effect layers or shimmer sweep in the reduced-motion path,
      // even for Legend (the richest full-motion tier).
      expect(container.querySelector('.trophy-fx')).toBeNull()
      expect(container.querySelector('.trophy-shimmer')).toBeNull()
      expect(container.querySelector('.trophy-badge')).toBeNull()
      expect(container.querySelector('.trophy-label')).toBeNull()

      // The rank label still renders through getTierLabel.
      expect(screen.getByText(getTierLabel('legend'))).toBeTruthy()
    })

    it('auto-dismisses at TROPHY_REDUCED_MOTION_DURATION_MS regardless of tier (R5.5)', () => {
      const onDone = vi.fn()
      render(<RankTrophyOverlay tier="legend" playing onDone={onDone} />)

      // Legend's full-motion duration (3600ms) does not apply under reduced
      // motion; the flat fade uses the 2000ms reduced-motion duration.
      vi.advanceTimersByTime(TROPHY_REDUCED_MOTION_DURATION_MS - 1)
      expect(onDone).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(onDone).toHaveBeenCalledTimes(1)
    })
  })

  it('cleans up timers and the keydown listener on unmount (R5.8)', () => {
    const onDone = vi.fn()
    const { unmount } = render(<RankTrophyOverlay tier="institution" playing onDone={onDone} />)

    unmount()

    // Timers armed before unmount are cleared: advancing past the hard cap does
    // not fire onDone.
    vi.advanceTimersByTime(TROPHY_MAX_DURATION_MS + 1000)
    expect(onDone).not.toHaveBeenCalled()

    // The window keydown listener was removed on unmount.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onDone).not.toHaveBeenCalled()
  })

  it('tears down timers and listeners when playing goes false (R5.8)', () => {
    const onDone = vi.fn()
    const { rerender } = render(<RankTrophyOverlay tier="fixture" playing onDone={onDone} />)

    // Stop playing: the effect cleanup runs, clearing timers and the listener.
    rerender(<RankTrophyOverlay tier="fixture" playing={false} onDone={onDone} />)

    vi.advanceTimersByTime(TROPHY_MAX_DURATION_MS + 1000)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onDone).not.toHaveBeenCalled()
  })
})
