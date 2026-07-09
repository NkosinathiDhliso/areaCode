// @vitest-environment jsdom
/**
 * Unit tests for the consumer re-consent gate (Release Quality & Ops Hygiene,
 * Requirement 8). The gate shows exactly one Bottom_Sheet when the server
 * reports the recorded consent version is behind the current one, records the
 * current version on accept (preserving analyticsOptIn), and fails closed on a
 * save error (sheet stays open, message shown).
 *
 * The shared api client is mocked via `vi.hoisted`; the consumer auth store is
 * driven through its real setState. i18n resolves the default copy, which is
 * what we assert on.
 */
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import type { ConsentStatus } from '@area-code/shared/types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ReconsentGate } from '../ReconsentGate'

const mock = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
vi.mock('@area-code/shared/lib/api', () => ({
  api: {
    get: (url: string) => mock.get(url),
    put: (url: string, body: unknown) => mock.put(url, body),
  },
}))

const TITLE = 'We updated our terms'
const ACCEPT = 'Accept and continue'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function status(overrides: Partial<ConsentStatus>): ConsentStatus {
  return {
    analyticsOptIn: false,
    currentVersion: 'v1.1',
    recordedVersion: 'v1.0',
    needsReconsent: true,
    ...overrides,
  }
}

beforeEach(() => {
  mock.get.mockReset()
  mock.put.mockReset()
  mock.put.mockResolvedValue({})
  useConsumerAuthStore.setState({ isAuthenticated: true })
})

afterEach(() => {
  cleanup()
})

describe('ReconsentGate: when to show', () => {
  it('shows the sheet when the recorded version is behind the current one', async () => {
    mock.get.mockResolvedValue(status({ recordedVersion: 'v1.0', currentVersion: 'v1.1', needsReconsent: true }))
    render(<ReconsentGate onNavigate={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy())
  })

  it('does not show the sheet when the recorded version matches the current one', async () => {
    mock.get.mockResolvedValue(status({ recordedVersion: 'v1.1', currentVersion: 'v1.1', needsReconsent: false }))
    render(<ReconsentGate onNavigate={vi.fn()} />)
    await flush()
    expect(screen.queryByText(TITLE)).toBeNull()
  })

  it('does not read consent or show the sheet when unauthenticated', async () => {
    useConsumerAuthStore.setState({ isAuthenticated: false })
    render(<ReconsentGate onNavigate={vi.fn()} />)
    await flush()
    expect(mock.get).not.toHaveBeenCalled()
    expect(screen.queryByText(TITLE)).toBeNull()
  })
})

describe('ReconsentGate: accept flow', () => {
  it('PUTs the current version, preserves analyticsOptIn, and closes the sheet', async () => {
    mock.get.mockResolvedValue(status({ analyticsOptIn: true, currentVersion: 'v1.1', needsReconsent: true }))
    render(<ReconsentGate onNavigate={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(ACCEPT)).toBeTruthy())

    fireEvent.click(screen.getByText(ACCEPT))

    await waitFor(() =>
      expect(mock.put).toHaveBeenCalledWith('/v1/users/me/consent', {
        consentVersion: 'v1.1',
        analyticsOptIn: true,
      }),
    )
    await waitFor(() => expect(screen.queryByText(TITLE)).toBeNull())
  })

  it('fails closed: keeps the sheet open and shows a message when the save fails', async () => {
    mock.get.mockResolvedValue(status({ needsReconsent: true }))
    mock.put.mockRejectedValue({ error: 'server', message: 'Server error', statusCode: 500 })
    render(<ReconsentGate onNavigate={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(ACCEPT)).toBeTruthy())

    fireEvent.click(screen.getByText(ACCEPT))

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    // Sheet is still open after a failed save.
    expect(screen.getByText(TITLE)).toBeTruthy()
  })
})
