import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock the shared API client. `vi.hoisted` lets the factory reference this
// mutable mock state even though the mock is hoisted above the imports.
const apiMock = vi.hoisted(() => ({
  post: vi.fn(),
}))

vi.mock('../api', () => ({
  api: apiMock,
}))

import { trackEvent, flushEvents, setAnalyticsOptIn, isAnalyticsOptedIn, resetUsageBeaconForTest } from '../usageEvents'

const FLUSH_INTERVAL_MS = 15_000

/** Extract the single posted batch of events from the api mock's last call. */
function lastPostedEvents(): unknown[] {
  const call = apiMock.post.mock.calls.at(-1)
  expect(call, 'expected api.post to have been called').toBeDefined()
  const [path, body] = call as [string, { events: unknown[] }]
  expect(path).toBe('/v1/events')
  return body.events
}

beforeEach(() => {
  apiMock.post.mockReset()
  apiMock.post.mockResolvedValue(undefined)
  resetUsageBeaconForTest()
})

afterEach(() => {
  vi.useRealTimers()
  resetUsageBeaconForTest()
})

describe('usageEvents beacon - opt-in gating (R4.2)', () => {
  it('defaults to opted-out: no request even after an explicit flush', async () => {
    expect(isAnalyticsOptedIn()).toBe(false)

    trackEvent('beam_tap')
    trackEvent('zoom_commit')
    await flushEvents()

    expect(apiMock.post).not.toHaveBeenCalled()
  })

  it('buffers nothing while opted out, so flipping consent on later still sends nothing', async () => {
    // Anonymous / opted-out session emits nothing.
    trackEvent('signup_started')
    trackEvent('signup_completed')

    // Even after opting in, the earlier events were never buffered.
    setAnalyticsOptIn(true)
    await flushEvents()

    expect(apiMock.post).not.toHaveBeenCalled()
  })
})

describe('usageEvents beacon - sending when opted in (R4.2)', () => {
  it('buffers on trackEvent and posts the batch to /v1/events on flush', async () => {
    setAnalyticsOptIn(true)

    trackEvent('venue_selected', { city: 'johannesburg' })
    trackEvent('checkin_cta_shown')
    await flushEvents()

    expect(apiMock.post).toHaveBeenCalledTimes(1)
    const events = lastPostedEvents()
    expect(events).toHaveLength(2)
    expect((events[0] as { name: string }).name).toBe('venue_selected')
    expect((events[1] as { name: string }).name).toBe('checkin_cta_shown')
  })

  it('drops off-allowlist names client-side (defence in depth, R4.5)', async () => {
    setAnalyticsOptIn(true)

    // @ts-expect-error deliberately passing a name outside the allowlist
    trackEvent('not_a_real_event')
    await flushEvents()

    expect(apiMock.post).not.toHaveBeenCalled()
  })
})

describe('usageEvents beacon - flush triggers', () => {
  it('flushes immediately once 20 events buffer (batch-size trigger)', async () => {
    setAnalyticsOptIn(true)

    for (let i = 0; i < 20; i++) {
      trackEvent('beam_tap')
    }
    // The 20th event triggers an immediate flush synchronously up to the await.
    await Promise.resolve()

    expect(apiMock.post).toHaveBeenCalledTimes(1)
    expect(lastPostedEvents()).toHaveLength(20)
  })

  it('flushes a partial batch on the 15s timer', async () => {
    vi.useFakeTimers()
    setAnalyticsOptIn(true)

    trackEvent('beam_tap')
    trackEvent('zoom_commit')
    expect(apiMock.post).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS)

    expect(apiMock.post).toHaveBeenCalledTimes(1)
    expect(lastPostedEvents()).toHaveLength(2)
  })
})

describe('usageEvents beacon - failure handling (R4.7)', () => {
  it('swallows a rejected flush and drops the batch (no throw, no re-buffer)', async () => {
    setAnalyticsOptIn(true)
    apiMock.post.mockRejectedValue(new Error('endpoint down'))

    trackEvent('checkin_completed')
    // flushEvents must not throw even though api.post rejects.
    await expect(flushEvents()).resolves.toBeUndefined()

    // The failed batch was dropped, not re-buffered. A second flush with a
    // working endpoint sends nothing, proving the buffer did not grow.
    apiMock.post.mockReset()
    apiMock.post.mockResolvedValue(undefined)
    await flushEvents()
    expect(apiMock.post).not.toHaveBeenCalled()
  })
})

describe('usageEvents beacon - turning opt-in off clears the buffer', () => {
  it('discards buffered events when consent is revoked', async () => {
    setAnalyticsOptIn(true)
    trackEvent('signup_started')
    trackEvent('signup_completed')

    // Revoke consent: buffer is cleared and the pending timer cancelled.
    setAnalyticsOptIn(false)
    await flushEvents()

    expect(apiMock.post).not.toHaveBeenCalled()
  })
})

describe('usageEvents beacon - PII posture (R4.3)', () => {
  it('posts only { name, sessionId, ts, props? } with props limited to city/method', async () => {
    setAnalyticsOptIn(true)

    trackEvent('signup_completed', { city: 'cape-town', method: 'google' })
    await flushEvents()

    const events = lastPostedEvents() as Array<Record<string, unknown>>
    expect(events).toHaveLength(1)
    const [event] = events

    // Exactly the wire keys, nothing more.
    expect(new Set(Object.keys(event))).toEqual(new Set(['name', 'sessionId', 'ts', 'props']))
    // No identity or location fields leak in.
    expect(event).not.toHaveProperty('userId')
    expect(event).not.toHaveProperty('lat')
    expect(event).not.toHaveProperty('lng')
    expect(event).not.toHaveProperty('coordinates')

    // props carries only the closed coarse set.
    expect(new Set(Object.keys(event.props as object))).toEqual(new Set(['city', 'method']))
    expect((event.props as { city: string }).city).toBe('cape-town')
    expect((event.props as { method: string }).method).toBe('google')
  })

  it('uses one stable per-session id across events that is not a real userId', async () => {
    setAnalyticsOptIn(true)

    trackEvent('beam_tap')
    trackEvent('zoom_commit')
    await flushEvents()

    const events = lastPostedEvents() as Array<{ sessionId: string }>
    const ids = new Set(events.map((e) => e.sessionId))
    // Stable within a session.
    expect(ids.size).toBe(1)
    const [sessionId] = [...ids]
    // A random UUID, not an email / cognito sub / numeric user id.
    expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })
})
