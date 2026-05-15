/**
 * Bug Condition Exploration Tests - LivePanel & NodeEditorPanel
 *
 * These tests encode the EXPECTED (correct) behavior for bugs 2 and 3.
 * They are expected to FAIL on unfixed code, proving the bugs exist.
 *
 * Validates: Requirements 1.3, 1.4, 1.5, 1.6
 */
// @vitest-environment jsdom
import { render, act, waitFor as _waitFor, fireEvent } from '@testing-library/react'
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
    data: { checkInsToday: 5, pulseScore: 80, totalCheckIns: 100 },
    isLoading: false,
  }),
}))

// Mock shared modules
vi.mock('@area-code/shared/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ items: [] }),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
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

vi.mock('@area-code/shared/stores/businessAuthStore', () => ({
  useBusinessAuthStore: () => ({
    accessToken: 'mock-token',
    businessId: 'mock-biz-id',
  }),
}))

vi.mock('@area-code/shared/stores/businessStore', () => ({
  useBusinessStore: (selector?: (s: any) => any) => {
    const state = {
      nodes: [
        {
          id: 'node-1',
          name: 'Test Venue',
          category: 'coffee',
          lat: -26.2041,
          lng: 28.0473,
          headerImageKey: null,
          claimStatus: 'claimed',
          instagramHandle: null,
        },
      ],
      setNodes: vi.fn(),
      setPanel: vi.fn(),
    }
    if (selector) return selector(state)
    return state
  },
}))

describe('Bug Condition Exploration - NodeEditorPanel in LivePanel (Test 1c)', () => {
  /**
   * Test 1c: NodeEditorPanel in LivePanel
   *
   * When the user navigates to the Live panel, NodeEditorPanel should NOT
   * be present in the render tree.
   *
   * EXPECTED BEHAVIOR (what the fix should achieve):
   * LivePanel renders only live/real-time content (check-in count, avatars,
   * rewards claimed, zero-state tips) without NodeEditorPanel.
   *
   * ON UNFIXED CODE: This test FAILS because NodeEditorPanel IS rendered
   * inside LivePanel (imported on line 11, rendered on line 80).
   *
   * **Validates: Requirements 1.3**
   */
  it('LivePanel should NOT render NodeEditorPanel or venue configuration UI', async () => {
    // Dynamic import to ensure mocks are applied
    const { LivePanel } = await import('../LivePanel')

    let container: HTMLElement
    await act(async () => {
      const result = render(<LivePanel />)
      container = result.container
      // Wait for any async effects
      await new Promise((r) => setTimeout(r, 50))
    })

    // EXPECTED: No venue editing UI should be present in LivePanel
    // NodeEditorPanel renders "Your Venue" heading, venue name input, category dropdown, etc.

    // Check that "Your Venue" heading (from NodeEditorPanel) is NOT present
    expect(container!.textContent).not.toContain('Your Venue')

    // Check that venue editing inputs are NOT present
    const inputs = container!.querySelectorAll('input[placeholder="Node name"]')
    expect(inputs.length).toBe(0)

    // Check that category select (from NodeEditorPanel) is NOT present
    const selects = container!.querySelectorAll('select')
    let hasCategorySelect = false
    selects.forEach((select) => {
      const options = select.querySelectorAll('option')
      options.forEach((opt) => {
        if (opt.value === 'coffee' || opt.value === 'nightlife') {
          hasCategorySelect = true
        }
      })
    })
    expect(hasCategorySelect).toBe(false)

    // Check that "Add Photo" button (from NodeEditorPanel) is NOT present
    const buttons = container!.querySelectorAll('button')
    let hasAddPhotoButton = false
    buttons.forEach((btn) => {
      if (btn.textContent?.includes('Add Photo')) {
        hasAddPhotoButton = true
      }
    })
    expect(hasAddPhotoButton).toBe(false)
  })
})

describe('Bug Condition Exploration - Photo Preview Not Updating (Test 1d)', () => {
  beforeEach(() => {
    // Set VITE_CDN_URL environment variable
    vi.stubEnv('VITE_CDN_URL', 'https://cdn.example.com')

    // Mock fetch for S3 PUT
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  /**
   * Test 1d: Photo Preview Not Updating
   *
   * After a successful photo upload (presigned URL → S3 PUT → register image),
   * headerImageUrl state should be updated to `${VITE_CDN_URL}/${s3Key}`.
   *
   * EXPECTED BEHAVIOR (what the fix should achieve):
   * headerImageUrl is immediately updated with the CDN URL + s3Key after
   * successful upload, causing the preview to display the new image.
   *
   * ON UNFIXED CODE: This test FAILS because handlePhotoSelected never calls
   * setHeaderImageUrl after upload, so headerImageUrl remains null.
   *
   * **Validates: Requirements 1.4, 1.5, 1.6**
   */
  it('should update headerImageUrl after successful photo upload', async () => {
    const mockS3Key = 'nodes/node-1/images/test-photo-123.jpg'
    const expectedCdnUrl = `https://cdn.example.com/${mockS3Key}`

    // Mock the api module with specific responses for the upload flow
    const { api } = await import('@area-code/shared/lib/api')
    const mockApi = vi.mocked(api)

    // Mock presigned URL response
    mockApi.post.mockImplementation(async (url: string, _body?: any) => {
      if (url.includes('/image/upload-url')) {
        return {
          uploadUrl: 'https://s3.amazonaws.com/bucket/presigned-upload-url',
          objectKey: mockS3Key,
        }
      }
      if (url.includes('/images')) {
        return { success: true }
      }
      return {}
    })

    // Mock nodes fetch
    mockApi.get.mockResolvedValue({
      items: [
        {
          id: 'node-1',
          name: 'Test Venue',
          category: 'coffee',
          lat: -26.2041,
          lng: 28.0473,
          headerImageKey: null,
          claimStatus: 'claimed',
          instagramHandle: null,
        },
      ],
    })

    const { NodeEditorPanel } = await import('../NodeEditorPanel')

    let container: HTMLElement
    await act(async () => {
      const result = render(<NodeEditorPanel />)
      container = result.container
      // Wait for initial load
      await new Promise((r) => setTimeout(r, 100))
    })

    // Find the hidden file input
    const fileInput = container!.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).not.toBeNull()

    // Create a mock file
    const mockFile = new File(['fake-image-data'], 'test-photo.jpg', {
      type: 'image/jpeg',
    })

    // Simulate file selection
    await act(async () => {
      // Trigger the onChange event with a mock file
      Object.defineProperty(fileInput, 'files', {
        value: [mockFile],
        writable: true,
      })
      fireEvent.change(fileInput)
      // Wait for the async upload flow to complete
      await new Promise((r) => setTimeout(r, 200))
    })

    // EXPECTED: After successful upload, the header image preview should be visible
    // with the CDN URL + s3Key
    // On unfixed code, headerImageUrl is never updated, so no <img> with the CDN URL appears

    // Look for an img element with the expected CDN URL
    const headerImg = container!.querySelector(`img[src="${expectedCdnUrl}"]`)
    expect(headerImg).not.toBeNull()

    // Alternative check: verify the alt text "Header preview" img has correct src
    const previewImg = container!.querySelector('img[alt="Header preview"]')
    expect(previewImg).not.toBeNull()
    expect(previewImg?.getAttribute('src')).toBe(expectedCdnUrl)
  })
})
