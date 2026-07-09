/**
 * SettingsPanel Digest_Optout toggle tests (weekly-attribution-digest R4.5).
 *
 * Validates: Requirements 4.5
 *
 * The settings panel exposes the Digest_Optout toggle. The switch reflects the
 * current preference (ON = digest emails on = digestEmailOptOut false) loaded
 * from GET /v1/business/me. Toggling PATCHes /v1/business/settings with the new
 * digestEmailOptOut boolean and reflects the saved value. The design constraint
 * under test: the control is disabled while the PATCH is in flight (saving
 * state) so a double-tap cannot race, and it re-enables and reflects the new
 * state once the call resolves.
 */
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ─────────────────────────────────────────────────────────────────

// react-i18next: return the key so assertions and aria labels are stable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// Isolate the digest toggle: stub the venue editor so the test does not pull
// in map/socket dependencies.
vi.mock('../NodeEditorPanel', () => ({
  NodeEditorPanel: () => null,
}))

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  showError: vi.fn(),
  setPanel: vi.fn(),
}))

vi.mock('@area-code/shared/lib/api', () => ({
  api: {
    get: mocks.apiGet,
    patch: mocks.apiPatch,
    post: mocks.apiPost,
    put: mocks.apiPut,
    delete: mocks.apiDelete,
  },
}))

vi.mock('@area-code/shared/stores/businessStore', () => ({
  useBusinessStore: (selector?: (state: unknown) => unknown) => {
    const state = { setPanel: mocks.setPanel }
    return selector ? selector(state) : state
  },
}))

vi.mock('@area-code/shared/stores/errorStore', () => ({
  useErrorStore: { getState: () => ({ showError: mocks.showError }) },
}))

// Import AFTER vi.mock so the component resolves the mocked modules.
import { SettingsPanel } from '../SettingsPanel'

// ─── Helpers ─────────────────────────────────────────────────────────────

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// GET /v1/business/me returns a BusinessAccount with a known opt-out; the other
// two settings reads (staff, invites) return empty lists.
function mockLoad(digestEmailOptOut: boolean): void {
  mocks.apiGet.mockImplementation((url: string) => {
    if (url === '/v1/business/me') {
      return Promise.resolve({ id: 'biz-1', tier: 'growth', trialEndsAt: null, digestEmailOptOut })
    }
    if (url === '/v1/business/staff') return Promise.resolve({ items: [] })
    if (url === '/v1/business/staff/invites') return Promise.resolve({ items: [] })
    return Promise.resolve({})
  })
}

function getDigestSwitch(): HTMLButtonElement {
  return screen.getByRole('switch', { name: 'biz.settings.digestEmailLabel' }) as HTMLButtonElement
}

beforeEach(() => {
  mocks.apiGet.mockReset()
  mocks.apiPatch.mockReset()
  mocks.showError.mockReset()
})

afterEach(() => {
  cleanup()
})

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('SettingsPanel Digest_Optout toggle (R4.5)', () => {
  it('reflects emails-on when digestEmailOptOut is false', async () => {
    mockLoad(false)
    render(<SettingsPanel />)

    await waitFor(() => expect(getDigestSwitch()).toBeTruthy())
    // ON means aria-checked true (opt-out false).
    expect(getDigestSwitch().getAttribute('aria-checked')).toBe('true')
  })

  it('disables the toggle while the PATCH is in flight and reflects the saved state on resolve', async () => {
    mockLoad(false)
    const pending = deferred<{ digestEmailOptOut: boolean }>()
    mocks.apiPatch.mockReturnValue(pending.promise)

    render(<SettingsPanel />)
    await waitFor(() => expect(getDigestSwitch()).toBeTruthy())

    const control = getDigestSwitch()
    expect(control.disabled).toBe(false)

    // Toggle emails off: opt-out flips to true.
    fireEvent.click(control)

    // PATCH sent with the new opt-out value.
    await waitFor(() => expect(mocks.apiPatch).toHaveBeenCalledTimes(1))
    expect(mocks.apiPatch).toHaveBeenCalledWith('/v1/business/settings', { digestEmailOptOut: true })

    // Disabled while the request is in flight (saving state).
    await waitFor(() => expect(getDigestSwitch().disabled).toBe(true))

    // Resolve the PATCH with the saved value.
    pending.resolve({ digestEmailOptOut: true })

    // Re-enabled and reflects the new state (emails off = aria-checked false).
    await waitFor(() => expect(getDigestSwitch().disabled).toBe(false))
    expect(getDigestSwitch().getAttribute('aria-checked')).toBe('false')
  })

  it('surfaces an error and leaves the state unchanged when the PATCH fails', async () => {
    mockLoad(false)
    const pending = deferred<{ digestEmailOptOut: boolean }>()
    mocks.apiPatch.mockReturnValue(pending.promise)

    render(<SettingsPanel />)
    await waitFor(() => expect(getDigestSwitch()).toBeTruthy())

    fireEvent.click(getDigestSwitch())
    await waitFor(() => expect(getDigestSwitch().disabled).toBe(true))

    pending.reject(new Error('network'))

    // Re-enabled, error surfaced, and the switch stays on (state not corrupted).
    await waitFor(() => expect(getDigestSwitch().disabled).toBe(false))
    expect(mocks.showError).toHaveBeenCalledWith('biz.settings.digestSaveFailed')
    expect(getDigestSwitch().getAttribute('aria-checked')).toBe('true')
  })
})
