const isWeb = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

export const storage = {
  get(key: string): string | null {
    if (!isWeb) return null
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },

  set(key: string, value: string): void {
    if (!isWeb) return
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // Storage full or unavailable — fail silently
    }
  },

  remove(key: string): void {
    if (!isWeb) return
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Fail silently
    }
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
}
