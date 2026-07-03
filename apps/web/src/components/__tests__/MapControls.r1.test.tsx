/**
 * R1 sidebar correctness tests for MapControls (Live Vibe on Map § R1).
 *
 * Covers the freshness-derived disabled state on Recenter_Button, the
 * 250ms shared debounce between Compass_Button and Recenter_Button, the
 * data-testid wiring, and the pauseIdleDrift contract.
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { MapControls } from '../MapControls'

// `useMapStore` is loaded from the shared package. We don't need to mock
// the store because the test queries are insensitive to the network's
// pulse total - they look up the sidebar buttons by data-testid. The
// legacy permanent City_Pulse glass card has been removed; the City_Pulse
// readout now lives on a once-per-session toast (R2 / R2.7).
beforeEach(() => {
  vi.useRealTimers()
})
afterEach(() => {
  cleanup()
})

function setup(overrides: Partial<Parameters<typeof MapControls>[0]> = {}) {
  const onResetNorth = vi.fn()
  const onRecenter = vi.fn()
  const onToggle3D = vi.fn()
  const onZoomIn = vi.fn()
  const onZoomOut = vi.fn()
  const pauseIdleDrift = vi.fn()
  const props = {
    is3D: true,
    bearing: 0,
    onToggle3D,
    onResetNorth,
    onRecenter,
    onZoomIn,
    onZoomOut,
    lastKnownPositionFreshAt: null as number | null,
    pauseIdleDrift,
    ...overrides,
  }
  render(<MapControls {...props} />)
  return { onResetNorth, onRecenter, onToggle3D, onZoomIn, onZoomOut, pauseIdleDrift }
}

describe('MapControls (R1 sidebar correctness)', () => {
  it('exposes data-testids for Compass_Button and Recenter_Button (R1.8)', () => {
    setup()
    expect(screen.getByTestId('map-sidebar-compass')).toBeTruthy()
    expect(screen.getByTestId('map-sidebar-recenter')).toBeTruthy()
  })

  it('renders Recenter_Button disabled when no Last_Known_Position has been captured (R1.4)', () => {
    setup({ lastKnownPositionFreshAt: null })
    const btn = screen.getByTestId('map-sidebar-recenter') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    expect(btn.className).toMatch(/cursor-not-allowed/)
  })

  it('renders Recenter_Button disabled when Last_Known_Position is stale (>60s old) (R1.3)', () => {
    setup({ lastKnownPositionFreshAt: Date.now() - 61_000 })
    const btn = screen.getByTestId('map-sidebar-recenter') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('aria-disabled')).toBe('true')
  })

  it('renders Recenter_Button enabled when Last_Known_Position is fresh (R1.3, R1.4)', () => {
    setup({ lastKnownPositionFreshAt: Date.now() })
    const btn = screen.getByTestId('map-sidebar-recenter') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    expect(btn.getAttribute('aria-disabled')).toBeNull()
  })

  it('debounces double-taps within 250ms across both sidebar buttons (R1.7)', () => {
    const { onResetNorth, onRecenter } = setup({ lastKnownPositionFreshAt: Date.now() })
    // First tap goes through, immediately-following second tap is dropped.
    fireEvent.click(screen.getByTestId('map-sidebar-compass'))
    fireEvent.click(screen.getByTestId('map-sidebar-recenter'))
    expect(onResetNorth).toHaveBeenCalledTimes(1)
    expect(onRecenter).toHaveBeenCalledTimes(0)
  })

  it('calls pauseIdleDrift(4000) on every accepted sidebar tap (R1.5)', () => {
    const { pauseIdleDrift } = setup({ lastKnownPositionFreshAt: Date.now() })
    fireEvent.click(screen.getByTestId('map-sidebar-compass'))
    expect(pauseIdleDrift).toHaveBeenCalledTimes(1)
    expect(pauseIdleDrift).toHaveBeenCalledWith(4000)
  })
})
