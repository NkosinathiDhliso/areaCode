import { beforeEach, describe, expect, it } from 'vitest'

import { usePresenceStore } from '../presenceStore'

/**
 * Honest Presence UI - presenceStore unit tests (task 1.2).
 *
 * Covers the session-scoped active-presence store: set/clear/clear-all
 * transitions and the isPresent selector. A fresh store must report no node
 * present (no fabricated presence).
 *
 * Validates: Requirements 3.1, 3.3
 */

function reset(): void {
  usePresenceStore.setState({ activePresence: {} })
}

beforeEach(reset)

describe('presenceStore', () => {
  it('a fresh store reports no node present', () => {
    expect(usePresenceStore.getState().activePresence).toEqual({})
    expect(usePresenceStore.getState().isPresent('node-1')).toBe(false)
  })

  it('setPresent makes isPresent true for that node only', () => {
    usePresenceStore.getState().setPresent('node-1')

    expect(usePresenceStore.getState().isPresent('node-1')).toBe(true)
    expect(usePresenceStore.getState().isPresent('node-2')).toBe(false)
  })

  it('setPresent records a checkedInAt timestamp', () => {
    const before = Date.now()
    usePresenceStore.getState().setPresent('node-1')
    const entry = usePresenceStore.getState().activePresence['node-1']

    expect(entry).toBeDefined()
    expect(entry!.checkedInAt).toBeGreaterThanOrEqual(before)
    expect(entry!.checkedInAt).toBeLessThanOrEqual(Date.now())
  })

  it('clearPresent makes isPresent false again', () => {
    usePresenceStore.getState().setPresent('node-1')
    expect(usePresenceStore.getState().isPresent('node-1')).toBe(true)

    usePresenceStore.getState().clearPresent('node-1')
    expect(usePresenceStore.getState().isPresent('node-1')).toBe(false)
    expect('node-1' in usePresenceStore.getState().activePresence).toBe(false)
  })

  it('clearPresent for an absent node is a safe no-op', () => {
    usePresenceStore.getState().setPresent('node-1')

    usePresenceStore.getState().clearPresent('node-2')

    expect(usePresenceStore.getState().isPresent('node-1')).toBe(true)
    expect(usePresenceStore.getState().isPresent('node-2')).toBe(false)
  })

  it('clearPresent only clears the targeted node', () => {
    usePresenceStore.getState().setPresent('node-1')
    usePresenceStore.getState().setPresent('node-2')

    usePresenceStore.getState().clearPresent('node-1')

    expect(usePresenceStore.getState().isPresent('node-1')).toBe(false)
    expect(usePresenceStore.getState().isPresent('node-2')).toBe(true)
  })

  it('clear resets all active presence', () => {
    usePresenceStore.getState().setPresent('node-1')
    usePresenceStore.getState().setPresent('node-2')

    usePresenceStore.getState().clear()

    expect(usePresenceStore.getState().activePresence).toEqual({})
    expect(usePresenceStore.getState().isPresent('node-1')).toBe(false)
    expect(usePresenceStore.getState().isPresent('node-2')).toBe(false)
  })

  it('isPresent is true only after set and false after clear', () => {
    expect(usePresenceStore.getState().isPresent('node-1')).toBe(false)

    usePresenceStore.getState().setPresent('node-1')
    expect(usePresenceStore.getState().isPresent('node-1')).toBe(true)

    usePresenceStore.getState().clearPresent('node-1')
    expect(usePresenceStore.getState().isPresent('node-1')).toBe(false)
  })
})
