// @vitest-environment jsdom
/**
 * `GoingControl` on the consumer venue detail (proof-of-demand task 10.3, R9.2,
 * R9.3).
 *
 * Validates: Requirements 9.2, 9.3
 *
 * What the control must get right:
 *  - the tap reads as done immediately, and reverts verbatim when the server
 *    disagrees, with the failure surfaced rather than swallowed
 *  - it is disabled while the write is in flight, so a double tap cannot race
 *  - the threshold decides the count: at or above it with a Tonight the number is
 *    named, below it nothing is said about numbers
 *  - it never claims "be the first" when somebody has already marked, and never
 *    without a published night
 *  - the wording is intent, never presence: "marked going", no headcount
 *  - an anonymous reader is routed to sign-in rather than posting
 *
 * The api client is mocked; the real consumer auth store is driven via setState.
 * No network.
 */
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}))

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }))

vi.mock('@area-code/shared/lib/api', () => ({ api: { get: mocks.get, post: mocks.post, delete: mocks.del } }))

import { GoingControl } from '../GoingControl'

const NODE_ID = 'node-1'
const NIGHT = '2026-03-06'

function toggle(): HTMLButtonElement {
  return screen.getByRole('button') as HTMLButtonElement
}

function signedIn(): void {
  useConsumerAuthStore.setState({ isAuthenticated: true })
}

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue({ goingCount: 0, viewerGoing: false })
  mocks.post.mockReset()
  mocks.del.mockReset()
  useConsumerAuthStore.setState({ isAuthenticated: false })
})

afterEach(() => {
  cleanup()
  useConsumerAuthStore.setState({ isAuthenticated: false })
})

// ─── Threshold copy ──────────────────────────────────────────────────────────

describe('GoingControl threshold copy (R9.2)', () => {
  it('names the count at or above the threshold when a Tonight is published', async () => {
    signedIn()
    mocks.get.mockResolvedValue({ goingCount: 3, viewerGoing: false })

    render(<GoingControl nodeId={NODE_ID} hasTonight seedCount={3} />)

    await waitFor(() => expect(screen.getByText(/marked going tonight/)).toBeTruthy())
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('says nothing about numbers below the threshold', async () => {
    signedIn()
    mocks.get.mockResolvedValue({ goingCount: 2, viewerGoing: false })
    const { container } = render(<GoingControl nodeId={NODE_ID} hasTonight seedCount={2} />)

    await waitFor(() => expect(mocks.get).toHaveBeenCalled())

    expect(container.querySelector('[data-going-count]')).toBeNull()
    // And no false claim about being first, because two people already marked.
    expect(screen.queryByText('Be the first to mark going')).toBeNull()
    expect(screen.getByText('Mark going tonight')).toBeTruthy()
  })

  it('offers the first mark only when a night is published and nobody has marked', async () => {
    signedIn()
    render(<GoingControl nodeId={NODE_ID} hasTonight seedCount={0} />)

    await waitFor(() => expect(screen.getByText('Be the first to mark going')).toBeTruthy())
  })

  it('never claims the first mark when nothing is published', async () => {
    signedIn()
    render(<GoingControl nodeId={NODE_ID} hasTonight={false} seedCount={0} />)

    await waitFor(() => expect(mocks.get).toHaveBeenCalled())

    expect(screen.queryByText('Be the first to mark going')).toBeNull()
    expect(screen.getByText('Mark going tonight')).toBeTruthy()
  })

  it('never names a count without a Tonight, however many marked', async () => {
    signedIn()
    mocks.get.mockResolvedValue({ goingCount: 12, viewerGoing: false })
    const { container } = render(<GoingControl nodeId={NODE_ID} hasTonight={false} seedCount={12} />)

    await waitFor(() => expect(mocks.get).toHaveBeenCalled())

    expect(container.querySelector('[data-going-count]')).toBeNull()
  })

  it('reads as intent, never as a headcount in the room', async () => {
    signedIn()
    mocks.get.mockResolvedValue({ goingCount: 4, viewerGoing: false })
    const { container } = render(<GoingControl nodeId={NODE_ID} hasTonight seedCount={4} />)

    await waitFor(() => expect(container.querySelector('[data-going-count]')).toBeTruthy())

    const text = container.textContent ?? ''
    expect(text).toContain('marked going tonight')
    expect(text).not.toMatch(/here now|in the room|people here/i)
  })
})

// ─── The toggle ──────────────────────────────────────────────────────────────

describe('GoingControl toggle (R9.2, R9.3)', () => {
  it('reads as marked immediately and keeps the server count', async () => {
    signedIn()
    mocks.get.mockResolvedValue({ goingCount: 3, viewerGoing: false })
    mocks.post.mockResolvedValue({ date: NIGHT, goingCount: 4, viewerGoing: true })

    render(<GoingControl nodeId={NODE_ID} hasTonight seedCount={3} />)
    await waitFor(() => expect(mocks.get).toHaveBeenCalled())

    fireEvent.click(toggle())

    await waitFor(() => expect(screen.getByText('You marked going tonight')).toBeTruthy())
    expect(screen.getByText('4')).toBeTruthy()
    expect(toggle().getAttribute('aria-pressed')).toBe('true')
    expect(mocks.post).toHaveBeenCalledWith(`/v1/nodes/${NODE_ID}/going`, {})
  })

  it('withdraws against the night the mark landed on', async () => {
    signedIn()
    mocks.get.mockResolvedValue({ goingCount: 3, viewerGoing: false })
    mocks.post.mockResolvedValue({ date: NIGHT, goingCount: 4, viewerGoing: true })
    mocks.del.mockResolvedValue({ date: NIGHT, goingCount: 3, viewerGoing: false })

    render(<GoingControl nodeId={NODE_ID} hasTonight seedCount={3} />)
    await waitFor(() => expect(mocks.get).toHaveBeenCalled())

    fireEvent.click(toggle())
    await waitFor(() => expect(screen.getByText('You marked going tonight')).toBeTruthy())

    fireEvent.click(toggle())

    await waitFor(() => expect(mocks.del).toHaveBeenCalledWith(`/v1/nodes/${NODE_ID}/going?date=${NIGHT}`))
    await waitFor(() => expect(screen.getByText('Mark going tonight')).toBeTruthy())
  })

  it('is disabled while the write is in flight', async () => {
    signedIn()
    let release: (state: unknown) => void = () => undefined
    mocks.post.mockImplementation(() => new Promise((resolve) => (release = resolve)))

    render(<GoingControl nodeId={NODE_ID} hasTonight seedCount={0} />)
    await waitFor(() => expect(mocks.get).toHaveBeenCalled())

    fireEvent.click(toggle())

    await waitFor(() => expect(toggle().disabled).toBe(true))
    expect(screen.getByText('Saving')).toBeTruthy()

    // A second tap while in flight writes nothing.
    fireEvent.click(toggle())
    expect(mocks.post).toHaveBeenCalledTimes(1)

    await act(async () => {
      release({ date: NIGHT, goingCount: 1, viewerGoing: true })
    })
    await waitFor(() => expect(toggle().disabled).toBe(false))
  })

  it('reverts and surfaces the failure when the write is refused', async () => {
    signedIn()
    mocks.get.mockResolvedValue({ goingCount: 3, viewerGoing: false })
    mocks.post.mockRejectedValue(Object.assign(new Error('Too many'), { statusCode: 429 }))

    const { container } = render(<GoingControl nodeId={NODE_ID} hasTonight seedCount={3} />)
    await waitFor(() => expect(mocks.get).toHaveBeenCalled())

    fireEvent.click(toggle())

    await waitFor(() => expect(container.querySelector('[data-going-error]')).toBeTruthy())
    expect(screen.getByText('That did not save. Try again.')).toBeTruthy()
    // Back to the honest pre-tap state: not marked, count unchanged.
    expect(screen.getByText('Mark going tonight')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    // No raw error text from the server.
    expect(container.textContent).not.toContain('Too many')
  })
})

// ─── Boundaries ──────────────────────────────────────────────────────────────

describe('GoingControl boundaries', () => {
  it('routes an anonymous reader to sign-in rather than posting', () => {
    const onSignIn = vi.fn()
    render(<GoingControl nodeId={NODE_ID} hasTonight seedCount={0} onSignIn={onSignIn} />)

    fireEvent.click(toggle())

    expect(onSignIn).toHaveBeenCalledTimes(1)
    expect(mocks.post).not.toHaveBeenCalled()
    // Nothing is read either: there is no viewer mark to look up.
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('gives the control a 44px touch target', () => {
    const { container } = render(<GoingControl nodeId={NODE_ID} hasTonight seedCount={0} />)

    expect(container.querySelector('[data-going-toggle]')?.className).toContain('min-h-11')
  })

  it('still works when the viewer-mark read fails', async () => {
    signedIn()
    mocks.get.mockRejectedValue(new Error('offline'))
    mocks.post.mockResolvedValue({ date: NIGHT, goingCount: 4, viewerGoing: true })

    render(<GoingControl nodeId={NODE_ID} hasTonight seedCount={3} />)
    await waitFor(() => expect(mocks.get).toHaveBeenCalled())

    fireEvent.click(toggle())

    await waitFor(() => expect(screen.getByText('You marked going tonight')).toBeTruthy())
  })
})
