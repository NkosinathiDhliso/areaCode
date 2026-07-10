/**
 * NodeEditorPanel photo surface: three-way rendering (deployment-parity R5.3).
 *
 * A photo surface must resolve to exactly one of:
 *   1. the image preview  - a media key exists AND VITE_CDN_URL is set
 *   2. "Photos unavailable" - a media key exists BUT VITE_CDN_URL is unset
 *   3. "Add business photo" - no media key at all
 *
 * The unavailable branch is the parity fix: an uploaded photo with no serving
 * base must never render a silent success-without-preview.
 */
// @vitest-environment jsdom
import { render, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Real mediaUrl + real PhotoUnavailable: the whole point is the true branch.
// Mock only the surrounding infrastructure.

vi.mock('@area-code/shared/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ items: [] }),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

// Stub the Mapbox address input to a bare field so no map SDK loads in jsdom.
vi.mock('../../../components/MapboxAddressInput', () => ({
  MapboxAddressInput: () => null,
}))

let mockStoreNodes: unknown[] = []

vi.mock('@area-code/shared/stores/businessStore', () => ({
  useBusinessStore: (selector?: (state: any) => any) => {
    const state = {
      nodes: mockStoreNodes,
      setNodes: (nodes: unknown[]) => {
        mockStoreNodes = nodes
      },
      setPanel: vi.fn(),
    }
    return selector ? selector(state) : state
  },
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────

function makeNode(overrides: Record<string, unknown>) {
  return {
    id: 'node-1',
    name: 'Test Venue',
    slug: 'test-venue',
    category: 'coffee',
    lat: -26.2041,
    lng: 28.0473,
    cityId: 'city-1',
    businessId: 'biz-123',
    claimStatus: 'claimed',
    nodeColour: '#FF5733',
    nodeIcon: null,
    qrCheckinEnabled: true,
    isVerified: true,
    isActive: true,
    headerImageKey: null,
    instagramHandle: null,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

async function renderPanel() {
  const { NodeEditorPanel } = await import('../NodeEditorPanel')
  const result = render(<NodeEditorPanel />)
  // Flush the mount + selected-seeding effects.
  await act(async () => {
    await Promise.resolve()
  })
  return result
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('VITE_MAPBOX_TOKEN', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  mockStoreNodes = []
})

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('NodeEditorPanel photo surface (R5.3)', () => {
  it('renders the image preview when a key is set and the CDN base is set', async () => {
    vi.stubEnv('VITE_CDN_URL', 'https://cdn.example.com')
    mockStoreNodes = [makeNode({ headerImageKey: 'images/node-1/header.jpg' })]

    const { container } = await renderPanel()

    const img = container.querySelector('img[alt="Header preview"]') as HTMLImageElement | null
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('https://cdn.example.com/images/node-1/header.jpg')
    expect(container.textContent).not.toContain('Photos unavailable')
    expect(container.textContent).not.toContain('Add business photo')
  })

  it('renders the "Photos unavailable" state when a key is present but the CDN base is unset', async () => {
    // No VITE_CDN_URL stub: the production "no CDN configured" case.
    mockStoreNodes = [makeNode({ headerImageKey: 'images/node-1/header.jpg' })]

    const { container } = await renderPanel()

    expect(container.querySelector('img[alt="Header preview"]')).toBeNull()
    expect(container.textContent).toContain('Photos unavailable')
    expect(container.textContent).not.toContain('Add business photo')
  })

  it('renders the "Add business photo" placeholder when there is no key', async () => {
    vi.stubEnv('VITE_CDN_URL', 'https://cdn.example.com')
    mockStoreNodes = [makeNode({ headerImageKey: null })]

    const { container } = await renderPanel()

    expect(container.querySelector('img[alt="Header preview"]')).toBeNull()
    expect(container.textContent).not.toContain('Photos unavailable')
    expect(container.textContent).toContain('Add business photo')
  })
})
