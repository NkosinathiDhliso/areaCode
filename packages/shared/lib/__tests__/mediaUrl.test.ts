import * as fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mediaUrl } from '../mediaUrl'

// `mediaUrl` reads `import.meta.env.VITE_CDN_URL` at call time via a defensive
// getter, so `vi.stubEnv` (which Vitest applies to import.meta.env too) drives
// the "set" vs "unset" branches. Default Vitest env leaves the key undefined,
// which is the production "no CDN configured" case (deployment-parity R5.3).

beforeEach(() => {
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('mediaUrl - CDN base unset (R5.3)', () => {
  it('returns null when VITE_CDN_URL is unset', () => {
    // No stub: the key is absent from the env, the prod "no CDN" case.
    expect(mediaUrl('images/node-1/header.jpg')).toBeNull()
  })

  it('returns null when VITE_CDN_URL is empty or whitespace', () => {
    vi.stubEnv('VITE_CDN_URL', '')
    expect(mediaUrl('images/node-1/header.jpg')).toBeNull()

    vi.stubEnv('VITE_CDN_URL', '   ')
    expect(mediaUrl('images/node-1/header.jpg')).toBeNull()
  })

  it('still returns an absolute http(s) key as-is even with no base', () => {
    expect(mediaUrl('https://other.example.com/a.jpg')).toBe('https://other.example.com/a.jpg')
  })
})

describe('mediaUrl - empty key', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_CDN_URL', 'https://cdn.example.com')
  })

  it('returns null for null, undefined, empty, and whitespace keys', () => {
    expect(mediaUrl(null)).toBeNull()
    expect(mediaUrl(undefined)).toBeNull()
    expect(mediaUrl('')).toBeNull()
    expect(mediaUrl('   ')).toBeNull()
  })
})

describe('mediaUrl - joining base and key (R5)', () => {
  it('joins base and key with a single slash', () => {
    vi.stubEnv('VITE_CDN_URL', 'https://cdn.example.com')
    expect(mediaUrl('images/node-1/header.jpg')).toBe('https://cdn.example.com/images/node-1/header.jpg')
  })

  it('normalizes a trailing slash on the base', () => {
    vi.stubEnv('VITE_CDN_URL', 'https://cdn.example.com/')
    expect(mediaUrl('images/x.jpg')).toBe('https://cdn.example.com/images/x.jpg')
  })

  it('normalizes a leading slash on the key', () => {
    vi.stubEnv('VITE_CDN_URL', 'https://cdn.example.com')
    expect(mediaUrl('/images/x.jpg')).toBe('https://cdn.example.com/images/x.jpg')
  })

  it('normalizes both a trailing slash on base and leading slash on key', () => {
    vi.stubEnv('VITE_CDN_URL', 'https://cdn.example.com/')
    expect(mediaUrl('/images/x.jpg')).toBe('https://cdn.example.com/images/x.jpg')
  })

  it('collapses repeated slashes at the seam', () => {
    vi.stubEnv('VITE_CDN_URL', 'https://cdn.example.com///')
    expect(mediaUrl('///images/x.jpg')).toBe('https://cdn.example.com/images/x.jpg')
  })

  it('trims surrounding whitespace on the key before joining', () => {
    vi.stubEnv('VITE_CDN_URL', 'https://cdn.example.com')
    expect(mediaUrl('  images/x.jpg  ')).toBe('https://cdn.example.com/images/x.jpg')
  })
})

describe('mediaUrl - absolute keys pass through', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_CDN_URL', 'https://cdn.example.com')
  })

  it('returns an https key unchanged (not prefixed with the base)', () => {
    expect(mediaUrl('https://images.example.org/a.jpg')).toBe('https://images.example.org/a.jpg')
  })

  it('returns an http key unchanged', () => {
    expect(mediaUrl('http://images.example.org/a.jpg')).toBe('http://images.example.org/a.jpg')
  })

  it('matches http(s) case-insensitively', () => {
    expect(mediaUrl('HTTPS://images.example.org/a.jpg')).toBe('HTTPS://images.example.org/a.jpg')
  })
})

// Property: the join is always exactly one slash at the seam. fast-check
// predicate bodies are block statements per the repo testing rules.
describe('mediaUrl - join property (R5.3)', () => {
  const baseArb = fc.constantFrom(
    'https://cdn.example.com',
    'https://cdn.example.com/',
    'https://d123.cloudfront.net',
    'https://d123.cloudfront.net//',
  )
  const keyArb = fc
    .tuple(
      fc.string({ minLength: 1, maxLength: 8, unit: fc.constantFrom(...'abcdefghijklmnop0123456789'.split('')) }),
      fc.string({ minLength: 1, maxLength: 8, unit: fc.constantFrom(...'abcdefghijklmnop0123456789'.split('')) }),
    )
    .map(([folder, file]) => `images/${folder}/${file}.jpg`)

  it('produces base + single-slash + normalized key for any relative key', () => {
    fc.assert(
      fc.property(baseArb, keyArb, (base, key) => {
        vi.stubEnv('VITE_CDN_URL', base)
        const result = mediaUrl(key)
        const normalizedBase = base.replace(/\/+$/, '')
        expect(result).toBe(`${normalizedBase}/${key}`)
        // No accidental double slash after the protocol's `://`.
        expect((result ?? '').replace(/^https?:\/\//, '')).not.toContain('//')
        vi.unstubAllEnvs()
      }),
      { numRuns: 100 },
    )
  })
})
