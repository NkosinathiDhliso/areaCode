/**
 * Clipboard access, the one home for every portal.
 *
 * `navigator.clipboard` is absent, not just restricted, on an insecure origin
 * and in some in-app webviews (the Instagram and Facebook browsers a consumer
 * arrives through, and older Android webviews). Calling it blind throws a
 * `TypeError` that reads as a crash, so every caller asks here first and gets a
 * result it can render honestly: the code stays on screen to read out or select
 * by hand.
 *
 * There is no `document.execCommand('copy')` fallback. It is deprecated, it
 * needs a live selection to work at all, and a silent second path that usually
 * fails is worse than telling the truth once.
 */

/** Shown when the platform has no clipboard to write to (R15.18, R15.22). */
export const CLIPBOARD_UNAVAILABLE_COPY = 'Copy not available here'

/** Shown when a clipboard exists but the write was rejected. */
export const CLIPBOARD_FAILED_COPY = 'Copy failed. Select the text and copy it by hand.'

export type ClipboardOutcome = 'copied' | 'unavailable' | 'failed'

/** True when this platform exposes an async clipboard we can write to. */
export function hasClipboard(): boolean {
  if (typeof navigator === 'undefined') return false
  const clipboard = (navigator as Navigator & { clipboard?: { writeText?: unknown } }).clipboard
  return typeof clipboard?.writeText === 'function'
}

/**
 * Write text to the clipboard, reporting what actually happened.
 *
 * `unavailable` means there is no clipboard API (show
 * `CLIPBOARD_UNAVAILABLE_COPY`); `failed` means the write was rejected, usually
 * a permission or focus problem (show `CLIPBOARD_FAILED_COPY`). Never throws, so
 * a copy button cannot take a screen down.
 */
export async function copyToClipboard(text: string): Promise<ClipboardOutcome> {
  if (!hasClipboard()) return 'unavailable'
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}

/** The message for an outcome, or `null` when the copy succeeded. */
export function clipboardFailureCopy(outcome: ClipboardOutcome): string | null {
  if (outcome === 'copied') return null
  return outcome === 'unavailable' ? CLIPBOARD_UNAVAILABLE_COPY : CLIPBOARD_FAILED_COPY
}
