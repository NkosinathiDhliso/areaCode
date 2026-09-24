/**
 * Web Storage access, the one home for every browser call site.
 *
 * `sessionStorage` and `localStorage` are not optional APIs a browser either has
 * or lacks: the properties exist in Safari Private Browsing and under a blocked
 * third-party-storage policy, then throw on access or on write. Reading them
 * blind takes a screen down, and wrapping each call site in its own try/catch
 * quietly loses whatever was being stashed.
 *
 * So every caller asks here and gets an honest answer: `null` for a read that
 * could not happen, `false` for a write that did not land. A caller whose flow
 * depends on the value surviving (the OAuth round trip) checks the return and
 * tells the user, instead of failing later with a mismatched-state error.
 *
 * This is not `./storage`. That one is the cross-platform persistent KV behind
 * the auth stores: `localStorage` on web, an in-memory mirror plus AsyncStorage
 * on React Native, and it is deliberately fire-and-forget. This module is the
 * browser-only accessor for both Web Storage areas that reports outcomes.
 */

/** Shown when sign-in cannot store the state it needs to come back to (R15.19). */
export const SIGN_IN_STORAGE_REQUIRED_COPY = 'Sign-in needs storage enabled. Turn off Private Browsing and try again.'

/** Which Web Storage area to use. Session dies with the tab; local persists. */
export type StorageArea = 'session' | 'local'

function area(kind: StorageArea): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage
  } catch {
    // Accessing the property itself throws under a blocked storage policy.
    return null
  }
}

/**
 * True when this area can actually be written to right now.
 *
 * Probed with a real write and remove, because using the store is the only
 * honest test of one that is blocked by private mode or quota. Callers use this
 * to explain the situation before starting a flow that needs storage.
 */
export function isStorageAvailable(kind: StorageArea): boolean {
  const store = area(kind)
  if (!store) return false
  const probe = '__area_code_probe__'
  try {
    store.setItem(probe, '1')
    store.removeItem(probe)
    return true
  } catch {
    return false
  }
}

/** The stored string, or `null` when absent or unreadable. Never throws. */
export function readStored(kind: StorageArea, key: string): string | null {
  const store = area(kind)
  if (!store) return null
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}

/** Store a value, returning whether it landed. Never throws. */
export function writeStored(kind: StorageArea, key: string, value: string): boolean {
  const store = area(kind)
  if (!store) return false
  try {
    store.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/** Remove a key, returning whether the removal happened. Never throws. */
export function removeStored(kind: StorageArea, key: string): boolean {
  const store = area(kind)
  if (!store) return false
  try {
    store.removeItem(key)
    return true
  } catch {
    return false
  }
}

/** Store JSON, returning whether it landed. A value that cannot be serialised is not stored. */
export function writeStoredJson(kind: StorageArea, key: string, value: unknown): boolean {
  let serialised: string
  try {
    serialised = JSON.stringify(value)
  } catch {
    return false
  }
  return writeStored(kind, key, serialised)
}

/**
 * Read and parse JSON, or `null` when absent, unreadable, or corrupt.
 *
 * Returns `unknown`: the caller validates the shape, because a stale build can
 * leave a payload that no longer matches the current type.
 */
export function readStoredJson(kind: StorageArea, key: string): unknown {
  const raw = readStored(kind, key)
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
