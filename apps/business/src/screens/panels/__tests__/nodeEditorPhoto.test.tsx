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
import { api } from '@area-code/shared/lib/api'
import { UPLOAD_ERROR_COPY } from '@area-code/shared/lib/imageCompression'
import { render, act, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks ──────────────────────────────────────────────────────────────────

// The CDN base comes from `import.meta.env.VITE_CDN_URL`, which Vite/Vitest
// inline statically (vi.stubEnv can't drive it). Route mediaUrl through the
// real join logic (buildMediaUrl) with a test-controlled base instead.
const mediaMock = vi.hoisted(() => ({ cdnBase: null as string | null }))
vi.mock('@area-code/shared/lib/mediaUrl', async (importActual) => {
  const actual = await importActual<typeof import('@area-code/shared/lib/mediaUrl')>()
  return {
    ...actual,
    mediaUrl: (key: string | null | undefined) => actual.buildMediaUrl(mediaMock.cdnBase, key),
  }
})

// Real PhotoUnavailable: the whole point is the true branch. Mock only the
// surrounding infrastructure.

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
    socialLinks: {},
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
  mediaMock.cdnBase = null
  vi.mocked(api.post).mockReset()
  vi.mocked(api.get).mockResolvedValue({ items: [] })
})

afterEach(() => {
  vi.unstubAllEnvs()
  mockStoreNodes = []
  mediaMock.cdnBase = null
})

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('NodeEditorPanel photo surface (R5.3)', () => {
  it('renders the image preview when a key is set and the CDN base is set', async () => {
    mediaMock.cdnBase = 'https://cdn.example.com'
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
    mediaMock.cdnBase = 'https://cdn.example.com'
    mockStoreNodes = [makeNode({ headerImageKey: null })]

    const { container } = await renderPanel()

    expect(container.querySelector('img[alt="Header preview"]')).toBeNull()
    expect(container.textContent).not.toContain('Photos unavailable')
    expect(container.textContent).toContain('Add business photo')
  })
})

/**
 * The photo gate reads the file's leading bytes, never `file.type` (R14.1).
 *
 * jsdom has no `URL.createObjectURL`, so `compressImageFile` always throws an
 * `ImageDecodeError` here. That is exactly what makes the three cases separable
 * without mocking compression: a file rejected by the gate never reaches the
 * decode, and a file that does reach it gets copy chosen by the sniffed format.
 */
describe('NodeEditorPanel photo gate (R14.1, R14.5, R14.7)', () => {
  const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0))
  const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF')]
  const HEIC = [0x00, 0x00, 0x00, 0x20, ...ascii('ftypheic'), 0x00, 0x00, 0x00, 0x00]

  async function selectFile(bytes: number[], name: string, type: string) {
    mockStoreNodes = [makeNode({ headerImageKey: null })]
    const { container } = await renderPanel()
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array(bytes)], name, { type })
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true })
      fireEvent.change(input)
      await new Promise((r) => setTimeout(r, 20))
    })
    return container
  }

  it('accepts image/* so a phone picker offers the whole camera roll', async () => {
    mockStoreNodes = [makeNode({ headerImageKey: null })]
    const { container } = await renderPanel()
    const input = container.querySelector('input[type="file"]')
    expect(input?.getAttribute('accept')).toBe('image/*')
  })

  it('rejects a non-image by its bytes even when it is named .jpg and typed image/jpeg', async () => {
    const container = await selectFile(ascii('just prose, not a photo'), 'notes.jpg', 'image/jpeg')

    expect(container.textContent).toContain(UPLOAD_ERROR_COPY.format)
    expect(vi.mocked(api.post)).not.toHaveBeenCalled()
  })

  it('accepts a JPEG whose picker reported an empty type', async () => {
    const container = await selectFile(JPEG, 'IMG_0001.jpg', '')

    // Past the gate: the failure is the jsdom decode, not the format rejection.
    expect(container.textContent).not.toContain(UPLOAD_ERROR_COPY.format)
    expect(container.textContent).toContain(UPLOAD_ERROR_COPY.decode)
  })

  it('tells a HEIC owner to switch to Most Compatible rather than showing a DOMException', async () => {
    const container = await selectFile(HEIC, 'IMG_0002.jpg', 'image/jpeg')

    expect(container.textContent).toContain(UPLOAD_ERROR_COPY['heic-decode'])
    expect(container.textContent).toContain('Most Compatible')
    expect(container.textContent).not.toContain('DOMException')
  })
})

/**
 * No server text on screen (R15.13, task 15.4).
 *
 * The delete-photo handler was the last place in this panel that wrote the
 * caught error's message straight into owner-facing copy. A 5xx body must never
 * reach the UI: the owner reads the approved line, and the server's words stay
 * in CloudWatch.
 */
describe('NodeEditorPanel delete photo error copy (R15.13)', () => {
  const SERVER_BODY = 'Internal server error: DynamoDB ProvisionedThroughputExceededException'

  async function clickRemove(rejection: unknown) {
    mediaMock.cdnBase = 'https://cdn.example.com'
    mockStoreNodes = [makeNode({ headerImageKey: 'images/node-1/header.jpg' })]
    vi.mocked(api.delete).mockRejectedValue(rejection)

    const { container } = await renderPanel()
    const remove = Array.from(container.querySelectorAll('[role="button"]')).find(
      (el) => (el.textContent ?? '').trim() === 'Remove',
    )
    expect(remove).toBeTruthy()
    await act(async () => {
      fireEvent.click(remove!)
      await new Promise((r) => setTimeout(r, 20))
    })
    return container
  }

  it('never renders a 5xx message body', async () => {
    const container = await clickRemove({ statusCode: 500, error: 'INTERNAL', message: SERVER_BODY })

    expect(container.textContent).not.toContain(SERVER_BODY)
    expect(container.textContent).not.toContain('DynamoDB')
    expect(container.textContent).toContain('Something went wrong on our side')
  })

  it('names the cause for a failure it can name, and keeps the photo on screen', async () => {
    const container = await clickRemove({ statusCode: 403, error: 'FORBIDDEN', message: 'principal not permitted' })

    expect(container.textContent).not.toContain('principal not permitted')
    expect(container.textContent).toContain("You don't have permission to do that.")
    expect(container.querySelector('img[alt="Header preview"]')).not.toBeNull()
  })
})
