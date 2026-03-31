import { describe, it, expect } from 'vitest'
import { applyFriendVisibility } from '../service.js'

function makeEntry(userId: string, displayName = 'Name', username = 'user', avatarUrl: string | null = 'https://img.test/a.png') {
  return { userId, displayName, username, avatarUrl, tier: 'local' as const }
}

describe('applyFriendVisibility', () => {
  it('preserves identity for the viewer themselves', () => {
    const entries = [makeEntry('viewer-1')]
    const result = applyFriendVisibility(entries, new Set(), 'viewer-1')

    expect(result).toHaveLength(1)
    expect(result[0]!.displayName).toBe('Name')
    expect(result[0]!.username).toBe('user')
    expect(result[0]!.avatarUrl).toBe('https://img.test/a.png')
    expect(result[0]!.isFriend).toBe(true)
  })

  it('preserves identity for friends', () => {
    const entries = [makeEntry('friend-1')]
    const result = applyFriendVisibility(entries, new Set(['friend-1']), 'viewer-1')

    expect(result[0]!.displayName).toBe('Name')
    expect(result[0]!.username).toBe('user')
    expect(result[0]!.isFriend).toBe(true)
  })

  it('nulls out identity for non-friends', () => {
    const entries = [makeEntry('stranger-1')]
    const result = applyFriendVisibility(entries, new Set(), 'viewer-1')

    expect(result[0]!.displayName).toBeNull()
    expect(result[0]!.username).toBeNull()
    expect(result[0]!.avatarUrl).toBeNull()
    expect(result[0]!.isFriend).toBe(false)
  })

  it('handles empty entries array', () => {
    const result = applyFriendVisibility([], new Set(['a']), 'viewer-1')
    expect(result).toEqual([])
  })

  it('handles empty friend set — all non-viewer entries anonymised', () => {
    const entries = [makeEntry('a'), makeEntry('b'), makeEntry('c')]
    const result = applyFriendVisibility(entries, new Set(), 'viewer-1')

    result.forEach((r) => {
      expect(r.displayName).toBeNull()
      expect(r.username).toBeNull()
      expect(r.avatarUrl).toBeNull()
      expect(r.isFriend).toBe(false)
    })
  })

  it('handles all entries being friends', () => {
    const entries = [makeEntry('a'), makeEntry('b')]
    const result = applyFriendVisibility(entries, new Set(['a', 'b']), 'viewer-1')

    result.forEach((r) => {
      expect(r.displayName).toBe('Name')
      expect(r.isFriend).toBe(true)
    })
  })

  it('is idempotent — applying twice gives same result', () => {
    const entries = [makeEntry('friend-1'), makeEntry('stranger-1')]
    const friendIds = new Set(['friend-1'])
    const viewerId = 'viewer-1'

    const once = applyFriendVisibility(entries, friendIds, viewerId)
    const twice = applyFriendVisibility(once, friendIds, viewerId)

    expect(twice).toEqual(once)
  })

  it('handles entries with already-null fields (idempotence with nulled data)', () => {
    const entry = { userId: 'stranger-1', displayName: null, username: null, avatarUrl: null, tier: 'local' as const }
    const result = applyFriendVisibility([entry], new Set(), 'viewer-1')

    expect(result[0]!.displayName).toBeNull()
    expect(result[0]!.username).toBeNull()
    expect(result[0]!.avatarUrl).toBeNull()
    expect(result[0]!.isFriend).toBe(false)
  })

  it('preserves extra fields on entries', () => {
    const entry = { ...makeEntry('friend-1'), rank: 1, checkInCount: 42 }
    const result = applyFriendVisibility([entry], new Set(['friend-1']), 'viewer-1')

    expect(result[0]!.rank).toBe(1)
    expect(result[0]!.checkInCount).toBe(42)
    expect(result[0]!.isFriend).toBe(true)
  })

  it('mixed list — viewer, friend, and stranger', () => {
    const entries = [
      makeEntry('viewer-1', 'Me', 'me_user'),
      makeEntry('friend-1', 'Friend', 'friend_user'),
      makeEntry('stranger-1', 'Stranger', 'stranger_user'),
    ]
    const result = applyFriendVisibility(entries, new Set(['friend-1']), 'viewer-1')

    // Viewer
    expect(result[0]!.displayName).toBe('Me')
    expect(result[0]!.isFriend).toBe(true)

    // Friend
    expect(result[1]!.displayName).toBe('Friend')
    expect(result[1]!.isFriend).toBe(true)

    // Stranger
    expect(result[2]!.displayName).toBeNull()
    expect(result[2]!.username).toBeNull()
    expect(result[2]!.isFriend).toBe(false)
  })
})
