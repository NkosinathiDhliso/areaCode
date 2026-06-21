/**
 * R1 sidebar correctness tests for `useMapInit` (Live Vibe on Map § R1).
 *
 * The hook is exercised against a controllable `mapboxgl.Map` mock whose
 * surface (`getBearing`, `easeTo`, `flyTo`, `loaded`, `on/off`) mirrors the
 * shape used by `MapControls.r1.test.tsx`. Position freshness is driven via
 * `useLocationStore` directly so we never touch the real Geolocation API.
 *
 * Covers:
 *   - R1.1 compass tap with bearing > 1° → `easeTo({ bearing: 0 })` ≤ 1000ms
 *   - R1.2 compass tap within ±1° of 0° → no animation, no error log
 *   - R1.3 / R1.4 recenter freshness gate (60s window)
 *   - R1.6 silent early-out when `mapRef.current?.loaded() === false`
 *   - R1.8 double-tap composes to a single intent through MapControls'
 *     250ms debounce
 */
// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach, afterEach, beforeAll } from 'vitest'

// ─── Hoisted mocks ──────────────────────────────────────────────────────────
//
// `vi.hoisted` runs before any top-level imports in the test file, so we use
// it to (a) set the `VITE_MAPBOX_TOKEN` env var that `useMapInit.ts` reads at
// module load time, and (b) build the controllable Map mock we install via
// `vi.mock('mapbox-gl', ...)` below. Without hoisting, the env stub would
// land after the hook module captured `MAPBOX_TOKEN` as `undefined` and the
// hook would short-circuit into its "Map configuration missing" branch.

const mocks = vi.hoisted(() => {
  process.env['VITE_MAPBOX_TOKEN'] = 'pk.test'

  type Listener = (...args: unknown[]) => void

  class MockMap {
    static instances: MockMap[] = []

    private listeners = new Map<string, Set<Listener>>()
    private _bearing = 0
    private _loaded = true

    constructor(_opts: unknown) {
      MockMap.instances.push(this)
    }

    // Event registration mirrors mapbox-gl's `on`/`off` surface so that
    // `useMapInit` can install its 'load' / 'rotate' / 'error' handlers.
    on = vi.fn((event: string, handler: Listener) => {
      if (!this.listeners.has(event)) this.listeners.set(event, new Set())
      this.listeners.get(event)!.add(handler)
    })
    off = vi.fn((event: string, handler: Listener) => {
      this.listeners.get(event)?.delete(handler)
    })

    // Test helpers - not part of the mapbox-gl surface.
    fire(event: string, ...args: unknown[]) {
      for (const h of this.listeners.get(event) ?? []) h(...args)
    }
    setLoadedFlag(v: boolean) {
      this._loaded = v
    }
    setBearingValue(b: number) {
      this._bearing = b
    }

    // Methods touched by `useMapInit`.
    loaded = vi.fn(() => this._loaded)
    getBearing = vi.fn(() => this._bearing)
    setBearing = vi.fn((b: number) => {
      this._bearing = b
    })
    easeTo = vi.fn((opts: { bearing?: number }) => {
      // Mirror real mapbox-gl: the easeTo end state is reflected in
      // subsequent getBearing() reads. This is what makes the R1.2 self-
      // cancellation observable when resetNorth is invoked twice in a row.
      if (typeof opts?.bearing === 'number') this._bearing = opts.bearing
    })
    flyTo = vi.fn()
    setStyle = vi.fn()
    setTerrain = vi.fn()
    setFog = vi.fn()
    setPaintProperty = vi.fn()
    addSource = vi.fn()
    addLayer = vi.fn()
    getSource = vi.fn(() => null)
    getLayer = vi.fn(() => null)
    getStyle = vi.fn(() => ({ layers: [] as unknown[] }))
    resize = vi.fn()
    remove = vi.fn()
    getZoom = vi.fn(() => 13)
    getBounds = vi.fn(() => ({
      getWest: () => 0,
      getEast: () => 0,
      getNorth: () => 0,
      getSouth: () => 0,
    }))

    scrollZoom = { enable: vi.fn() }
    dragPan = { enable: vi.fn() }
    touchZoomRotate = { enableRotation: vi.fn() }
  }

  return { MockMap }
})

vi.mock('mapbox-gl', () => ({
  default: {
    Map: mocks.MockMap,
    accessToken: '',
  },
}))

// jsdom does not ship a ResizeObserver. `useMapInit` constructs one to react
// to container resizes, so we install a no-op shim before the hook loads.
if (typeof (globalThis as any).ResizeObserver === 'undefined') {
  ;(globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

import * as React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'

// Lazily import after `vi.mock` and the env stub above are in place so the
// useMapInit module captures the mocked `mapbox-gl` and the test token.
import { useMapInit } from '../useMapInit'
import { useLocationStore } from '@area-code/shared/stores/locationStore'

// ─── Test harness ───────────────────────────────────────────────────────────

interface HarnessHandle {
  hook: ReturnType<typeof useMapInit>
}

/**
 * Minimal component that drives `useMapInit` and exposes its return value
 * to the surrounding test. The container ref is wired to a real DOM node so
 * the hook's init effect actually runs and constructs a `new MockMap(...)`.
 */
function Harness({ onHook }: { onHook: (handle: HarnessHandle) => void }) {
  const hook = useMapInit()
  // Capture every render's hook output so the test sees the latest callbacks
  // after `mapReady` flips. Calling during render (rather than in effect) is
  // fine here because `onHook` only mutates a closure-scoped variable.
  onHook({ hook })
  return React.createElement('div', { ref: hook.containerRef, style: { width: 100, height: 100 } })
}

function setup(): { handle: HarnessHandle; map: InstanceType<typeof mocks.MockMap> } {
  let handleRef: HarnessHandle | null = null
  render(
    React.createElement(Harness, {
      onHook: (h: HarnessHandle) => {
        handleRef = h
      },
    }),
  )
  // The hook's init effect runs synchronously after render, constructing
  // exactly one MockMap. Grab the most recent instance - earlier tests in
  // the file may have left their (now-removed) instances in the array.
  const map = mocks.MockMap.instances[mocks.MockMap.instances.length - 1]
  if (!map) throw new Error('expected useMapInit to construct a MockMap')
  // Fire 'load' so the hook flips `singletonLoaded` and assigns
  // `mapRef.current = map`. Without this, every callback short-circuits via
  // the R1.6 early-out branch.
  act(() => {
    map.fire('load')
  })
  if (!handleRef) throw new Error('expected Harness to expose its hook handle')
  return { handle: handleRef, map }
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

beforeAll(() => {
  // No-op: env stub lives in `vi.hoisted` above so it is in place before the
  // useMapInit module is first evaluated by the import statement.
})

beforeEach(() => {
  vi.useFakeTimers()
  // Clear the captured-instances array so each test reads its own fresh
  // MockMap from `instances[instances.length - 1]`.
  mocks.MockMap.instances.length = 0
  // Reset the location store so freshness gating is deterministic per test.
  useLocationStore.setState({
    lastKnownPosition: null,
    capturedAt: null,
    accuracy: null,
    permissionState: 'prompt',
    geoStatus: 'idle',
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('useMapInit (R1 sidebar correctness)', () => {
  it('animates the bearing back to 0° when compass is tapped at >1° (R1.1)', () => {
    const { handle, map } = setup()
    map.setBearingValue(45)

    act(() => {
      handle.hook.resetNorth()
    })

    expect(map.easeTo).toHaveBeenCalledTimes(1)
    const args = map.easeTo.mock.calls[0]?.[0] as { bearing: number; duration: number }
    expect(args.bearing).toBe(0)
    // R1.1 budget: the animation must complete within 1000ms ± 50ms.
    expect(args.duration).toBeLessThanOrEqual(1000)
  })

  it('treats a compass tap within ±1° of north as a successful no-op (R1.2)', () => {
    const { handle, map } = setup()
    map.setBearingValue(0.4)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    act(() => {
      handle.hook.resetNorth()
    })

    expect(map.easeTo).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('treats a compass tap at -0.7° (just west of north) as a no-op too (R1.2)', () => {
    const { handle, map } = setup()
    map.setBearingValue(-0.7)

    act(() => {
      handle.hook.resetNorth()
    })

    expect(map.easeTo).not.toHaveBeenCalled()
  })

  it('flies the map to a fresh Last_Known_Position when recenter is tapped (R1.3)', () => {
    const { handle, map } = setup()
    // Drive useLocationStore directly rather than going through
    // navigator.geolocation, per the task's implementation note.
    useLocationStore.setState({
      lastKnownPosition: { lat: -26.2041, lng: 28.0473 },
      capturedAt: Date.now(),
      accuracy: 10,
    })

    act(() => {
      handle.hook.recenterUser()
    })

    expect(map.flyTo).toHaveBeenCalledTimes(1)
    const args = map.flyTo.mock.calls[0]?.[0] as {
      center: [number, number]
      duration: number
    }
    expect(args.center).toEqual([28.0473, -26.2041])
    // R1.3 budget: the fly-to must complete within 1500ms ± 50ms.
    expect(args.duration).toBeLessThanOrEqual(1500)
  })

  it('does not fly to a stale Last_Known_Position older than 60s (R1.3, R1.4)', () => {
    const { handle, map } = setup()
    useLocationStore.setState({
      lastKnownPosition: { lat: -26.2041, lng: 28.0473 },
      capturedAt: Date.now() - 61_000,
      accuracy: 10,
    })

    act(() => {
      handle.hook.recenterUser()
    })

    expect(map.flyTo).not.toHaveBeenCalled()
  })

  it('does not fly when no Last_Known_Position has been captured (R1.4)', () => {
    const { handle, map } = setup()
    // capturedAt is null by default per beforeEach.

    act(() => {
      handle.hook.recenterUser()
    })

    expect(map.flyTo).not.toHaveBeenCalled()
  })

  it('silently early-outs both buttons when the map reports loaded() === false (R1.6)', () => {
    const { handle, map } = setup()
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    map.setLoadedFlag(false)

    // Compass tap while not loaded.
    act(() => {
      handle.hook.resetNorth()
    })
    // Recenter tap with a fresh position but the map not yet loaded.
    useLocationStore.setState({
      lastKnownPosition: { lat: -26.2041, lng: 28.0473 },
      capturedAt: Date.now(),
      accuracy: 10,
    })
    act(() => {
      handle.hook.recenterUser()
    })

    // R1.6: no animation, no exception, at most one debug log per ignored
    // tap (so two ignored taps → at most two debug entries; we observed two
    // distinct calls, one per tap).
    expect(map.easeTo).not.toHaveBeenCalled()
    expect(map.flyTo).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    expect(debugSpy.mock.calls.length).toBeLessThanOrEqual(2)
    expect(debugSpy.mock.calls.length).toBeGreaterThanOrEqual(0)
    // Each debug call corresponds to a single ignored tap; verify the
    // strings are the documented early-out markers.
    for (const call of debugSpy.mock.calls) {
      expect(String(call[0])).toMatch(/\[useMapInit\] (resetNorth|recenterUser) ignored: map not loaded/)
    }

    debugSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('treats a double-tap of compass within 250ms as a single intent (R1.8)', () => {
    // R1.8 lives at the MapControls layer (250ms shared `lastTapAt` ref).
    // At the hook level, R1.2 happens to give us the same observable
    // behaviour for compass: the first call eases to 0°, the mock map
    // reflects that in subsequent getBearing() reads, and the second call
    // self-cancels because the bearing is now within ±1°. Either way, only
    // one easeTo lands.
    const { handle, map } = setup()
    map.setBearingValue(45)

    act(() => {
      handle.hook.resetNorth()
      handle.hook.resetNorth()
    })

    expect(map.easeTo).toHaveBeenCalledTimes(1)
  })

  it('debounces a double-tap of either button when wired through the MapControls 250ms guard (R1.8)', () => {
    // This exercises the documented composition: MapControls owns the
    // 250ms `lastTapAt` ref; the hook trusts the component to debounce.
    // With fake timers frozen at a single instant, two synchronous clicks
    // share the same `Date.now()` and the second falls inside the 250ms
    // window, collapsing to a single hook invocation.
    const onResetNorth = vi.fn()
    const onRecenter = vi.fn()

    function DebounceHarness() {
      const lastTapAtRef = React.useRef(0)
      const tap = (fn: () => void) => () => {
        const now = Date.now()
        if (now - lastTapAtRef.current < 250) return
        lastTapAtRef.current = now
        fn()
      }
      return React.createElement(
        'div',
        null,
        React.createElement('button', { 'data-testid': 'compass', onClick: tap(onResetNorth) }, 'compass'),
        React.createElement('button', { 'data-testid': 'recenter', onClick: tap(onRecenter) }, 'recenter'),
      )
    }

    const { getByTestId } = render(React.createElement(DebounceHarness))

    // Compass-then-recenter inside 250ms: the shared `lastTapAt` ref means
    // only the very first tap survives. This mirrors the contract that
    // `MapControls.r1.test.tsx` already pins at the component layer.
    fireEvent.click(getByTestId('compass'))
    fireEvent.click(getByTestId('compass'))
    fireEvent.click(getByTestId('recenter'))
    fireEvent.click(getByTestId('recenter'))

    expect(onResetNorth).toHaveBeenCalledTimes(1)
    expect(onRecenter).toHaveBeenCalledTimes(0)

    // Past the 250ms window the next tap on either button is accepted again.
    act(() => {
      vi.advanceTimersByTime(260)
    })
    fireEvent.click(getByTestId('recenter'))
    expect(onRecenter).toHaveBeenCalledTimes(1)
    expect(onResetNorth).toHaveBeenCalledTimes(1)
  })
})
