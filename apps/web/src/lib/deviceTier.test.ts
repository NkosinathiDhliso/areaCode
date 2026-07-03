// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('deviceTier', () => {
  let originalHardwareConcurrency: PropertyDescriptor | undefined
  let originalDevicePixelRatio: PropertyDescriptor | undefined
  let originalMaxTouchPoints: PropertyDescriptor | undefined

  beforeEach(() => {
    originalHardwareConcurrency = Object.getOwnPropertyDescriptor(navigator, 'hardwareConcurrency')
    originalDevicePixelRatio = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio')
    originalMaxTouchPoints = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints')
    vi.resetModules()
  })

  afterEach(() => {
    if (originalHardwareConcurrency) {
      Object.defineProperty(navigator, 'hardwareConcurrency', originalHardwareConcurrency)
    } else {
      Object.defineProperty(navigator, 'hardwareConcurrency', { value: undefined, configurable: true })
    }
    if (originalDevicePixelRatio) {
      Object.defineProperty(window, 'devicePixelRatio', originalDevicePixelRatio)
    }
    if (originalMaxTouchPoints) {
      Object.defineProperty(navigator, 'maxTouchPoints', originalMaxTouchPoints)
    }
  })

  it('returns "low" when hardwareConcurrency <= 4', async () => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 4, configurable: true })
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true })
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true })

    const { deviceTier } = await import('./deviceTier')
    expect(deviceTier).toBe('low')
  })

  it('returns "low" on touch device with devicePixelRatio < 2', async () => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8, configurable: true })
    Object.defineProperty(window, 'devicePixelRatio', { value: 1.5, configurable: true })
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true })

    const { deviceTier } = await import('./deviceTier')
    expect(deviceTier).toBe('low')
  })

  it('returns "high" when cores > 4 and DPR >= 2 on touch device', async () => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8, configurable: true })
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true })
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true })

    const { deviceTier } = await import('./deviceTier')
    expect(deviceTier).toBe('high')
  })

  it('returns "high" for desktop with good cores and no touch', async () => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 12, configurable: true })
    // Desktop with DPR 1 is fine because it's not a touch device.
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true })
    // jsdom may define ontouchstart; remove it to simulate a real desktop.
    const hadTouch = 'ontouchstart' in globalThis
    if (hadTouch) delete (globalThis as Record<string, unknown>)['ontouchstart']

    const { deviceTier } = await import('./deviceTier')
    expect(deviceTier).toBe('high')

    // Restore if it was present
    if (hadTouch) (globalThis as Record<string, unknown>)['ontouchstart'] = null
  })

  it('is computed once at module load (no runtime polling)', async () => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8, configurable: true })
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true })
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true })

    const mod = await import('./deviceTier')
    const first = mod.deviceTier

    // Mutate environment after import - tier should NOT change
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 2, configurable: true })
    expect(mod.deviceTier).toBe(first)
  })

  it('exports a valid DeviceTier type', async () => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: 8, configurable: true })
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true })
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true })

    const { deviceTier } = await import('./deviceTier')
    expect(['low', 'high']).toContain(deviceTier)
  })
})
