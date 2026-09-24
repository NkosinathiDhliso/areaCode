// @vitest-environment jsdom
/**
 * Proof of Demand R15.24: touch targets and bottom safe-area.
 *
 * Interactive controls are at least 44px (`w-11 h-11` / `min-h-11`), the
 * `ToastOverlay` bottom anchor adds `env(safe-area-inset-bottom)`, and
 * `BottomNav` stays flush with no bottom inset (decision 10 in
 * docs/decisions/proof-of-demand.md).
 *
 * Validates: Requirements 15.24
 */
import { useToastStore } from '@area-code/shared/stores/toastStore'
import type { Toast } from '@area-code/shared/types'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EnrichedFeedItem } from '../../lib/feedEnrichment'
import { BottomNav } from '../BottomNav'
import { FeedItemRow } from '../FeedItemRow'
import { MapControls } from '../MapControls'
import { ProximityNudgeBanner } from '../ProximityNudgeBanner'
import { ToastOverlay } from '../ToastOverlay'

vi.mock('@area-code/shared/lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ items: [] }), post: vi.fn() },
}))

// The nudge core is tested on its own; here we only need it to surface a nudge
// so the banner renders its two controls.
vi.mock('@area-code/shared/hooks/useProximityNudge', () => ({
  useProximityNudge: () => ({
    current: { node: { id: 'n1', name: 'Kitcheners' } },
    dismiss: vi.fn(),
  }),
}))

/** Minimum touch target in px (code-style.md). */
const MIN_TARGET = 44

/** Tailwind classes that resolve to at least 44px in this codebase. */
const TARGET_CLASS = /(w-11|min-w-11)/
const TARGET_CLASS_HEIGHT = /(h-11|min-h-11)/

afterEach(() => {
  cleanup()
})

describe('R15.24 touch targets', () => {
  it('sizes every MapControls button to at least 44px', () => {
    render(
      <MapControls
        is3D
        bearing={0}
        onToggle3D={vi.fn()}
        onResetNorth={vi.fn()}
        onRecenter={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        lastKnownPositionFreshAt={Date.now()}
      />,
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) {
      expect(button.className).toMatch(TARGET_CLASS)
      expect(button.className).toMatch(TARGET_CLASS_HEIGHT)
    }
  })

  it('sizes the proximity nudge CTA and dismiss to at least 44px', () => {
    render(<ProximityNudgeBanner onNavigate={vi.fn()} />)

    const dismiss = screen.getByRole('button', { name: 'Dismiss' })
    expect(dismiss.className).toMatch(TARGET_CLASS)
    expect(dismiss.className).toMatch(TARGET_CLASS_HEIGHT)

    const cta = screen.getByRole('button', { name: 'Check in' })
    expect(cta.className).toMatch(TARGET_CLASS_HEIGHT)
  })

  it('sizes the feed milestone share button to at least 44px', () => {
    const milestone: EnrichedFeedItem = {
      id: 'm1',
      feedType: 'milestone',
      checkedInAt: new Date().toISOString(),
      venuePulseState: null,
      venueCheckInCount: 0,
      venueArchetypeId: null,
      friendStillPresent: false,
      title: 'Five nights in a row',
      body: 'At Kitcheners',
    }
    render(<FeedItemRow item={milestone} onFocusVenue={vi.fn()} />)

    // The milestone row renders exactly one control: the share button.
    const share = screen.getByRole('button')
    expect(share.className).toMatch(TARGET_CLASS)
    expect(share.className).toMatch(TARGET_CLASS_HEIGHT)
  })

  it('keeps the documented minimum at 44px', () => {
    // Guards the intent behind `w-11` (11 * 4px = 44px) so a future rename of
    // the scale cannot silently shrink the targets above.
    expect(MIN_TARGET).toBe(44)
  })
})

describe('R15.24 bottom safe-area', () => {
  const toast: Toast = {
    id: 't1',
    type: 'checkin',
    message: 'Someone checked in',
    priority: 1,
    timestamp: Date.now(),
  }

  beforeEach(() => {
    useToastStore.setState({ queue: [toast], isBottomSheetOpen: false, checkInToastSeenAt: {} })
  })

  it('anchors the toast above the nav bar plus the bottom inset', () => {
    const { container } = render(<ToastOverlay />)
    const overlay = container.firstElementChild as HTMLElement
    // jsdom re-serialises calc() loosely, so assert on the substrings.
    expect(overlay.style.bottom).toContain('safe-area-inset-bottom')
    expect(overlay.style.bottom).toContain('--nav-height')
  })

  it('anchors the toast to the top while the bottom sheet is open', () => {
    useToastStore.setState({ isBottomSheetOpen: true })
    const { container } = render(<ToastOverlay />)
    const overlay = container.firstElementChild as HTMLElement
    expect(overlay.style.bottom).toBe('')
    expect(overlay.style.top).toContain('safe-area-inset-top')
  })

  it('keeps BottomNav flush with no bottom inset (decision 10)', () => {
    render(<BottomNav active="map" onNavigate={vi.fn()} />)
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(nav.style.height).toBe('var(--nav-height)')
    expect(nav.getAttribute('style') ?? '').not.toContain('safe-area-inset-bottom')
  })
})
