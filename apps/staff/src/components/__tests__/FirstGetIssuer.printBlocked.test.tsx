/**
 * First-Get issuer: print blocked, copy instead (proof-of-demand R15.18).
 *
 * `window.open` returns null under a popup blocker and in the in-app browsers
 * staff often have the portal open in. The old code returned silently, so the
 * staff member tapped Print, nothing happened, and the customer waited. The
 * token is already on screen, so the recovery is to say printing is blocked and
 * offer a copy action.
 *
 * Clipboard access is checked rather than assumed: `navigator.clipboard` is
 * absent on an insecure origin and in some webviews, and calling it blind throws.
 * When there is no clipboard the panel says so and the code stays readable.
 *
 * **Validates: Requirements 15.18**
 */
// @vitest-environment jsdom
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}))

vi.mock('@area-code/shared/lib/api', () => ({
  api: { get: mocks.apiGet, post: mocks.apiPost },
}))

import { CLIPBOARD_UNAVAILABLE_COPY } from '@area-code/shared/lib/clipboard'

import { FirstGetIssuer } from '../FirstGetIssuer'

const TOKEN = 'ABCD2345'
const BLOCKED_COPY = 'Printing is blocked in this browser. Copy the code instead.'

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, writable: true, configurable: true })
}

/** Renders the panel and issues a token, leaving it on the displayed phase. */
async function renderIssued(): Promise<HTMLElement> {
  mocks.apiGet.mockResolvedValue({
    reward: { rewardId: 'rw-1', title: 'Free coffee', description: 'On the house', nodeId: 'node-1' },
  })
  mocks.apiPost.mockResolvedValue({ token: TOKEN, expiresAt: '2026-08-09T22:30:00.000Z' })

  const { container } = render(<FirstGetIssuer />)
  await waitFor(() => expect(container.textContent).toContain('First-time customer?'))
  fireEvent.click(button(container, 'Issue token'))
  await waitFor(() => expect(container.textContent).toContain(TOKEN))
  return container
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(label))
  expect(found).toBeTruthy()
  return found as HTMLButtonElement
}

beforeEach(() => {
  mocks.apiGet.mockReset()
  mocks.apiPost.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FirstGetIssuer print blocked (R15.18)', () => {
  it('offers a copy action alongside Print as soon as a token is issued', async () => {
    const container = await renderIssued()
    expect(button(container, 'Copy code')).toBeTruthy()
    // Nothing is claimed about printing until Print is actually tried.
    expect(container.textContent).not.toContain(BLOCKED_COPY)
  })

  it('says printing is blocked when the print window cannot be opened', async () => {
    const container = await renderIssued()
    vi.spyOn(window, 'open').mockReturnValue(null)

    fireEvent.click(button(container, 'Print'))

    await waitFor(() => expect(container.textContent).toContain(BLOCKED_COPY))
    // The token is still on screen to copy or read out.
    expect(container.textContent).toContain(TOKEN)
    expect(button(container, 'Copy code')).toBeTruthy()
  })

  it('treats a window.open that throws the same as a blocked popup', async () => {
    const container = await renderIssued()
    vi.spyOn(window, 'open').mockImplementation(() => {
      throw new Error('not allowed in this webview')
    })

    fireEvent.click(button(container, 'Print'))

    await waitFor(() => expect(container.textContent).toContain(BLOCKED_COPY))
    expect(container.textContent).not.toContain('not allowed in this webview')
  })

  it('copies the token and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    const container = await renderIssued()

    fireEvent.click(button(container, 'Copy code'))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TOKEN))
    await waitFor(() => expect(container.textContent).toContain('Copied'))
  })

  it('says copy is unavailable rather than throwing when there is no clipboard', async () => {
    setClipboard(undefined)
    const container = await renderIssued()

    fireEvent.click(button(container, 'Copy code'))

    await waitFor(() => expect(container.textContent).toContain(CLIPBOARD_UNAVAILABLE_COPY))
    expect(container.textContent).toContain(TOKEN)
  })

  it('reports a rejected clipboard write instead of claiming success', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) })
    const container = await renderIssued()

    fireEvent.click(button(container, 'Copy code'))

    await waitFor(() => expect(container.textContent).toContain('Copy failed'))
    expect(container.textContent).not.toContain('Copied')
    expect(container.textContent).not.toContain('denied')
  })
})
