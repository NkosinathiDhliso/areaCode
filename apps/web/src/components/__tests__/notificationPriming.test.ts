import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the storage module to work in Node environment
const mockStore = new Map<string, string>()
vi.mock('../../../../../packages/shared/lib/storage', () => ({
  storage: {
    get: (key: string) => mockStore.get(key) ?? null,
    set: (key: string, value: string) => { mockStore.set(key, value) },
    remove: (key: string) => { mockStore.delete(key) },
  },
}))

import { isDeferredRecently } from '../NotificationPrimingSheet'

describe('notification priming deferral', () => {
  beforeEach(() => {
    mockStore.clear()
  })

  it('returns false when no deferral exists', () => {
    expect(isDeferredRecently('user-1')).toBe(false)
  })

  it('returns true when deferred recently', () => {
    mockStore.set('notif:deferred:user-1', String(Date.now()))
    expect(isDeferredRecently('user-1')).toBe(true)
  })

  it('returns false when deferral is older than 7 days', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000
    mockStore.set('notif:deferred:user-1', String(eightDaysAgo))
    expect(isDeferredRecently('user-1')).toBe(false)
  })

  it('returns true when deferral is within 7 days', () => {
    const sixDaysAgo = Date.now() - 6 * 24 * 60 * 60 * 1000
    mockStore.set('notif:deferred:user-1', String(sixDaysAgo))
    expect(isDeferredRecently('user-1')).toBe(true)
  })

  it('isolates deferrals per user', () => {
    mockStore.set('notif:deferred:user-1', String(Date.now()))
    expect(isDeferredRecently('user-1')).toBe(true)
    expect(isDeferredRecently('user-2')).toBe(false)
  })
})
