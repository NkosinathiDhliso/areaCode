/**
 * Web Storage access under a store that throws (proof-of-demand R15.19).
 *
 * Safari Private Browsing and a blocked storage policy both expose
 * `sessionStorage` and then throw on use, which is why every read returns null
 * and every write reports whether it landed instead of taking a screen down.
 * The sign-in copy lives here too, because the OAuth round trip is the one flow
 * that cannot continue without storage.
 *
 * **Validates: Requirements 15.19**
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'

import {
  SIGN_IN_STORAGE_REQUIRED_COPY,
  isStorageAvailable,
  readStored,
  readStoredJson,
  removeStored,
  writeStored,
  writeStoredJson,
} from '../safeStorage'

const realSession = window.sessionStorage

function setSessionStorage(value: unknown): void {
  Object.defineProperty(window, 'sessionStorage', { value, writable: true, configurable: true })
}

/** A store shaped like the real thing whose every method throws, as private mode does. */
function throwingStorage(): Storage {
  const boom = () => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
  }
  return {
    get length(): number {
      return boom()
    },
    clear: boom,
    getItem: boom,
    key: boom,
    removeItem: boom,
    setItem: boom,
  } as unknown as Storage
}

afterEach(() => {
  setSessionStorage(realSession)
  realSession.clear()
  vi.restoreAllMocks()
})

describe('a working store', () => {
  it('round trips a value and reports the area as available', () => {
    expect(isStorageAvailable('session')).toBe(true)
    expect(writeStored('session', 'k', 'v')).toBe(true)
    expect(readStored('session', 'k')).toBe('v')
    expect(removeStored('session', 'k')).toBe(true)
    expect(readStored('session', 'k')).toBeNull()
  })

  it('leaves no probe key behind after an availability check', () => {
    isStorageAvailable('session')
    expect(realSession.length).toBe(0)
  })

  it('reads back JSON and returns null for a corrupt payload', () => {
    expect(writeStoredJson('session', 'j', { slug: 'great-dane' })).toBe(true)
    expect(readStoredJson('session', 'j')).toEqual({ slug: 'great-dane' })
    realSession.setItem('j', 'not json')
    expect(readStoredJson('session', 'j')).toBeNull()
  })

  it('reports a value that cannot be serialised as not stored', () => {
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    expect(writeStoredJson('session', 'j', circular)).toBe(false)
    expect(readStored('session', 'j')).toBeNull()
  })

  it('reads a missing key as null rather than throwing', () => {
    expect(readStored('session', 'absent')).toBeNull()
    expect(readStoredJson('session', 'absent')).toBeNull()
  })
})

describe('a store that throws (private mode)', () => {
  it('reports the area as unavailable', () => {
    setSessionStorage(throwingStorage())
    expect(isStorageAvailable('session')).toBe(false)
  })

  it('reads null and reports writes and removals as not done', () => {
    setSessionStorage(throwingStorage())
    expect(readStored('session', 'k')).toBeNull()
    expect(readStoredJson('session', 'k')).toBeNull()
    expect(writeStored('session', 'k', 'v')).toBe(false)
    expect(writeStoredJson('session', 'k', { a: 1 })).toBe(false)
    expect(removeStored('session', 'k')).toBe(false)
  })

  it('survives a store whose property access itself throws', () => {
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new DOMException('blocked', 'SecurityError')
      },
      configurable: true,
    })
    expect(isStorageAvailable('session')).toBe(false)
    expect(readStored('session', 'k')).toBeNull()
    expect(writeStored('session', 'k', 'v')).toBe(false)
  })
})

describe('the sign-in message', () => {
  it('tells the user what to change, with no machinery in it', () => {
    expect(SIGN_IN_STORAGE_REQUIRED_COPY).toBe(
      'Sign-in needs storage enabled. Turn off Private Browsing and try again.',
    )
    expect(SIGN_IN_STORAGE_REQUIRED_COPY).not.toMatch(/sessionStorage|DOMException|Quota|undefined/)
  })
})
