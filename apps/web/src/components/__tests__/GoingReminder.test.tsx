// @vitest-environment jsdom
/**
 * The Tonight_Reminder opt-in on `GoingControl` (proof-of-demand task 10.5,
 * R9.6, R10.2).
 *
 * Validates: Requirements 9.6, 10.2
 *
 * The reminder is the one push this feature sends, so consent has to be exact:
 *
 *  - it is offered at the moment of intent, right after a mark lands, and only
 *    when there is a start still ahead to be reminded about
 *  - it is a SECOND, explicit tap. Marking going writes nothing about
 *    notifications, so nobody is opted in by wanting to go out
 *  - accepting writes the one existing notification preference
 *    (`tonightReminder`), not a second store, and stamps the opt-in on the Going
 *    row so the transition tick can find it
 *  - the confirmation is honest about Web Push. A browser that cannot subscribe
 *    (iOS Safari outside an installed PWA) is told the reminder shows inside the
 *    app, never promised a notification that will not arrive
 *
 * The Web Push helper is mocked because it needs real browser APIs; the
 * preference write is NOT mocked, so the asserted PATCH is the real one.
 */
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}))

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  enableWebPush: vi.fn(),
}))

vi.mock('@area-code/shared/lib/api', () => ({
  api: { get: mocks.get, post: mocks.post, patch: mocks.patch, delete: mocks.del },
}))

vi.mock('@area-code/shared/lib/webPush', () => ({
  enableWebPush: mocks.enableWebPush,
  isWebPushSupported: () => true,
}))

import { GoingControl } from '../GoingControl'

const NODE_ID = 'node-1'
const NIGHT = '2026-03-06'
const GOING_URL = `/v1/nodes/${NODE_ID}/going`
const PREFS_URL = '/v1/users/me/notification-preferences'

function remindButton(): HTMLButtonElement | null {
  return document.querySelector('[data-going-remind]') as HTMLButtonElement | null
}

function note(): string {
  return document.querySelector('[data-going-reminder-note]')?.textContent ?? ''
}

/** Mark going and wait for the write to settle. */
async function mark(): Promise<void> {
  fireEvent.click(document.querySelector('[data-going-toggle]') as HTMLButtonElement)
  await waitFor(() => expect(mocks.post).toHaveBeenCalled())
}

function renderControl(startsAt: string | null = '21:00') {
  return render(<GoingControl nodeId={NODE_ID} hasTonight seedCount={3} startsAt={startsAt} />)
}

beforeEach(() => {
  useConsumerAuthStore.setState({ isAuthenticated: true })
  mocks.get.mockReset().mockResolvedValue({ goingCount: 3, viewerGoing: false })
  mocks.post.mockReset().mockResolvedValue({ date: NIGHT, goingCount: 4, viewerGoing: true })
  mocks.patch.mockReset().mockResolvedValue({})
  mocks.del.mockReset().mockResolvedValue({ date: NIGHT, goingCount: 3, viewerGoing: false })
  mocks.enableWebPush.mockReset().mockResolvedValue('subscribed')
})

afterEach(() => {
  cleanup()
  useConsumerAuthStore.setState({ isAuthenticated: false })
})

// ─── When the offer appears ──────────────────────────────────────────────────

describe('the reminder is offered at the moment of intent (R9.6)', () => {
  it('appears after a mark lands, when a start time exists', async () => {
    renderControl()
    await waitFor(() => expect(mocks.get).toHaveBeenCalled())
    expect(remindButton()).toBeNull()

    await mark()

    await waitFor(() => expect(remindButton()).not.toBeNull())
    expect(remindButton()?.textContent).toBe('Remind me when it starts')
  })

  it('is never offered without a start to be reminded about', async () => {
    renderControl(null)
    await waitFor(() => expect(mocks.get).toHaveBeenCalled())

    await mark()

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1))
    expect(remindButton()).toBeNull()
  })

  it('writes nothing about notifications when the consumer only marks going', async () => {
    renderControl()
    await waitFor(() => expect(mocks.get).toHaveBeenCalled())

    await mark()

    // The mark itself carries no reminder and touches no preference.
    expect(mocks.post).toHaveBeenCalledWith(GOING_URL, {})
    expect(mocks.patch).not.toHaveBeenCalled()
    expect(mocks.enableWebPush).not.toHaveBeenCalled()
  })

  it('withdraws the offer with the mark: nothing left to remind about', async () => {
    renderControl()
    await waitFor(() => expect(mocks.get).toHaveBeenCalled())
    await mark()
    await waitFor(() => expect(remindButton()).not.toBeNull())

    fireEvent.click(document.querySelector('[data-going-toggle]') as HTMLButtonElement)

    await waitFor(() => expect(mocks.del).toHaveBeenCalled())
    await waitFor(() => expect(remindButton()).toBeNull())
  })

  it('dismisses without writing anything', async () => {
    renderControl()
    await waitFor(() => expect(mocks.get).toHaveBeenCalled())
    await mark()
    await waitFor(() => expect(remindButton()).not.toBeNull())

    fireEvent.click(document.querySelector('[data-going-remind-dismiss]') as HTMLButtonElement)

    await waitFor(() => expect(remindButton()).toBeNull())
    expect(mocks.patch).not.toHaveBeenCalled()
    expect(mocks.enableWebPush).not.toHaveBeenCalled()
  })
})

// ─── Accepting ───────────────────────────────────────────────────────────────

describe('accepting writes the one preference and stamps the row (R9.6, R10.2)', () => {
  async function accept(): Promise<void> {
    renderControl()
    await waitFor(() => expect(mocks.get).toHaveBeenCalled())
    await mark()
    await waitFor(() => expect(remindButton()).not.toBeNull())
    fireEvent.click(remindButton() as HTMLButtonElement)
    await waitFor(() => expect(mocks.patch).toHaveBeenCalled())
  }

  it('sets tonightReminder on the existing notification preferences, and nothing else', async () => {
    await accept()

    expect(mocks.patch).toHaveBeenCalledWith(PREFS_URL, { tonightReminder: true })
    expect(mocks.patch).toHaveBeenCalledTimes(1)
  })

  it('stamps the opt-in on the Going row through the same idempotent write', async () => {
    await accept()

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2))
    // First call is the mark, second carries the reminder. Same route, so the
    // opt-in lands on the row the mark made rather than making a second one.
    expect(mocks.post.mock.calls[0]).toEqual([GOING_URL, {}])
    expect(mocks.post.mock.calls[1]).toEqual([GOING_URL, { remind: true }])
  })

  it('asks for Web Push before recording the consent', async () => {
    await accept()

    expect(mocks.enableWebPush).toHaveBeenCalledTimes(1)
  })

  it('hides the offer once accepted, so it cannot be tapped twice', async () => {
    await accept()

    await waitFor(() => expect(remindButton()).toBeNull())
  })

  it('confirms plainly when the browser subscribed', async () => {
    await accept()

    await waitFor(() => expect(note()).toBe('We will tell you when it starts.'))
  })
})

// ─── Honesty about Web Push ──────────────────────────────────────────────────

describe('the confirmation never promises a push that cannot arrive (R9.6)', () => {
  for (const outcome of ['unsupported', 'denied', 'not_configured', 'failed'] as const) {
    it(`says in-app only when Web Push came back ${outcome}`, async () => {
      mocks.enableWebPush.mockResolvedValue(outcome)
      renderControl()
      await waitFor(() => expect(mocks.get).toHaveBeenCalled())
      await mark()
      await waitFor(() => expect(remindButton()).not.toBeNull())

      fireEvent.click(remindButton() as HTMLButtonElement)

      await waitFor(() => expect(note()).toContain('inside Area Code'))
      expect(note()).toContain('cannot show notifications while the app is closed')
      // The consent is still recorded: socket delivery reaches them in the app.
      expect(mocks.patch).toHaveBeenCalledWith(PREFS_URL, { tonightReminder: true })
    })
  }

  it('surfaces a failed write instead of implying the reminder is on', async () => {
    mocks.patch.mockRejectedValue(new Error('offline'))
    renderControl()
    await waitFor(() => expect(mocks.get).toHaveBeenCalled())
    await mark()
    await waitFor(() => expect(remindButton()).not.toBeNull())

    fireEvent.click(remindButton() as HTMLButtonElement)

    await waitFor(() => expect(note()).toBe('That did not save. Try again.'))
  })

  it('gives the reminder control a 44px touch target', async () => {
    renderControl()
    await waitFor(() => expect(mocks.get).toHaveBeenCalled())
    await mark()

    await waitFor(() => expect(remindButton()?.className).toContain('min-h-11'))
  })
})
