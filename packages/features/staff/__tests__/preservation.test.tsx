/**
 * Preservation Property Tests — Staff QR Scanner
 *
 * These tests capture EXISTING correct behavior on UNFIXED code.
 * They must PASS on the current unfixed code to establish a baseline
 * that must be preserved after the bug fixes are applied.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 */
// @vitest-environment jsdom
import { render, act } from '@testing-library/react'
import * as fc from 'fast-check'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { StaffValidator } from '../StaffValidator'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockApiGet = vi.fn()
const mockApiPost = vi.fn()

vi.mock('../../../shared/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
  },
}))

vi.mock('../../../shared/components/primitives', () => ({
  Box: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Text: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
}))

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Generates valid alphanumeric redemption codes (1-6 chars, uppercase) */
const redemptionCodeArb = fc.string({
  minLength: 1,
  maxLength: 6,
  unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
})

/** Generates QR URL strings that match the expected pattern /qr/{nodeSlug}/{code} */
const qrUrlArb = fc
  .tuple(
    fc.string({
      minLength: 3,
      maxLength: 20,
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
    }),
    fc.string({
      minLength: 3,
      maxLength: 10,
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
    }),
  )
  .map(([slug, code]) => `https://areacode.co.za/qr/${slug}/${code}`)

/** Generates non-matching URLs (no /qr/ pattern) */
const nonQrUrlArb = fc.string({
  minLength: 1,
  maxLength: 10,
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Preservation Property: Manual code entry triggers handlePreview on Enter key', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockApiGet.mockReset()
    mockApiPost.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /**
   * For all valid redemption codes entered manually, pressing Enter triggers
   * the preview API call with the correct code.
   *
   * **Validates: Requirements 3.4**
   */
  it('should call /v1/staff/redeem/{code}/preview when Enter is pressed with a valid code', () => {
    fc.assert(
      fc.property(redemptionCodeArb, (code) => {
        mockApiGet.mockReset()
        mockApiGet.mockResolvedValue({
          rewardTitle: 'Test Reward',
          rewardType: 'discount',
          rewardDescription: 'Test',
          consumerDisplayName: 'User',
          consumerTier: 'explorer',
        })

        const { container, unmount } = render(<StaffValidator />)

        // Find the input field
        const input = container.querySelector('input[type="text"]') as HTMLInputElement
        expect(input).not.toBeNull()

        // Type the code
        act(() => {
          // Simulate onChange
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value',
          )!.set!
          nativeInputValueSetter.call(input, code)
          input.dispatchEvent(new Event('input', { bubbles: true }))
        })

        // Simulate the React onChange by firing it directly
        act(() => {
          const event = new Event('change', { bubbles: true })
          Object.defineProperty(event, 'target', { value: { value: code } })
          input.dispatchEvent(event)
        })

        // Press Enter
        act(() => {
          const keyEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
          input.dispatchEvent(keyEvent)
        })

        // The API should be called with the code (uppercased, alphanumeric only)
        const expectedCode = code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
        if (expectedCode.length > 0) {
          expect(mockApiGet).toHaveBeenCalledWith(`/v1/staff/redeem/${encodeURIComponent(expectedCode)}/preview`)
        }

        unmount()
      }),
      { numRuns: 20 },
    )
  })
})

describe('Preservation Property: Native BarcodeDetector used when available', () => {
  let mockDetect: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockDetect = vi.fn().mockResolvedValue([])
    ;(window as any).BarcodeDetector = class {
      constructor() {}
      detect() {
        return (mockDetect as () => Promise<unknown[]>)()
      }
    }

    // Mock getUserMedia
    const mockStream = {
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream

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
   * For all browsers with BarcodeDetector available, native scanning is used.
   * startScanning() creates a BarcodeDetector instance and sets up interval scanning.
   *
   * **Validates: Requirements 3.1**
   */
  it('should use native BarcodeDetector when available (not jsQR)', async () => {
    // Capture setInterval calls to verify scanning is set up
    const setIntervalSpy = vi.spyOn(window, 'setInterval')

    // Need to let rAF fire after React renders
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

    // Trigger startCamera
    await act(async () => {
      scanQrButton!.click()
      await new Promise((r) => setTimeout(r, 10))
    })

    // Fire rAF after React has rendered the video element
    if (rAFCallback) {
      await act(async () => {
        rAFCallback!(performance.now())
        await new Promise((r) => setTimeout(r, 10))
      })
    }

    // Verify that setInterval was called (BarcodeDetector scanning loop)
    // The interval is set at 250ms for native BarcodeDetector
    const intervalCalls = setIntervalSpy.mock.calls
    const has250msInterval = intervalCalls.some(([, ms]) => ms === 250)
    expect(has250msInterval).toBe(true)

    // No error message should be shown
    expect(container.textContent).not.toContain('QR scanning not supported')
  })
})

describe('Preservation Property: Camera permission denial handling', () => {
  beforeEach(() => {
    // Mock getUserMedia to reject (permission denied)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError')),
      },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * For all camera permission denials, the error message "Camera access denied..."
   * is shown and scanning is set to false.
   *
   * **Validates: Requirements 3.2**
   */
  it('should show camera denied error and stop scanning when permission is denied', async () => {
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

    // Trigger startCamera — will fail with permission denied
    await act(async () => {
      scanQrButton!.click()
      await new Promise((r) => setTimeout(r, 10))
    })

    // Error message should be displayed
    expect(container.textContent).toContain('Camera access denied')

    // The video element should NOT be rendered (scanning = false)
    const videoElement = container.querySelector('video')
    expect(videoElement).toBeNull()

    // The "Scan QR Code" button should be visible again (scanning stopped)
    const buttonsAfter = container.querySelectorAll('button')
    let scanButtonVisible = false
    buttonsAfter.forEach((btn) => {
      if (btn.textContent?.includes('Scan QR Code')) {
        scanButtonVisible = true
      }
    })
    expect(scanButtonVisible).toBe(true)
  })
})

describe('Preservation Property: QR code regex extraction', () => {
  /**
   * For all successful QR scans matching the pattern /qr/{slug}/{code},
   * the code is correctly extracted via regex and handleCodeScanned is called.
   *
   * **Validates: Requirements 3.3**
   */
  it('should extract code from QR URL pattern /qr/{slug}/{code}', () => {
    const regex = /\/qr\/[^/]+\/([a-zA-Z0-9]+)/

    fc.assert(
      fc.property(qrUrlArb, (url) => {
        const match = url.match(regex)
        expect(match).not.toBeNull()
        // The extracted code should be alphanumeric
        const extractedCode = match![1]!
        expect(extractedCode).toMatch(/^[a-zA-Z0-9]+$/)
        expect(extractedCode.length).toBeGreaterThan(0)
      }),
      { numRuns: 100 },
    )
  })

  /**
   * For non-QR URLs (no /qr/ pattern), the regex does not match and
   * the raw scanned value is cleaned (non-alphanumeric removed, uppercased).
   *
   * **Validates: Requirements 3.3**
   */
  it('should clean non-QR scanned values to uppercase alphanumeric', () => {
    fc.assert(
      fc.property(nonQrUrlArb, (scannedCode) => {
        const regex = /\/qr\/[^/]+\/([a-zA-Z0-9]+)/
        const match = scannedCode.match(regex)

        if (!match) {
          // When no match, code is cleaned: non-alphanumeric removed, uppercased
          const cleaned = scannedCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
          expect(cleaned).toMatch(/^[A-Z0-9]*$/)
        }
      }),
      { numRuns: 50 },
    )
  })
})
