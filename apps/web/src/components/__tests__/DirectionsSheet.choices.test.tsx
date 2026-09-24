// @vitest-environment jsdom
/**
 * `DirectionsSheet` explicit choices, no timed fallback (proof-of-demand task
 * 16.3, R15.21).
 *
 * Validates: Requirements 15.21
 *
 * The sheet used to fire a 600 ms timer that navigated the whole SPA to an
 * HTTPS maps URL unless `visibilitychange` cancelled it first. The browser
 * never reports whether a native scheme handed off, so that timer was a guess,
 * and a wrong guess threw the consumer out of the map mid-session
 * (`no-fallbacks-no-legacy.md`). Now every provider carries two visible
 * actions, the app and the browser, and nothing navigates unless the consumer
 * taps.
 *
 * `window.location` is replaced with a plain object because jsdom refuses to
 * navigate to `maps://`.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, arg?: unknown) => (typeof arg === 'string' ? arg : key),
  }),
}))

import en from '../../i18n/locales/en.json'
import { DirectionsSheet } from '../DirectionsSheet'

const LAT = -26.2041
const LNG = 28.0473
const NAME = 'Test Venue'

const realLocation = window.location
const onClose = vi.fn()

function stubLocation(): { href: string } {
  const stub = { href: 'https://areacode.co.za/node/test-venue' }
  Object.defineProperty(window, 'location', { value: stub, writable: true, configurable: true })
  return stub
}

function openSheet() {
  return render(<DirectionsSheet isOpen onClose={onClose} lat={LAT} lng={LNG} name={NAME} />)
}

function appButton(id: string): HTMLButtonElement {
  return document.querySelector(`[data-directions-app="${id}"]`) as HTMLButtonElement
}

function webLink(id: string): HTMLAnchorElement {
  return document.querySelector(`[data-directions-web="${id}"]`) as HTMLAnchorElement
}

beforeEach(() => {
  onClose.mockClear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  Object.defineProperty(window, 'location', { value: realLocation, writable: true, configurable: true })
})

describe('DirectionsSheet explicit app and browser choices (R15.21)', () => {
  it('offers both an app action and a browser action for every provider', () => {
    stubLocation()
    openSheet()

    for (const id of ['apple', 'google', 'waze']) {
      expect(appButton(id)).toBeTruthy()
      const link = webLink(id)
      expect(link).toBeTruthy()
      // The web choice is a real link the consumer can see, open in a new tab,
      // or long-press, not a programmatic redirect.
      expect(link.getAttribute('href')?.startsWith('https://')).toBe(true)
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toContain('noopener')
      // The i18n mock returns the fallback, which is the shipped en.json copy.
      expect(link.textContent).toBe('Browser')
    }
  })

  it('opens only the native scheme on an app tap and arms no timer', () => {
    const location = stubLocation()
    openSheet()
    // Baseline: whatever the sheet itself scheduled on open (BottomSheet focus).
    const pendingBefore = vi.getTimerCount()

    fireEvent.click(appButton('google'))

    expect(location.href.startsWith('comgooglemaps://')).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)

    // The tap schedules nothing: no deferred work can navigate behind the
    // consumer's back.
    expect(vi.getTimerCount()).toBe(pendingBefore)
    vi.advanceTimersByTime(5000)
    expect(location.href.startsWith('comgooglemaps://')).toBe(true)
  })

  it('never redirects to the HTTPS URL after the deep link, at any delay', () => {
    const location = stubLocation()
    openSheet()

    fireEvent.click(appButton('apple'))
    expect(location.href.startsWith('maps://')).toBe(true)

    // The old behaviour flipped to https after 600 ms unless the page hid.
    vi.advanceTimersByTime(600)
    expect(location.href.includes('https://')).toBe(false)
    vi.advanceTimersByTime(10_000)
    expect(location.href.includes('https://')).toBe(false)
  })

  it('registers no visibilitychange listener', () => {
    stubLocation()
    const addListener = vi.spyOn(document, 'addEventListener')
    openSheet()

    fireEvent.click(appButton('waze'))

    const events = addListener.mock.calls.map((c) => c[0])
    expect(events).not.toContain('visibilitychange')
    addListener.mockRestore()
  })

  it('carries the destination on both actions and keeps 44px targets', () => {
    stubLocation()
    openSheet()

    const link = webLink('waze')
    expect(link.getAttribute('href')).toContain(`${LAT},${LNG}`)
    // 44px minimum on both halves of the row (min-h-11 / min-w-11).
    expect(link.className).toContain('min-h-11')
    expect(link.className).toContain('min-w-11')
    expect(appButton('waze').className).toContain('min-h-11')
  })

  it('makes no claim about what happens when an app is missing', () => {
    stubLocation()
    openSheet()
    // The old hint promised an automatic web fallback that no longer exists.
    // The sheet renders through a portal, so read the document, not the container.
    expect(document.body.textContent).not.toContain('fallbackHint')
    // The copy is gone from the one home too, so it cannot come back by render.
    expect(Object.keys(en)).not.toContain('directions.fallbackHint')
    expect(en['directions.openInBrowser']).toBeTruthy()
  })
})
