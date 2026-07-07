/**
 * Unit tests for deriveSearchAttributes — the pure logic behind the people
 * search GSIs (UsernameSearchIndex / DisplayNameSearchIndex).
 */
import { describe, it, expect, vi } from 'vitest'

// The repository module imports the shared DynamoDB client at load time; stub it
// so this pure-logic test needs no AWS env.
vi.mock('../../../shared/db/dynamodb', () => ({
  documentClient: { send: vi.fn() },
  TableNames: { users: 'users', businesses: 'businesses', appData: 'app-data' },
}))

import { deriveSearchAttributes } from '../dynamodb-repository'

describe('deriveSearchAttributes', () => {
  it('lowercases both fields and buckets by first character', () => {
    expect(deriveSearchAttributes({ username: 'Sipho_JHB', displayName: 'Sipho M' })).toEqual({
      usernameLower: 'sipho_jhb',
      usernameChar: 's',
      displayNameLower: 'sipho m',
      displayNameChar: 's',
    })
  })

  it('trims surrounding whitespace before bucketing', () => {
    const out = deriveSearchAttributes({ username: '  Thandi  ', displayName: '  Thandi Dlamini ' })
    expect(out['usernameLower']).toBe('thandi')
    expect(out['usernameChar']).toBe('t')
    expect(out['displayNameLower']).toBe('thandi dlamini')
    expect(out['displayNameChar']).toBe('t')
  })

  it('omits a field that is empty or whitespace-only (keeps the row out of that sparse index)', () => {
    expect(deriveSearchAttributes({ username: 'neo', displayName: '   ' })).toEqual({
      usernameLower: 'neo',
      usernameChar: 'n',
    })
    expect(deriveSearchAttributes({ username: '', displayName: '' })).toEqual({})
    expect(deriveSearchAttributes({})).toEqual({})
  })

  it('handles null / undefined fields', () => {
    expect(deriveSearchAttributes({ username: null, displayName: undefined })).toEqual({})
  })
})
