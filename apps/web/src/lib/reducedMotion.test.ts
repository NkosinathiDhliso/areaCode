// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('reducedMotion', () => {
  let listeners: Array<(e: MediaQueryListEvent) => void> = []
  let matchesValue = false

  beforeEach(() => {
    listeners = []
    matchesValue = false

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn((query: string) => {
        expect(query).toBe('(prefers-reduced-motion: reduce)')
        return {
          get matches() {
            return matchesValue
          },
          addEventListener: (_event: string, cb: (e: MediaQueryListEvent) => void) => {
            listeners.push(cb)
          },
          removeEventListener: vi.fn(),
        }
      }),
    })
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('returns false when prefers-reduced-motion is not set', async () => {
    matchesValue = false
    const { reducedMotion } = await import('./reducedMotion')
    expect(reducedMotion()).toBe(false)
  })

  it('returns true when prefers-reduced-motion: reduce is set at load time', async () => {
    matchesValue = true
    const { reducedMotion } = await import('./reducedMotion')
    expect(reducedMotion()).toBe(true)
  })

  it('updates the cached value when the media query changes', async () => {
    matchesValue = false
    const { reducedMotion } = await import('./reducedMotion')
    expect(reducedMotion()).toBe(false)

    // Simulate the OS preference changing
    listeners.forEach((cb) => cb({ matches: true } as MediaQueryListEvent))
    expect(reducedMotion()).toBe(true)

    // And back
    listeners.forEach((cb) => cb({ matches: false } as MediaQueryListEvent))
    expect(reducedMotion()).toBe(false)
  })
})
