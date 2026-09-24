/**
 * Staff validator camera failures and the scan lock (proof-of-demand R15.16,
 * R15.17).
 *
 * A staff member holding a phone at the till gets one line of copy when the
 * scanner will not start. "Camera failed" tells them nothing, so each
 * `getUserMedia` failure name maps to the thing they can actually do: change the
 * site permission, use the keypad because there is no camera, or close the app
 * holding the camera. Every failure path also releases the stream, so the device
 * camera indicator never stays lit behind an error message.
 *
 * The scan loop holds one decode at a time: `detect()` is async and can outlive
 * the 250 ms tick, so two overlapping calls could otherwise both resolve with a
 * code and both fire a preview for the same scan.
 *
 * **Validates: Requirements 15.16, 15.17**
 */
// @vitest-environment jsdom
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { CAMERA_PLAYBACK_FAILED_COPY, CAMERA_UNKNOWN_FAILURE_COPY, describeCameraError } from '../camera'
import { StaffValidator } from '../StaffValidator'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}))

vi.mock('../../../shared/lib/api', () => ({
  api: { get: mocks.apiGet, post: mocks.apiPost },
}))

vi.mock('../../../shared/components/primitives', () => ({
  Box: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Text: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface StubTrack {
  stop: ReturnType<typeof vi.fn>
}

function stubStream(): { stream: MediaStream; track: StubTrack } {
  const track: StubTrack = { stop: vi.fn() }
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track }
}

function setUserMedia(impl: () => Promise<MediaStream>): void {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(impl) },
    writable: true,
    configurable: true,
  })
}

function scanButton(container: HTMLElement): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Scan QR Code'))
  expect(found).toBeTruthy()
  return found as HTMLButtonElement
}

async function clickScan(container: HTMLElement): Promise<void> {
  await act(async () => {
    scanButton(container).click()
    await new Promise((r) => setTimeout(r, 20))
  })
}

beforeEach(() => {
  mocks.apiGet.mockReset()
  mocks.apiPost.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// ─── The mapper ───────────────────────────────────────────────────────────────

describe('describeCameraError (R15.16)', () => {
  const cases: Array<[string, string]> = [
    ['NotAllowedError', 'settings'],
    ['PermissionDeniedError', 'settings'],
    ['NotFoundError', 'No camera found'],
    ['DevicesNotFoundError', 'No camera found'],
    ['NotReadableError', 'in use by another app'],
    ['TrackStartError', 'in use by another app'],
    ['OverconstrainedError', 'no back camera'],
    ['ConstraintNotSatisfiedError', 'no back camera'],
    ['SecurityError', 'secure connection'],
    ['AbortError', 'stopped before it could start'],
  ]

  it('gives each failure name its own actionable line', () => {
    const seen = new Set<string>()
    for (const [name, fragment] of cases) {
      const copy = describeCameraError(new DOMException('raw platform text', name))
      expect(copy).toContain(fragment)
      seen.add(copy)
    }
    // Denied, missing, busy, constrained, insecure, aborted: six distinct
    // messages across the ten spec names (the aliases share copy by design).
    expect(seen.size).toBe(6)
  })

  it('never leaks the platform message or the error name', () => {
    for (const [name] of cases) {
      const copy = describeCameraError(new DOMException('raw platform text', name))
      expect(copy).not.toContain('raw platform text')
      expect(copy).not.toContain(name)
    }
  })

  it('falls back to one generic line for an unrecognised failure', () => {
    expect(describeCameraError(new Error('boom'))).toBe(CAMERA_UNKNOWN_FAILURE_COPY)
    expect(describeCameraError(undefined)).toBe(CAMERA_UNKNOWN_FAILURE_COPY)
    expect(describeCameraError('NotAllowedError')).toBe(CAMERA_UNKNOWN_FAILURE_COPY)
  })

  it('always points at manual code entry so the till is never blocked', () => {
    for (const [name] of cases) {
      expect(describeCameraError(new DOMException('x', name)).toLowerCase()).toContain('code below')
    }
    expect(CAMERA_UNKNOWN_FAILURE_COPY.toLowerCase()).toContain('code below')
    expect(CAMERA_PLAYBACK_FAILED_COPY.toLowerCase()).toContain('code below')
  })
})

// ─── The component ────────────────────────────────────────────────────────────

describe('StaffValidator camera start failures (R15.16)', () => {
  it.each([
    ['NotAllowedError', 'Camera access denied'],
    ['NotFoundError', 'No camera found on this device'],
    ['NotReadableError', 'The camera is in use by another app'],
    ['OverconstrainedError', 'no back camera'],
    ['SecurityError', 'needs a secure connection'],
  ])('shows the %s branch copy and leaves the scanner closed', async (name, fragment) => {
    setUserMedia(() => Promise.reject(new DOMException('raw platform text', name)))
    const { container } = render(<StaffValidator />)

    await clickScan(container)

    expect(container.textContent).toContain(fragment)
    // No stream, so no viewfinder, and the scan button is offered again.
    expect(container.querySelector('video')).toBeNull()
    expect(scanButton(container)).toBeTruthy()
    // Manual entry stays available throughout.
    expect(container.querySelector('input[type="text"]')).toBeTruthy()
  })

  it('releases the stream when playback fails, so the camera indicator goes off', async () => {
    const { stream, track } = stubStream()
    setUserMedia(() => Promise.resolve(stream))
    const play = vi.fn().mockRejectedValue(new DOMException('blocked', 'NotAllowedError'))
    Object.defineProperty(HTMLMediaElement.prototype, 'play', { value: play, configurable: true })

    const { container } = render(<StaffValidator />)
    await clickScan(container)

    await waitFor(() => expect(container.textContent).toContain(CAMERA_PLAYBACK_FAILED_COPY))
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(container.querySelector('video')).toBeNull()
  })
})

describe('StaffValidator scan lock (R15.17)', () => {
  function installDetector(detect: () => Promise<Array<{ rawValue?: string }>>): void {
    ;(window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {
      detect = detect
    }
  }

  it('runs one decode at a time, never overlapping calls', async () => {
    const { stream } = stubStream()
    setUserMedia(() => Promise.resolve(stream))
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      value: vi.fn().mockResolvedValue(undefined),
      configurable: true,
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { value: 4, configurable: true })

    // A decode that never settles: the interval keeps firing, the lock holds.
    const detect = vi.fn(() => new Promise<Array<{ rawValue?: string }>>(() => {}))
    installDetector(detect)

    const { container } = render(<StaffValidator />)
    await clickScan(container)
    await waitFor(() => expect(detect).toHaveBeenCalledTimes(1))

    // Three more ticks with the first decode still in flight.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 800))
    })
    expect(detect).toHaveBeenCalledTimes(1)
  })

  it('ignores a decode that resolves after the scanner was closed', async () => {
    const { stream } = stubStream()
    setUserMedia(() => Promise.resolve(stream))
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      value: vi.fn().mockResolvedValue(undefined),
      configurable: true,
    })
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { value: 4, configurable: true })

    let settle: ((codes: Array<{ rawValue?: string }>) => void) | null = null
    const detect = vi.fn(
      () =>
        new Promise<Array<{ rawValue?: string }>>((resolve) => {
          settle = resolve
        }),
    )
    installDetector(detect)
    mocks.apiGet.mockResolvedValue({
      rewardTitle: 'Free coffee',
      rewardType: 'freebie',
      rewardDescription: '',
      consumerDisplayName: 'Thandi',
      consumerTier: 'bronze',
    })

    const { container } = render(<StaffValidator />)
    await clickScan(container)
    await waitFor(() => expect(detect).toHaveBeenCalledTimes(1))

    // Staff closes the scanner while the decode is still in flight.
    const close = container.querySelector('button[aria-label="Close scanner"]') as HTMLButtonElement
    expect(close).toBeTruthy()
    fireEvent.click(close)

    // The late result must not reach the preview call.
    await act(async () => {
      settle?.([{ rawValue: 'ABCD2345' }])
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(mocks.apiGet).not.toHaveBeenCalled()
  })
})
