/**
 * Bug Condition Exploration Tests
 *
 * These tests encode the EXPECTED (correct) behavior for each bug.
 * They are expected to FAIL on unfixed code, proving the bugs exist.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { StaffValidator } from '../StaffValidator'

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock the api module
vi.mock('../../../shared/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

// Mock Box and Text primitives as simple divs/spans
vi.mock('../../../shared/components/primitives', () => ({
  Box: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Text: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
}))

describe('Bug Condition Exploration - QR Camera Race Condition (Test 1a)', () => {
  let mockGetUserMedia: ReturnType<typeof vi.fn>
  let mockStream: MediaStream
  let rAFCallbacks: Array<FrameRequestCallback>

  beforeEach(() => {
    rAFCallbacks = []

    // Mock requestAnimationFrame to capture callbacks and fire them synchronously
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rAFCallbacks.push(cb)
      // Fire synchronously to simulate the race condition
      cb(performance.now())
      return 1
    })

    // Mock MediaStream
    mockStream = {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream

    // Mock getUserMedia
    mockGetUserMedia = vi.fn().mockResolvedValue(mockStream)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: mockGetUserMedia },
      writable: true,
      configurable: true,
    })

    // Ensure BarcodeDetector is available so startScanning doesn't interfere
    ;(window as any).BarcodeDetector = class {
      detect() {
        return Promise.resolve([])
      }
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete (window as any).BarcodeDetector
  })

  /**
   * Test 1a: Race Condition
   *
   * When startCamera() is called, it sets scanning=true and uses requestAnimationFrame
   * to access videoRef.current. On unfixed code, React hasn't re-rendered the <video>
   * element yet, so videoRef.current is null inside the rAF callback.
   *
   * EXPECTED BEHAVIOR (what the fix should achieve):
   * videoRef.current should be non-null and srcObject should be set to the stream
   * before play() is called.
   *
   * ON UNFIXED CODE: This test FAILS because videoRef.current is null in the rAF callback.
   *
   * **Validates: Requirements 1.1**
   */
  it('should have videoRef.current available and srcObject set before play() is called', async () => {
    const { container } = render(<StaffValidator />)

    // Click "Scan QR Code" button to trigger startCamera()
    const scanButton = container.querySelector('button')
    expect(scanButton).not.toBeNull()

    // Find the scan button by text content
    const buttons = container.querySelectorAll('button')
    let scanQrButton: HTMLButtonElement | null = null
    buttons.forEach((btn) => {
      if (btn.textContent?.includes('Scan QR Code')) {
        scanQrButton = btn as HTMLButtonElement
      }
    })
    expect(scanQrButton).not.toBeNull()

    // Trigger startCamera
    await act(async () => {
      scanQrButton!.click()
    })

    // Wait for the async startCamera flow to complete:
    // getUserMedia resolves → setScanning(true) → React renders <video> → polling finds it → srcObject set
    await waitFor(
      () => {
        const videoElement = container.querySelector('video')
        expect(videoElement).not.toBeNull()
        expect(videoElement?.srcObject).toBe(mockStream)
      },
      { timeout: 3000 },
    )
  })
})

describe('Bug Condition Exploration - Missing jsQR Fallback (Test 1b)', () => {
  let mockStream: MediaStream
  let mockStopTrack: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Remove BarcodeDetector to simulate Safari/Firefox
    delete (window as any).BarcodeDetector
    ;(window as any).BarcodeDetector = undefined

    // Mock MediaStream with a spy on stop() to detect stopCamera() calls
    mockStopTrack = vi.fn()
    mockStream = {
      getTracks: () => [{ stop: mockStopTrack }],
    } as unknown as MediaStream

    // Mock getUserMedia
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue(mockStream) },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete (window as any).BarcodeDetector
  })

  /**
   * Test 1b: jsQR Fallback
   *
   * When BarcodeDetector is undefined (Safari/Firefox), startScanning() should
   * use a canvas+jsQR fallback to continue QR decoding.
   *
   * EXPECTED BEHAVIOR (what the fix should achieve):
   * QR decoding continues via canvas+jsQR fallback (scanIntervalRef is set,
   * no error shown, camera stays active — stream tracks are NOT stopped).
   *
   * ON UNFIXED CODE: This test FAILS because stopCamera() is called which
   * stops the stream tracks, and error message "QR scanning not supported" is shown.
   *
   * **Validates: Requirements 1.2**
   */
  it('should continue QR decoding via fallback when BarcodeDetector is undefined (stream not stopped)', async () => {
    // We need to ensure requestAnimationFrame fires AFTER React renders the video element.
    // Use a deferred approach: capture the rAF callback and invoke it manually after render.
    let rAFCallback: FrameRequestCallback | null = null
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rAFCallback = cb
      return 1
    })

    const { container } = render(<StaffValidator />)

    // Find and click "Scan QR Code" button
    const buttons = container.querySelectorAll('button')
    let scanQrButton: HTMLButtonElement | null = null
    buttons.forEach((btn) => {
      if (btn.textContent?.includes('Scan QR Code')) {
        scanQrButton = btn as HTMLButtonElement
      }
    })
    expect(scanQrButton).not.toBeNull()

    // Trigger startCamera — this will call getUserMedia and then requestAnimationFrame
    await act(async () => {
      scanQrButton!.click()
      // Wait for getUserMedia promise to resolve
      await new Promise((r) => setTimeout(r, 10))
    })

    // At this point, scanning=true and React has re-rendered with the <video> element
    // The rAF callback has been captured but not yet fired
    expect(rAFCallback).not.toBeNull()

    // Now fire the rAF callback — the video element should be in the DOM
    // This simulates the rAF firing AFTER React renders (the ideal case)
    // which means startScanning() WILL be called
    await act(async () => {
      rAFCallback!(performance.now())
      await new Promise((r) => setTimeout(r, 50))
    })

    // EXPECTED: The camera stream should NOT have been stopped
    // On unfixed code, startScanning() is called, finds no BarcodeDetector,
    // and calls stopCamera() which stops the stream tracks
    expect(mockStopTrack).not.toHaveBeenCalled()

    // EXPECTED: No error message about QR scanning not supported
    // On unfixed code, setCameraError('QR scanning not supported...') is called
    const errorText = container.textContent
    expect(errorText).not.toContain('QR scanning not supported')
  })
})
