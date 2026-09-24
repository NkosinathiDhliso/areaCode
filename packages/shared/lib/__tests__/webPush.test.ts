// @vitest-environment jsdom
/**
 * `needsHomeScreenInstall` (proof-of-demand task 16.2, R15.20).
 *
 * Validates: Requirements 15.20
 *
 * iOS Safari in an ordinary tab has no `PushManager`, so the only true thing to
 * offer there is the Add to Home Screen step. Once installed, or on any other
 * platform, the normal permission prompt is the right path and this must not
 * send people to a step they do not need.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { needsHomeScreenInstall } from '../webPush'

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

const realMatchMedia = window.matchMedia

function setUserAgent(ua: string): void {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
}

function setStandalone(value: boolean | undefined): void {
  Object.defineProperty(window.navigator, 'standalone', { value, configurable: true })
}

/** Stub the display-mode query so the installed-app branch is testable. */
function setDisplayModeStandalone(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({ matches: query.includes('standalone') && matches, media: query }),
    configurable: true,
  })
}

beforeEach(() => {
  setStandalone(undefined)
  setDisplayModeStandalone(false)
})

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', { value: realMatchMedia, configurable: true })
})

describe('needsHomeScreenInstall', () => {
  it('is true on iOS in an ordinary tab: no PushManager until it is installed', () => {
    setUserAgent(IOS_UA)

    expect(needsHomeScreenInstall()).toBe(true)
  })

  it('is false once iOS reports the installed standalone flag', () => {
    setUserAgent(IOS_UA)
    setStandalone(true)

    expect(needsHomeScreenInstall()).toBe(false)
  })

  it('is false when the standard display-mode query says installed', () => {
    setUserAgent(IOS_UA)
    setDisplayModeStandalone(true)

    expect(needsHomeScreenInstall()).toBe(false)
  })

  it('is false on Android, where the ordinary permission prompt works', () => {
    setUserAgent(ANDROID_UA)

    expect(needsHomeScreenInstall()).toBe(false)
  })

  it('is false on desktop', () => {
    setUserAgent(DESKTOP_UA)

    expect(needsHomeScreenInstall()).toBe(false)
  })
})
