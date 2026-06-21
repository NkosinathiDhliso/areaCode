// Cross-platform key/value storage.
//
// Web: backed directly by `window.localStorage` (synchronous).
//
// React Native: there is no synchronous localStorage, and the only persistence
// primitive available (AsyncStorage) is async. Many call sites read
// synchronously at module-eval time (e.g. the zustand auth store), so we keep a
// synchronous in-memory cache that mirrors an async backend. The native app
// injects the backend at boot via `configureAsyncBackend`, which also hydrates
// the cache from disk. Writes update the cache synchronously and are flushed to
// the backend fire-and-forget. This keeps the public `get`/`set`/`remove` API
// synchronous on every platform while still persisting on device.
//
// The native dependency is injected rather than imported so web bundlers never
// try to resolve `@react-native-async-storage/async-storage`.

const hasLocalStorage = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

/** In-memory mirror used on platforms without a synchronous store (React Native). */
const memoryCache = new Map<string, string>()

/** Minimal slice of the AsyncStorage API we rely on. */
export interface AsyncStorageBackend {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  getAllKeys(): Promise<readonly string[]>
  multiGet(keys: readonly string[]): Promise<ReadonlyArray<readonly [string, string | null]>>
}

let asyncBackend: AsyncStorageBackend | null = null

export const storage = {
  get(key: string): string | null {
    if (hasLocalStorage) {
      try {
        return window.localStorage.getItem(key)
      } catch {
        return null
      }
    }
    return memoryCache.has(key) ? (memoryCache.get(key) ?? null) : null
  },

  set(key: string, value: string): void {
    if (hasLocalStorage) {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        // Storage full or unavailable - fail silently
      }
      return
    }
    memoryCache.set(key, value)
    void asyncBackend?.setItem(key, value).catch(() => {
      // Persistence failure is non-fatal; the in-memory value still serves
      // this session.
    })
  },

  remove(key: string): void {
    if (hasLocalStorage) {
      try {
        window.localStorage.removeItem(key)
      } catch {
        // Fail silently
      }
      return
    }
    memoryCache.delete(key)
    void asyncBackend?.removeItem(key).catch(() => {
      /* non-fatal */
    })
  },

  getJSON<T>(key: string): T | null {
    const raw = storage.get(key)
    if (!raw) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  },

  setJSON(key: string, value: unknown): void {
    storage.set(key, JSON.stringify(value))
  },

  /**
   * Wire a React Native AsyncStorage backend and hydrate the synchronous cache
   * from disk. Call once at app boot, before rendering, and re-read any
   * persisted state afterwards (the zustand stores are created with an empty
   * cache at import time, so call their rehydrate paths once this resolves).
   *
   * No-op on web, where `window.localStorage` is already synchronous.
   */
  async configureAsyncBackend(backend: AsyncStorageBackend): Promise<void> {
    if (hasLocalStorage) return
    asyncBackend = backend
    try {
      const keys = await backend.getAllKeys()
      if (keys.length === 0) return
      const pairs = await backend.multiGet(keys)
      for (const [k, v] of pairs) {
        if (v != null) memoryCache.set(k, v)
      }
    } catch {
      // If hydration fails the cache simply starts empty - the user re-auths.
    }
  },
}
