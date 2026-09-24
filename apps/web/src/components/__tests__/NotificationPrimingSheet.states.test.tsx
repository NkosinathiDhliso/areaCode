// @vitest-environment jsdom
/**
 * `NotificationPrimingSheet` honest states (proof-of-demand task 16.2, R15.20).
 *
 * Validates: Requirements 15.20
 *
 * The sheet asks for one thing, so it has to be exact about what it got. Every
 * Web Push outcome that is not `subscribed` means nothing will reach this
 * person, and the sheet may never close as though it worked
 * (`honest-presence.md`, R15.20):
 *
 *  - iOS Safari outside an installed PWA has no `PushManager`, so instead of an
 *    Enable button that cannot work it gets the one step that does: Add to Home
 *    Screen
 *  - a missing VAPID key (`not_configured`) is a deploy gap, shown as an error
 *    and not offered as a user choice
 *  - permission granted but subscribe threw (`failed`) is an error with a retry,
 *    never a claim that notifications are on
 *  - `denied` cannot be re-prompted by the browser, so the copy points at site
 *    settings and no retry is offered
 *
 * The shared Web Push helper is mocked because it needs real browser APIs; its
 * own iOS detection is covered in `packages/shared/lib/__tests__/webPush.test.ts`.
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key) }),
}))

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  enableWebPush: vi.fn(),
  isWebPushSupported: vi.fn(),
  needsHomeScreenInstall: vi.fn(),
}))

vi.mock('@area-code/shared/lib/api', () => ({
  api: { get: mocks.get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

vi.mock('@area-code/shared/lib/webPush', () => ({
  enableWebPush: mocks.enableWebPush,
  isWebPushSupported: mocks.isWebPushSupported,
  needsHomeScreenInstall: mocks.needsHomeScreenInstall,
}))

import { NotificationPrimingSheet } from '../NotificationPrimingSheet'

const onClose = vi.fn()

function sheet() {
  return render(<NotificationPrimingSheet isOpen onClose={onClose} lat={-26.2} lng={28.05} userId="user-1" />)
}

function enableButton(): HTMLButtonElement | null {
  return document.querySelector('[data-priming-enable]') as HTMLButtonElement | null
}

function errorText(): string {
  return document.querySelector('[data-priming-error]')?.textContent ?? ''
}

function installText(): string {
  return document.querySelector('[data-priming-install]')?.textContent ?? ''
}

function dismissText(): string {
  return document.querySelector('[data-priming-dismiss]')?.textContent ?? ''
}

/** Render, wait for the nearby fetch to settle, then tap Enable. */
async function tapEnable(): Promise<void> {
  sheet()
  await waitFor(() => expect(enableButton()).not.toBeNull())
  fireEvent.click(enableButton() as HTMLButtonElement)
}

beforeEach(() => {
  onClose.mockReset()
  mocks.get.mockReset().mockResolvedValue({ event: null })
  mocks.enableWebPush.mockReset().mockResolvedValue('subscribed')
  mocks.isWebPushSupported.mockReset().mockReturnValue(true)
  mocks.needsHomeScreenInstall.mockReset().mockReturnValue(false)
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
})

// ─── Cannot subscribe here at all ────────────────────────────────────────────

describe('iOS Safari outside an installed PWA gets the Home Screen step (R15.20)', () => {
  beforeEach(() => {
    mocks.needsHomeScreenInstall.mockReturnValue(true)
    mocks.isWebPushSupported.mockReturnValue(false)
  })

  it('says how to get notifications instead of closing silently', async () => {
    sheet()

    await waitFor(() => expect(installText()).toContain('Add Area Code to your Home Screen to get notifications'))
    expect(installText()).toContain('Add to Home Screen')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('offers no Enable button, because no permission prompt could work', async () => {
    sheet()

    await waitFor(() => expect(installText()).not.toBe(''))
    expect(enableButton()).toBeNull()
    expect(mocks.enableWebPush).not.toHaveBeenCalled()
  })

  it('shows the instruction as an instruction, not as a browser error', async () => {
    sheet()

    await waitFor(() => expect(installText()).not.toBe(''))
    expect(errorText()).toBe('')
    expect(dismissText()).toBe('Got it')
  })
})

describe('a browser with no Web Push at all is told plainly (R15.20)', () => {
  it('shows an error and no dead Enable button', async () => {
    mocks.isWebPushSupported.mockReturnValue(false)
    sheet()

    await waitFor(() => expect(errorText()).toBe('This browser cannot show notifications.'))
    expect(document.querySelector('[data-priming-error]')?.getAttribute('role')).toBe('alert')
    expect(enableButton()).toBeNull()
    expect(installText()).toBe('')
  })
})

// ─── Outcomes after the tap ──────────────────────────────────────────────────

describe('a missing VAPID key is an error, never a success (R15.20)', () => {
  beforeEach(() => {
    mocks.enableWebPush.mockResolvedValue('not_configured')
  })

  it('stays open and says notifications are not set up', async () => {
    await tapEnable()

    await waitFor(() =>
      expect(errorText()).toBe('Notifications are not set up in this build, so we could not turn them on.'),
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('offers no retry, because a deploy fixes it and a second tap cannot', async () => {
    await tapEnable()

    await waitFor(() => expect(errorText()).not.toBe(''))
    expect(enableButton()).toBeNull()
    expect(mocks.enableWebPush).toHaveBeenCalledTimes(1)
  })
})

describe('a subscribe failure is an error, never "notifications on" (R15.20)', () => {
  beforeEach(() => {
    mocks.enableWebPush.mockResolvedValue('failed')
  })

  it('says nothing changed and keeps the sheet open', async () => {
    await tapEnable()

    await waitFor(() => expect(errorText()).toContain('We could not turn notifications on'))
    expect(errorText()).toContain('Nothing changed')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('offers a retry, since the next attempt can genuinely succeed', async () => {
    await tapEnable()

    await waitFor(() => expect(enableButton()?.textContent).toBe('Try again'))

    mocks.enableWebPush.mockResolvedValue('subscribed')
    fireEvent.click(enableButton() as HTMLButtonElement)

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('treats a thrown helper the same way: an error, not a silent close', async () => {
    mocks.enableWebPush.mockRejectedValue(new Error('offline'))
    await tapEnable()

    await waitFor(() => expect(errorText()).toContain('We could not turn notifications on'))
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('a denied permission points at site settings (R15.20)', () => {
  beforeEach(() => {
    mocks.enableWebPush.mockResolvedValue('denied')
  })

  it('says where to turn them back on, because the browser will not ask again', async () => {
    await tapEnable()

    await waitFor(() => expect(errorText()).toContain('blocked for this site'))
    expect(errorText()).toContain('site settings')
  })

  it('offers no retry that the browser would ignore', async () => {
    await tapEnable()

    await waitFor(() => expect(errorText()).not.toBe(''))
    expect(enableButton()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('only a real subscription closes the sheet (R15.20)', () => {
  it('closes with no error when the browser subscribed', async () => {
    await tapEnable()

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(errorText()).toBe('')
  })

  it('defers for later when the consumer says not now', async () => {
    sheet()
    await waitFor(() => expect(dismissText()).toBe('Not now'))

    fireEvent.click(document.querySelector('[data-priming-dismiss]') as HTMLButtonElement)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem('notif:deferred:user-1')).not.toBeNull()
    expect(mocks.enableWebPush).not.toHaveBeenCalled()
  })
})

// ─── Touch targets ───────────────────────────────────────────────────────────

describe('both controls stay tappable (code-style 44px)', () => {
  it('gives the enable and dismiss buttons a 44px minimum height', async () => {
    sheet()

    await waitFor(() => expect(enableButton()).not.toBeNull())
    expect(enableButton()?.className).toContain('min-h-11')
    expect(document.querySelector('[data-priming-dismiss]')?.className).toContain('min-h-11')
  })
})
