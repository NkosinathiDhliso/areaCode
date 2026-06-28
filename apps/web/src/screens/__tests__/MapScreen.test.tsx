// @vitest-environment jsdom
import {
  useConnectivityStore,
  useConsumerAuthStore,
  useLocationStore,
  useMapStore,
  useSelectionStore,
  useUserStore,
} from '@area-code/shared/stores'
import { useErrorStore } from '@area-code/shared/stores/errorStore'
import type { MapInstance, Node } from '@area-code/shared/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { UseCarouselSelectionResult } from '../../hooks/useCarouselSelection'
import { MapScreen } from '../MapScreen'

/**
 * Map Discovery - MapScreen render + realtime/offline integration tests
 * (deferred spec tasks 17.2, 17.3).
 *
 * The screen is exercised at the state-machine / data level: the browser and
 * native edges (Mapbox GL, the map-init/marker/socket hooks, geolocation and
 * the WebSocket-backed shared hooks) are mocked, and the real Zustand stores,
 * `useCarouselSelection`, `useCheckInFlow`, and `useOverlayCoordinator` are
 * driven through `setState`. Presentational children (PeekCarousel, the
 * sheets, the overlays) are stubbed to lightweight `data-*` probes so the
 * assertions target MapScreen's own wiring rather than child internals - the
 * full visual carousel flows live in the Playwright e2e suite.
 *
 * Validates: Requirements 9.1, 9.2, 9.4, 9.7, 10.3, 13.6, 15.1, 15.3, 17.1,
 *            18.2, 18.4, 18.5, 19.2, 19.4
 */

// ── Hoisted mock state so the module factories can read mutable values ──
const h = vi.hoisted(() => ({
  mapInit: { mapReady: true as boolean, mapError: null as string | null },
  geo: { requestLocation: vi.fn(), geoStatus: 'acquired' as string },
  checkIn: { checkIn: vi.fn(), isPending: false, qrFallback: false, resetQrFallback: vi.fn() },
}))

// ── Native / browser edges ──
vi.mock('mapbox-gl', () => ({ default: { Marker: class {}, Map: class {} } }))

vi.mock('../../hooks/useMapInit', () => ({
  useMapInit: () => ({
    containerRef: { current: null },
    mapRef: { current: null },
    mapReady: h.mapInit.mapReady,
    mapError: h.mapInit.mapError,
    retryMap: vi.fn(),
    is3D: true,
    setPitch3D: vi.fn(),
    bearing: 0,
    resetNorth: vi.fn(),
    recenterUser: vi.fn(),
    pauseIdleDrift: vi.fn(),
  }),
}))
vi.mock('../../hooks/useMapMarkers', () => ({ useMapMarkers: () => {} }))
vi.mock('../../hooks/useConstellationSweep', () => ({
  useConstellationSweep: () => ({ brushedNodeId: null }),
}))
vi.mock('../../hooks/useMapSockets', () => ({ useMapSockets: () => {} }))

vi.mock('@area-code/shared/hooks', () => ({
  useGeolocation: () => ({ requestLocation: h.geo.requestLocation, geoStatus: h.geo.geoStatus }),
  useNodeArchetype: () => {},
  useCityPulseToast: () => {},
  useCheckIn: () => ({
    checkIn: h.checkIn.checkIn,
    isPending: h.checkIn.isPending,
    qrFallback: h.checkIn.qrFallback,
    resetQrFallback: h.checkIn.resetQrFallback,
  }),
}))

vi.mock('@area-code/shared/lib/featureGating', () => ({ useLiveVibeOnMap: () => false }))

vi.mock('@area-code/shared/lib/api', () => ({
  api: {
    get: vi.fn((url: string) => {
      if (url.includes('/rewards')) return Promise.resolve({ items: [] })
      return Promise.resolve([])
    }),
  },
}))

// ── Presentational children: lightweight data-* probes ──
vi.mock('../../components/CategoryFilterBar', () => ({ CategoryFilterBar: () => <div data-category-filter /> }))
vi.mock('../../components/MapControls', () => ({ MapControls: () => <div data-map-controls /> }))
vi.mock('../../components/ProximityNudgeBanner', () => ({ ProximityNudgeBanner: () => <div data-nudge /> }))
vi.mock('../../components/ToastOverlay', () => ({ ToastOverlay: () => <div data-toast-overlay /> }))
vi.mock('../../components/QrScannerSheet', () => ({
  QrScannerSheet: ({ isOpen }: { isOpen?: boolean }) => <div data-qr-scanner data-open={String(!!isOpen)} />,
}))
vi.mock('../../components/SearchSheet', () => ({
  SearchSheet: ({ isOpen }: { isOpen?: boolean }) => <div data-search-sheet data-open={String(!!isOpen)} />,
}))
vi.mock('../../components/SignupSheet', () => ({
  SignupSheet: ({ isOpen }: { isOpen?: boolean }) => <div data-signup-sheet data-open={String(!!isOpen)} />,
}))
vi.mock('../../components/NotificationPrimingSheet', () => ({
  NotificationPrimingSheet: ({ isOpen }: { isOpen?: boolean }) => (
    <div data-priming-sheet data-open={String(!!isOpen)} />
  ),
  isDeferredRecently: () => false,
}))
vi.mock('../../components/PeekCarousel', () => ({
  PeekCarousel: ({ selection }: { selection: UseCarouselSelectionResult }) => (
    <div
      data-peek-carousel
      data-mode={selection.mode}
      data-active={selection.activeVenueId ?? ''}
      data-opened-from-focus={String(selection.openedFromFocus)}
      data-count={selection.activeVenueVM ? String(selection.activeVenueVM.liveCheckInCount) : ''}
    />
  ),
}))

/** An in-memory `MapInstance` whose viewport spans the whole globe. */
const mapInstanceStub: MapInstance = {
  flyTo: vi.fn(),
  setFeatureState: vi.fn(),
  getZoom: () => 13,
  getBounds: () => ({
    toArray: () => [
      [-180, -90],
      [180, 90],
    ],
  }),
}

function node(id: string, over: Partial<Node> = {}): Node {
  return { id, name: `Venue ${id}`, category: 'nightlife', lat: -26.2, lng: 28.04, ...over } as Node
}

afterEach(cleanup)

beforeEach(() => {
  h.mapInit.mapReady = true
  h.mapInit.mapError = null
  h.geo.requestLocation = vi.fn().mockResolvedValue({ lat: -26.2, lng: 28.04 })
  h.geo.geoStatus = 'acquired'
  h.checkIn.checkIn = vi.fn().mockResolvedValue(true)
  h.checkIn.isPending = false
  h.checkIn.qrFallback = false
  h.checkIn.resetQrFallback = vi.fn()

  useMapStore.setState({
    nodes: { a: node('a', { name: 'Aardvark Bar' }), b: node('b', { name: 'Botanical Cafe', category: 'cafe' }) },
    pulseScores: {},
    checkInCounts: {},
    archetypeIds: {},
    focusNodeId: null,
    mapInstance: mapInstanceStub,
  })
  useSelectionStore.setState({
    activeVenueId: null,
    mode: 'closed',
    carouselOrder: [],
    openedFromFocus: false,
    lastVenueId: null,
  })
  useLocationStore.setState({
    lastKnownPosition: { lat: -26.2, lng: 28.04 },
    capturedAt: Date.now(),
    permissionState: 'prompt',
    geoStatus: 'acquired',
  })
  useConsumerAuthStore.setState({ isAuthenticated: false, accessToken: null, userId: null })
  useConnectivityStore.setState({ state: 'online' })
  useUserStore.setState({ user: null, onboarding: { hintSeen: true, layerHintSeen: true, firstCheckIn: true } })
  useErrorStore.setState({ showError: vi.fn() })
})

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <MapScreen onNavigate={vi.fn()} />
    </QueryClientProvider>,
  )
  // Flush the node/rewards query promises and the cascading selection effects.
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  return utils
}

describe('MapScreen - 17.2 render and state coverage', () => {
  it('first paint stays closed with no prior venue (Constellation cold open)', async () => {
    const { container } = await renderScreen()
    const carousel = container.querySelector('[data-peek-carousel]')!
    expect(carousel.getAttribute('data-mode')).toBe('closed')
    expect(carousel.getAttribute('data-active')).toBe('')
  })

  it('returning users reopen on lastVenueId in Browse_Mode (R1.1 segmented)', async () => {
    useSelectionStore.setState({ lastVenueId: 'a' })
    const { container } = await renderScreen()
    const carousel = container.querySelector('[data-peek-carousel]')!
    expect(carousel.getAttribute('data-mode')).toBe('browse')
    expect(carousel.getAttribute('data-active')).toBe('a')
  })

  it('shows the loading overlay while the map is not ready (R9.x)', async () => {
    h.mapInit.mapReady = false
    const { container } = await renderScreen()
    expect(screen.getByText('Loading map...')).toBeTruthy()
    expect(container.querySelector('[data-peek-carousel]')!.getAttribute('data-mode')).toBe('closed')
  })

  it('shows the error fallback with a retry control when map init fails (R9.x)', async () => {
    h.mapInit.mapError = 'Could not load the map.'
    await renderScreen()
    expect(screen.getByText('Map unavailable')).toBeTruthy()
    expect(screen.getByText('Could not load the map.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('keeps the carousel closed when no venue is in the viewport (empty state)', async () => {
    useMapStore.setState({ nodes: {} })
    const { container } = await renderScreen()
    expect(container.querySelector('[data-peek-carousel]')!.getAttribute('data-mode')).toBe('closed')
  })

  it('renders the Location_Banner only when permission is denied, and enabling requests location (R10.3)', async () => {
    useLocationStore.setState({ permissionState: 'denied' })
    await renderScreen()
    const enable = screen.getByText('location.enable')
    expect(enable).toBeTruthy()
    fireEvent.click(enable)
    expect(h.geo.requestLocation).toHaveBeenCalled()
  })

  it('does not render the Location_Banner when permission is granted', async () => {
    useLocationStore.setState({ permissionState: 'granted' })
    await renderScreen()
    expect(screen.queryByText('location.enable')).toBeNull()
  })

  it('opens the SearchSheet when the search control is tapped (R13.6, R15.1)', async () => {
    const { container } = await renderScreen()
    expect(container.querySelector('[data-search-sheet]')!.getAttribute('data-open')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Search venues' }))
    expect(container.querySelector('[data-search-sheet]')!.getAttribute('data-open')).toBe('true')
  })

  it('gates the Notification_Priming_Sheet behind a first successful check-in (R17.5)', async () => {
    const { container } = await renderScreen()
    expect(container.querySelector('[data-priming-sheet]')).toBeNull()
  })

  it('reflects a focus-opened selection with the lighter backdrop flag (R15.3)', async () => {
    const { container } = await renderScreen()
    act(() => {
      useSelectionStore.getState().selectVenue('b', 'focus')
    })
    const carousel = container.querySelector('[data-peek-carousel]')!
    expect(carousel.getAttribute('data-active')).toBe('b')
    expect(carousel.getAttribute('data-opened-from-focus')).toBe('true')
  })
})

describe('MapScreen - 17.3 realtime and offline coherence', () => {
  it('reflects a node:pulse_update on the active venue without re-opening the sheet (R18.2, R18.4)', async () => {
    useSelectionStore.setState({ lastVenueId: 'a' })
    const { container } = await renderScreen()
    const before = container.querySelector('[data-peek-carousel]')!
    expect(before.getAttribute('data-mode')).toBe('browse')
    expect(before.getAttribute('data-active')).toBe('a')
    expect(before.getAttribute('data-count')).toBe('0')

    act(() => {
      useMapStore.getState().updateNodePulse('a', 50, 9)
    })

    const after = container.querySelector('[data-peek-carousel]')!
    // Same DOM node: the sheet updated in place, it did not remount / re-open.
    expect(after).toBe(before)
    expect(after.getAttribute('data-mode')).toBe('browse')
    expect(after.getAttribute('data-active')).toBe('a')
    expect(after.getAttribute('data-count')).toBe('9')
  })

  it('retains last-known live values when offline and reconciles on reconnect (R19.2, R19.4)', async () => {
    useSelectionStore.setState({ lastVenueId: 'a' })
    const { container } = await renderScreen()
    act(() => {
      useMapStore.getState().updateNodePulse('a', 50, 9)
    })
    const el = container.querySelector('[data-peek-carousel]')!
    expect(el.getAttribute('data-count')).toBe('9')

    // Go offline: the last-known count is retained, nothing blanks out.
    act(() => {
      useConnectivityStore.getState().setOffline()
    })
    expect(container.querySelector('[data-peek-carousel]')!.getAttribute('data-count')).toBe('9')
    expect(container.querySelector('[data-peek-carousel]')!.getAttribute('data-mode')).toBe('browse')

    // Reconnect and push a fresh update: it reconciles in the same sheet.
    act(() => {
      useConnectivityStore.getState().setOnline()
      useMapStore.getState().updateNodePulse('a', 60, 11)
    })
    const reconciled = container.querySelector('[data-peek-carousel]')!
    expect(reconciled).toBe(el)
    expect(reconciled.getAttribute('data-count')).toBe('11')
    expect(reconciled.getAttribute('data-active')).toBe('a')
  })
})
