/**
 * Component tests for the `NodeDetailContent` check-out CTA visibility and
 * states (honest-presence-ui task 3.3).
 *
 * Property 1: the Check_Out_CTA is shown for a node if and only if
 * `presenceStore.isPresent(nodeId)` is true; otherwise the check-in CTA shows.
 *
 * The real `usePresenceStore` is driven via its own actions (set/clear a node
 * present) and reset in `beforeEach`. Child surfaces that hit the network
 * (CrowdVibeSection), the camera (QrScannerSheet), or draw glyphs
 * (ArchetypeGlyph) are stubbed so the test targets only the CTA wiring. No
 * network, no WebGL.
 *
 * react-i18next is not initialised in unit tests, so `t(key)` returns the key
 * verbatim; we assert on the i18n keys (matching CrowdVibeSection.test.tsx).
 * The no-emoji / no-em-dash check asserts against the real en.json copy.
 *
 * Validates: Requirements 1.1, 1.2, 1.4, 6.1
 */
// @vitest-environment jsdom
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useLocationStore } from '@area-code/shared/stores/locationStore'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import { usePresenceStore } from '@area-code/shared/stores/presenceStore'
import type { Node, NodeState, Reward } from '@area-code/shared/types'
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import en from '../../i18n/locales/en.json'
import { NodeDetailContent } from '../NodeDetailContent'

// Stub child surfaces that would hit the network / camera / canvas - none are
// under test here and the task forbids network and WebGL.
vi.mock('@area-code/shared/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../CrowdVibeSection', () => ({ CrowdVibeSection: () => <div data-crowd-vibe-stub /> }))
vi.mock('../QrScannerSheet', () => ({ QrScannerSheet: () => <div data-qr-stub /> }))
vi.mock('../DirectionsSheet', () => ({ DirectionsSheet: () => <div data-directions-stub /> }))
vi.mock('../ArchetypeGlyph', () => ({ ArchetypeGlyph: () => <div data-glyph-stub /> }))

const NODE_ID = 'node-1'

const NODE: Node = {
  id: NODE_ID,
  slug: 'test-venue',
  name: 'Test Venue',
  category: 'nightlife',
  lat: -26.2,
  lng: 28.04,
  claimStatus: 'unclaimed',
} as Node

const REWARDS: Reward[] = []
const STATE: NodeState = 'buzzing'

function renderDetail(over: Partial<ComponentProps<typeof NodeDetailContent>> = {}) {
  return render(
    <NodeDetailContent
      node={NODE}
      rewards={REWARDS}
      pulseScore={42}
      state={STATE}
      onCheckIn={vi.fn()}
      onSignIn={vi.fn()}
      onCheckOut={vi.fn()}
      isCheckingIn={false}
      isCheckingOut={false}
      {...over}
    />,
  )
}

beforeEach(() => {
  usePresenceStore.getState().clear()
  useLocationStore.setState({ geoStatus: 'idle' })
  useConsumerAuthStore.setState({ isAuthenticated: true })
  useMapStore.setState({ archetypeIds: {} })
})

afterEach(() => {
  cleanup()
  usePresenceStore.getState().clear()
})

describe('NodeDetailContent check-out CTA', () => {
  it('shows the check-out CTA as the primary action when the user is present (R1.1)', () => {
    usePresenceStore.getState().setPresent(NODE_ID)
    renderDetail()

    // The check-out button exposes an accessible name (R6.1) keyed to the copy.
    const checkOut = screen.getByRole('button', { name: 'node.checkOut' })
    expect(checkOut).toBeTruthy()
    expect(checkOut.textContent).toBe('node.checkOut')

    // The check-in CTA must not be the primary action while present.
    expect(screen.queryByRole('button', { name: 'checkin.button' })).toBeNull()
  })

  it('shows the check-in CTA and hides the check-out CTA when not present (R1.2)', () => {
    // No presence set for this node.
    renderDetail()

    expect(screen.getByRole('button', { name: 'checkin.button' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'node.checkOut' })).toBeNull()
  })

  it('tracks presence: hidden after the node presence is cleared (R1.1, R1.2)', () => {
    usePresenceStore.getState().setPresent(NODE_ID)
    const { rerender } = renderDetail()
    expect(screen.getByRole('button', { name: 'node.checkOut' })).toBeTruthy()

    usePresenceStore.getState().clearPresent(NODE_ID)
    rerender(
      <NodeDetailContent
        node={NODE}
        rewards={REWARDS}
        pulseScore={42}
        state={STATE}
        onCheckIn={vi.fn()}
        onSignIn={vi.fn()}
        onCheckOut={vi.fn()}
        isCheckingIn={false}
        isCheckingOut={false}
      />,
    )
    expect(screen.queryByRole('button', { name: 'node.checkOut' })).toBeNull()
    expect(screen.getByRole('button', { name: 'checkin.button' })).toBeTruthy()
  })

  it('disables the check-out button while a check-out is in flight (R1.4 / R2.1)', () => {
    usePresenceStore.getState().setPresent(NODE_ID)
    renderDetail({ isCheckingOut: true })

    const checkOut = screen.getByRole('button', { name: 'node.checkOut' })
    expect((checkOut as HTMLButtonElement).disabled).toBe(true)
    expect(checkOut.getAttribute('aria-disabled')).toBe('true')
    // While in flight it shows the loading label, not the idle label.
    expect(checkOut.textContent).toBe('node.checkingOut')
  })

  it('exposes an accessible name on the check-out button (R6.1)', () => {
    usePresenceStore.getState().setPresent(NODE_ID)
    renderDetail()

    const checkOut = screen.getByLabelText('node.checkOut')
    expect(checkOut.tagName).toBe('BUTTON')
  })

  it('uses check-out copy with no emoji and no em dash (R1.4 / code-style)', () => {
    // The displayed label resolves these i18n keys; assert the real copy is clean.
    const copy = [en['node.checkOut'], en['node.checkingOut']]
    const emDash = /\u2014/
    const emoji = /\p{Extended_Pictographic}/u
    for (const label of copy) {
      expect(label).toBeTruthy()
      expect(emDash.test(label)).toBe(false)
      expect(emoji.test(label)).toBe(false)
    }
  })
})
