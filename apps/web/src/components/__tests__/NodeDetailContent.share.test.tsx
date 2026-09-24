// @vitest-environment jsdom
/**
 * `NodeDetailContent` share path honesty (proof-of-demand task 16.4, R15.22).
 *
 * Validates: Requirements 15.22
 *
 * Share has two possible surfaces and neither is guaranteed. `navigator.share`
 * is missing on desktop browsers; `navigator.clipboard` is missing outright on
 * an insecure origin and in the in-app webviews a consumer arrives through, so
 * calling it blind throws a TypeError that reads as a crash. The component asks
 * the shared clipboard helper (`packages/shared/lib/clipboard.ts`, one home for
 * this check) and reports what actually happened: copied, unavailable, or
 * failed. A share beacon is only recorded when the share really happened.
 */
import { CLIPBOARD_FAILED_COPY, CLIPBOARD_UNAVAILABLE_COPY } from '@area-code/shared/lib/clipboard'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useErrorStore } from '@area-code/shared/stores/errorStore'
import { useLocationStore } from '@area-code/shared/stores/locationStore'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import { usePresenceStore } from '@area-code/shared/stores/presenceStore'
import type { Node, NodeState, Reward } from '@area-code/shared/types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NodeDetailContent } from '../NodeDetailContent'

const mocks = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }))

vi.mock('@area-code/shared/lib/api', () => ({
  api: { get: mocks.get, post: mocks.post, patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('../CrowdVibeSection', () => ({ CrowdVibeSection: () => <div data-crowd-vibe-stub /> }))
vi.mock('../QrScannerSheet', () => ({ QrScannerSheet: () => <div data-qr-stub /> }))
vi.mock('../DirectionsSheet', () => ({ DirectionsSheet: () => <div data-directions-stub /> }))
vi.mock('../ArchetypeGlyph', () => ({ ArchetypeGlyph: () => <div data-glyph-stub /> }))

const NODE: Node = {
  id: 'node-1',
  slug: 'test-venue',
  name: 'Test Venue',
  category: 'nightlife',
  lat: -26.2,
  lng: 28.04,
  claimStatus: 'unclaimed',
} as Node

const REWARDS: Reward[] = []
const STATE: NodeState = 'buzzing'
const SHARE_URL = 'https://areacode.co.za/node/test-venue'

function renderDetail() {
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
    />,
  )
}

/** Open the overflow menu and tap Share. */
function tapShare() {
  fireEvent.click(screen.getByLabelText('More options'))
  fireEvent.click(screen.getByRole('button', { name: 'node.share' }))
}

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, writable: true, configurable: true })
}

function setNativeShare(value: unknown) {
  Object.defineProperty(navigator, 'share', { value, writable: true, configurable: true })
}

function lastError(): string | null {
  return useErrorStore.getState().error
}

/**
 * Share beacons only. The component also posts a venue-open beacon on mount,
 * which is not what these assertions are about.
 */
function shareBeacons(): unknown[][] {
  return mocks.post.mock.calls.filter((c) => String(c[0]).endsWith('/share'))
}

beforeEach(() => {
  mocks.post.mockReset()
  mocks.post.mockResolvedValue({})
  useErrorStore.getState().clearError()
  usePresenceStore.getState().clear()
  useLocationStore.setState({ geoStatus: 'idle' })
  useConsumerAuthStore.setState({ isAuthenticated: true })
  useMapStore.setState({ archetypeIds: {} })
})

afterEach(() => {
  cleanup()
  setNativeShare(undefined)
  setClipboard(undefined)
})

describe('NodeDetailContent share (R15.22)', () => {
  it('uses the native share sheet when one exists', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    setNativeShare(share)
    setClipboard(undefined)
    renderDetail()

    tapShare()

    expect(share).toHaveBeenCalledTimes(1)
    expect(share.mock.calls[0]![0]).toMatchObject({ url: SHARE_URL, title: NODE.name })
    await waitFor(() => expect(shareBeacons()).toHaveLength(1))
    expect(lastError()).toBeNull()
  })

  it('copies the link and says so when a clipboard exists but no share sheet', async () => {
    setNativeShare(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    renderDetail()

    tapShare()

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SHARE_URL))
    // Uninitialised i18next returns the fallback, which is the en.json copy.
    await waitFor(() => expect(lastError()).toBe('Link copied'))
    expect(shareBeacons()).toHaveLength(1)
  })

  it('says copy is not available and does not throw when there is no clipboard', async () => {
    setNativeShare(undefined)
    setClipboard(undefined)
    renderDetail()

    expect(() => tapShare()).not.toThrow()

    await waitFor(() => expect(lastError()).toBe(CLIPBOARD_UNAVAILABLE_COPY))
    // Nothing was shared, so nothing is recorded as a share.
    expect(shareBeacons()).toHaveLength(0)
  })

  it('reports a rejected clipboard write as a failure, not as a copy', async () => {
    setNativeShare(undefined)
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) })
    renderDetail()

    tapShare()

    await waitFor(() => expect(lastError()).toBe(CLIPBOARD_FAILED_COPY))
    expect(shareBeacons()).toHaveLength(0)
  })

  it('treats a clipboard object without writeText as unavailable', async () => {
    setNativeShare(undefined)
    setClipboard({})
    renderDetail()

    expect(() => tapShare()).not.toThrow()

    await waitFor(() => expect(lastError()).toBe(CLIPBOARD_UNAVAILABLE_COPY))
  })
})
