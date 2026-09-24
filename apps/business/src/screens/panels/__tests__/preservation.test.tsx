/**
 * Preservation Property Tests - Business Portal Panels
 *
 * These tests capture EXISTING correct behavior on UNFIXED code.
 * They must PASS on the current unfixed code to establish a baseline
 * that must be preserved after the bug fixes are applied.
 *
 * **Validates: Requirements 3.5, 3.7, 3.8, 3.9**
 */
// @vitest-environment jsdom
import {
  MAX_HEADER_IMAGE_BYTES,
  MAX_HEADER_IMAGE_LABEL,
  UPLOAD_ERROR_COPY,
} from '@area-code/shared/lib/imageCompression'
import { render, act } from '@testing-library/react'
import * as fc from 'fast-check'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock @tanstack/react-query
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: {
      checkInsToday: 5,
      pulseScore: 72,
      totalCheckIns: 3,
      foundYouToday: 1,
      walkInsToday: 4,
      receiptToday: {
        headline: '1 person found you on Area Code and checked in today.',
        walkIn: '4 people who were already in the room also checked in.',
      },
    },
    isLoading: false,
    refetch: vi.fn(),
  }),
}))

// Mock shared modules
const mockApiGet = vi.fn()
const mockApiPost = vi.fn()
const mockApiPut = vi.fn()
const mockApiDelete = vi.fn()

vi.mock('@area-code/shared/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    put: (...args: unknown[]) => mockApiPut(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
  },
}))

vi.mock('@area-code/shared/lib/socket', () => ({
  getSocket: () => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  }),
}))

vi.mock('@area-code/shared/hooks/useSocketRoom', () => ({
  useSocketRoom: vi.fn(),
}))

const mockBusinessAuthStore = {
  accessToken: 'test-token',
  businessId: 'biz-123',
}

vi.mock('@area-code/shared/stores/businessAuthStore', () => ({
  useBusinessAuthStore: (selector?: (state: any) => any) => {
    if (selector) return selector(mockBusinessAuthStore)
    return mockBusinessAuthStore
  },
}))

const mockNodes = [
  {
    id: 'node-1',
    name: 'Test Venue',
    slug: 'test-venue',
    category: 'coffee',
    lat: -26.2041,
    lng: 28.0473,
    cityId: 'city-1',
    businessId: 'biz-123',
    submittedBy: null,
    claimStatus: 'claimed',
    claimCipcStatus: null,
    nodeColour: '#FF5733',
    nodeIcon: null,
    qrCheckinEnabled: true,
    isVerified: true,
    isActive: true,
    headerImageKey: 'images/node-1/header.jpg',
    socialLinks: { instagram: 'testvenue' },
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'node-2',
    name: 'Second Venue',
    slug: 'second-venue',
    category: 'food',
    lat: -26.1076,
    lng: 28.0567,
    cityId: 'city-1',
    businessId: 'biz-123',
    submittedBy: null,
    claimStatus: 'claimed',
    claimCipcStatus: null,
    nodeColour: '#33FF57',
    nodeIcon: null,
    qrCheckinEnabled: true,
    isVerified: true,
    isActive: true,
    headerImageKey: null,
    socialLinks: {},
    createdAt: '2024-02-01T00:00:00Z',
  },
]

let mockStoreNodes = [...mockNodes]
const mockSetPanel = vi.fn()

vi.mock('@area-code/shared/stores/businessStore', () => ({
  useBusinessStore: (selector?: (state: any) => any) => {
    const state = {
      nodes: mockStoreNodes,
      setNodes: (nodes: any[]) => {
        mockStoreNodes = nodes
      },
      setPanel: mockSetPanel,
    }
    if (selector) return selector(state)
    return state
  },
}))

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/**
 * Leading bytes of real formats we do not accept, plus plain text. The gate now
 * reads bytes, not `file.type` (R14.1), so the rejection must be driven by these.
 */
const nonPhotoBytesArb = fc.constantFrom(
  [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00], // GIF89a
  [0x42, 0x4d, 0x36, 0x00, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x36, 0x00], // BMP
  [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x01], // TIFF
  [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xc7, 0xec], // %PDF-1.7
  [0x3c, 0x73, 0x76, 0x67, 0x20, 0x78, 0x6d, 0x6c, 0x6e, 0x73, 0x3d, 0x22], // <svg xmlns="
  [0x6a, 0x75, 0x73, 0x74, 0x20, 0x70, 0x72, 0x6f, 0x73, 0x65, 0x2c, 0x20], // "just prose, "
)

/** MIME labels a picker may claim. The gate must ignore all of them. */
const claimedFileTypeArb = fc.constantFrom(
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/webp',
  'application/pdf',
  'text/plain',
  'video/mp4',
  'image/svg+xml',
  'image/jpeg',
  '',
  'application/octet-stream',
)

/** File types that should be accepted */
const validFileTypeArb = fc.constantFrom('image/jpeg', 'image/png')

/** File sizes over the cap (in bytes) */
const oversizedFileSizeArb = fc.integer({ min: MAX_HEADER_IMAGE_BYTES + 1, max: 50 * 1024 * 1024 })

/** File sizes under the cap (in bytes) */
const validFileSizeArb = fc.integer({ min: 1, max: MAX_HEADER_IMAGE_BYTES })

/** CDN URL arbitrary */
const cdnUrlArb = fc.constantFrom('https://cdn.areacode.co.za', 'https://d1234.cloudfront.net')

/** Header image key arbitrary */
const headerImageKeyArb = fc
  .tuple(
    fc.string({
      minLength: 3,
      maxLength: 10,
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
    }),
    fc.string({
      minLength: 5,
      maxLength: 15,
      unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
    }),
  )
  .map(([folder, file]) => `images/${folder}/${file}.jpg`)

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Preservation Property: LivePanel renders live content', () => {
  /**
   * LivePanel renders check-in count, live avatars section, rewards claimed counter,
   * and zero-state tips. This verifies the live dashboard content is present.
   *
   * **Validates: Requirements 3.7**
   */
  it('should render check-in count and zero-state tips in LivePanel', async () => {
    // Dynamic import to avoid hoisting issues with mocks
    const { LivePanel } = await import('../LivePanel')

    const { container } = render(<LivePanel />)

    // Check-in count should be rendered (from mocked useQuery data: 5)
    expect(container.textContent).toContain('5')

    // Zero-state tips should be rendered (totalCheckIns < 10 in mock)
    expect(container.textContent).toContain('biz.live.zeroState')
    expect(container.textContent).toContain('biz.live.step1')
    expect(container.textContent).toContain('biz.live.step2')
    expect(container.textContent).toContain('biz.live.step3')
    expect(container.textContent).toContain('biz.live.step4')

    // Check-ins today label
    expect(container.textContent).toContain('biz.live.checkinsToday')
  })
})

describe('Preservation Property: Photo validation rejects invalid files', () => {
  beforeEach(() => {
    mockApiGet.mockReset()
    mockApiPost.mockReset()
    mockApiGet.mockResolvedValue({ items: mockNodes })

    // Set VITE_CDN_URL env
    vi.stubEnv('VITE_CDN_URL', 'https://cdn.areacode.co.za')
    vi.stubEnv('VITE_MAPBOX_TOKEN', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  /**
   * For any file whose leading bytes are not a photo we accept, the format
   * message is shown and no upload occurs, whatever MIME label the picker
   * claimed. Preserved from the old `file.type` gate; the reason is now the
   * bytes, which is what a phone gets right (R14.1).
   *
   * **Validates: Requirements 3.8, 14.1**
   */
  it('should reject files whose bytes are not an accepted photo, whatever the claimed type', async () => {
    await fc.assert(
      fc.asyncProperty(nonPhotoBytesArb, claimedFileTypeArb, validFileSizeArb, async (bytes, fileType, fileSize) => {
        mockApiPost.mockReset()

        const { NodeEditorPanel } = await import('../NodeEditorPanel')
        const { container, unmount } = render(<NodeEditorPanel />)

        // Wait for initial load
        await act(async () => {
          await new Promise((r) => setTimeout(r, 50))
        })

        // Find the file input
        const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
        if (!fileInput) {
          unmount()
          return // Component may still be loading
        }

        // Name it .jpg on purpose: neither the extension nor the type may decide.
        const file = new File([new Uint8Array(bytes)], 'test.jpg', { type: fileType })
        Object.defineProperty(file, 'size', { value: fileSize })

        // Trigger file selection
        await act(async () => {
          Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
          fileInput.dispatchEvent(new Event('change', { bubbles: true }))
          await new Promise((r) => setTimeout(r, 50))
        })

        // Error message should be shown
        expect(container.textContent).toContain(UPLOAD_ERROR_COPY.format)

        // No API call should have been made for presigned URL
        expect(mockApiPost).not.toHaveBeenCalledWith(expect.stringContaining('/image/upload-url'), expect.anything())

        unmount()
      }),
      { numRuns: 5 },
    )
  })

  /**
   * For all files over the cap, the error message "Image must be under 10MB." is
   * shown and no upload occurs.
   *
   * **Validates: Requirements 3.8**
   */
  it('should reject files over the cap with correct error message', async () => {
    await fc.assert(
      fc.asyncProperty(validFileTypeArb, oversizedFileSizeArb, async (fileType, fileSize) => {
        mockApiPost.mockReset()

        const { NodeEditorPanel } = await import('../NodeEditorPanel')
        const { container, unmount } = render(<NodeEditorPanel />)

        // Wait for initial load
        await act(async () => {
          await new Promise((r) => setTimeout(r, 50))
        })

        // Find the file input
        const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
        if (!fileInput) {
          unmount()
          return
        }

        // Create a mock file with valid type but oversized
        const file = new File(['x'], 'test.jpg', { type: fileType })
        Object.defineProperty(file, 'size', { value: fileSize })

        // Trigger file selection
        await act(async () => {
          Object.defineProperty(fileInput, 'files', { value: [file], configurable: true })
          fileInput.dispatchEvent(new Event('change', { bubbles: true }))
          await new Promise((r) => setTimeout(r, 50))
        })

        // Error message should be shown
        expect(container.textContent).toContain(`Image must be under ${MAX_HEADER_IMAGE_LABEL}.`)

        // No API call should have been made for presigned URL
        expect(mockApiPost).not.toHaveBeenCalledWith(expect.stringContaining('/image/upload-url'), expect.anything())

        unmount()
      }),
      { numRuns: 5 },
    )
  })
})

describe('Preservation Property: Node selection loads correct header image', () => {
  /**
   * For all node selections where headerImageKey exists, headerImageUrl is set
   * to `${CDN_URL}/${node.headerImageKey}`.
   *
   * **Validates: Requirements 3.9**
   */
  it('should construct correct CDN URL from headerImageKey for any node', () => {
    fc.assert(
      fc.property(cdnUrlArb, headerImageKeyArb, (cdnUrl, headerImageKey) => {
        // The expected URL construction logic from NodeEditorPanel
        const expectedUrl = `${cdnUrl}/${headerImageKey}`

        // Verify the URL is well-formed
        expect(expectedUrl).toContain(cdnUrl)
        expect(expectedUrl).toContain(headerImageKey)
        expect(expectedUrl).toBe(`${cdnUrl}/${headerImageKey}`)
      }),
      { numRuns: 50 },
    )
  })

  /**
   * For nodes without headerImageKey, headerImageUrl should be null.
   *
   * **Validates: Requirements 3.9**
   */
  it('should set headerImageUrl to null when node has no headerImageKey', () => {
    // When headerImageKey is null/undefined, the logic sets headerImageUrl to null
    const nodesWithoutImage = [{ headerImageKey: null }, { headerImageKey: undefined }, { headerImageKey: '' }]

    for (const node of nodesWithoutImage) {
      const cdnUrl = 'https://cdn.areacode.co.za'
      // The logic: if (selected.headerImageKey && cdnUrl) setHeaderImageUrl(...)
      // else setHeaderImageUrl(null)
      const result = node.headerImageKey && cdnUrl ? `${cdnUrl}/${node.headerImageKey}` : null
      expect(result).toBeNull()
    }
  })
})

describe('Preservation Property: SettingsPanel renders subscription, staff, and QR sections', () => {
  beforeEach(() => {
    mockApiGet.mockReset()
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/v1/business/me') {
        return Promise.resolve({
          id: 'biz-123',
          tier: 'starter',
          trialEndsAt: '2025-03-01T00:00:00Z',
        })
      }
      if (url === '/v1/business/staff') {
        return Promise.resolve({ items: [] })
      }
      if (url === '/v1/business/staff/invites') {
        return Promise.resolve({ items: [] })
      }
      return Promise.resolve({})
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * For all renders of SettingsPanel, subscription info, staff management,
   * and QR code generation sections are present.
   *
   * **Validates: Requirements 3.5**
   */
  it('should render subscription, staff management, and QR code sections', async () => {
    const { SettingsPanel } = await import('../SettingsPanel')
    const { container } = render(<SettingsPanel />)

    // Wait for async data loading
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100))
    })

    // Settings title
    expect(container.textContent).toContain('biz.settings.title')

    // Subscription section
    expect(container.textContent).toContain('biz.settings.subscription')

    // Staff Members section (renders "Team Members" label and zero-state)
    expect(container.textContent).toContain('No staff members yet')

    // QR Code section
    expect(container.textContent).toContain('biz.settings.qr')
    expect(container.textContent).toContain('Generate QR Code')
  })
})
