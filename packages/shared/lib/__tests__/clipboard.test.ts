/**
 * Clipboard access outcomes (proof-of-demand R15.18, and reused by R15.22).
 *
 * `navigator.clipboard` is absent, not merely restricted, on an insecure origin
 * and in several in-app webviews. The helper reports which of the three things
 * happened so a caller can say "copy is not available here" instead of throwing
 * a `TypeError` at a staff member holding a phone.
 *
 * **Validates: Requirements 15.18**
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'

import {
  CLIPBOARD_FAILED_COPY,
  CLIPBOARD_UNAVAILABLE_COPY,
  clipboardFailureCopy,
  copyToClipboard,
  hasClipboard,
} from '../clipboard'

function setClipboard(value: unknown): void {
  Object.defineProperty(navigator, 'clipboard', { value, writable: true, configurable: true })
}

afterEach(() => {
  setClipboard(undefined)
})

describe('clipboard availability', () => {
  it('reports no clipboard when the API is absent', () => {
    setClipboard(undefined)
    expect(hasClipboard()).toBe(false)
  })

  it('reports no clipboard when writeText is missing', () => {
    setClipboard({})
    expect(hasClipboard()).toBe(false)
  })

  it('reports a clipboard when writeText is callable', () => {
    setClipboard({ writeText: vi.fn() })
    expect(hasClipboard()).toBe(true)
  })
})

describe('copyToClipboard', () => {
  it('copies and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    await expect(copyToClipboard('ABCD2345')).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledWith('ABCD2345')
  })

  it('reports unavailable without calling anything when there is no clipboard', async () => {
    setClipboard(undefined)
    await expect(copyToClipboard('ABCD2345')).resolves.toBe('unavailable')
  })

  it('reports a rejected write as failed rather than throwing', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) })
    await expect(copyToClipboard('ABCD2345')).resolves.toBe('failed')
  })
})

describe('clipboardFailureCopy', () => {
  it('has no message for a successful copy', () => {
    expect(clipboardFailureCopy('copied')).toBeNull()
  })

  it('distinguishes an absent clipboard from a rejected write', () => {
    expect(clipboardFailureCopy('unavailable')).toBe(CLIPBOARD_UNAVAILABLE_COPY)
    expect(clipboardFailureCopy('failed')).toBe(CLIPBOARD_FAILED_COPY)
  })

  it('never renders technical text', () => {
    for (const copy of [CLIPBOARD_UNAVAILABLE_COPY, CLIPBOARD_FAILED_COPY]) {
      expect(copy).not.toMatch(/DOMException|TypeError|navigator|undefined/)
    }
  })
})
