import { describe, it, expect } from 'vitest'

import { extractUsedKeys, parseManagedKeys, isSourceFile, computeClosure } from './check-amplify-env-closure.mjs'

// Unit tests for the Amplify_Env_Closure check core (Deployment Parity R6.4).
// Exercises the pure parsers against fixture strings (a fake TS source and a
// fake update-all-amplify-apps.ps1) and the two-direction closure diff against
// a fixture with a used-but-unmanaged gap and a managed-but-unused key.
//
// **Validates: Requirements 6.4**

// A fake frontend source reading VITE keys in the dot form, the bracket form,
// a dynamic template-literal prefix (must be dropped), a URL that must not be
// truncated by comment stripping, and a commented-out key (must not count).
const SOURCE_FIXTURE = `
const apiUrl = import.meta.env.VITE_API_URL
const cdn = import.meta.env['VITE_CDN_URL']
const flag = import.meta.env[\`VITE_FLAG_\${name}\`]
const link = 'https://areacode.co.za' // not a comment-eaten key
// const stale = import.meta.env.VITE_COMMENTED_OUT
`

// A fake ps1 declaring managed keys in all four supported forms, plus a comment
// line that must not be counted and a $env:VITE_* parameter default (a SOURCE,
// not a managed OUTPUT key form the parser targets).
const PS1_FIXTURE = `
# VITE_DOC_ONLY should never be counted (comment line)
param(
  [string] $ApiUrl = $env:VITE_API_URL
)

$managed = @{
  VITE_API_URL = $ApiUrl
}

$managed['VITE_STAFF_URL'] = $StaffUrl
$managed.VITE_CDN_URL = $CdnUrl

Set-ManagedKey $managed 'VITE_MAPBOX_TOKEN' $MapboxToken
`

describe('extractUsedKeys', () => {
  it('finds VITE keys in both dot and bracket read forms', () => {
    expect(extractUsedKeys(SOURCE_FIXTURE)).toContain('VITE_API_URL')
    expect(extractUsedKeys(SOURCE_FIXTURE)).toContain('VITE_CDN_URL')
  })

  it('drops a trailing-underscore dynamic-key prefix', () => {
    expect(extractUsedKeys(SOURCE_FIXTURE)).not.toContain('VITE_FLAG_')
  })

  it('ignores a key mentioned only in a comment', () => {
    expect(extractUsedKeys(SOURCE_FIXTURE)).not.toContain('VITE_COMMENTED_OUT')
  })

  it('returns the exact sorted unique set for the fixture', () => {
    expect(extractUsedKeys(SOURCE_FIXTURE)).toEqual(['VITE_API_URL', 'VITE_CDN_URL'])
  })
})

describe('parseManagedKeys', () => {
  it('finds all four managed-key declaration forms', () => {
    expect(parseManagedKeys(PS1_FIXTURE)).toEqual([
      'VITE_API_URL',
      'VITE_CDN_URL',
      'VITE_MAPBOX_TOKEN',
      'VITE_STAFF_URL',
    ])
  })

  it('does not count a key that appears only in a comment line', () => {
    expect(parseManagedKeys(PS1_FIXTURE)).not.toContain('VITE_DOC_ONLY')
  })
})

describe('isSourceFile', () => {
  it('accepts ts/tsx source, rejects tests, specs, and declarations', () => {
    expect(isSourceFile('apps/web/src/main.tsx')).toBe(true)
    expect(isSourceFile('packages/shared/lib/mediaUrl.ts')).toBe(true)
    expect(isSourceFile('apps/web/src/App.test.tsx')).toBe(false)
    expect(isSourceFile('packages/shared/x.spec.ts')).toBe(false)
    expect(isSourceFile('packages/shared/types/index.d.ts')).toBe(false)
    expect(isSourceFile('apps/web/src/__tests__/foo.ts')).toBe(false)
    expect(isSourceFile('apps/web/README.md')).toBe(false)
  })
})

describe('computeClosure', () => {
  it('reports a used-but-unmanaged key as a gap and a managed-but-unused key as drift', () => {
    const result = computeClosure({
      used: ['VITE_API_URL', 'VITE_NEW_UNMANAGED'],
      managed: ['VITE_API_URL', 'VITE_STALE_MANAGED'],
    })
    expect(result.usedButUnmanaged).toEqual(['VITE_NEW_UNMANAGED'])
    expect(result.managedButUnused).toEqual(['VITE_STALE_MANAGED'])
    expect(result.allowlistedUsed).toEqual([])
    expect(result.allowlistedManaged).toEqual([])
  })

  it('moves allowlisted keys out of the gap/drift buckets in both directions', () => {
    const result = computeClosure({
      used: ['VITE_API_URL', 'VITE_DEV_MOCK'],
      managed: ['VITE_API_URL', 'VITE_OFFPATH_MANAGED'],
      usedUnmanagedAllowlist: new Set(['VITE_DEV_MOCK']),
      managedUnusedAllowlist: new Set(['VITE_OFFPATH_MANAGED']),
    })
    expect(result.usedButUnmanaged).toEqual([])
    expect(result.managedButUnused).toEqual([])
    expect(result.allowlistedUsed).toEqual(['VITE_DEV_MOCK'])
    expect(result.allowlistedManaged).toEqual(['VITE_OFFPATH_MANAGED'])
  })

  it('reports no gaps when used and managed sets fully overlap', () => {
    const result = computeClosure({
      used: ['VITE_API_URL', 'VITE_CDN_URL'],
      managed: ['VITE_API_URL', 'VITE_CDN_URL'],
    })
    expect(result.usedButUnmanaged).toEqual([])
    expect(result.managedButUnused).toEqual([])
  })
})
