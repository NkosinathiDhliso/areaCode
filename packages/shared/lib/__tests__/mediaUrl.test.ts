import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { buildMediaUrl, mediaUrl } from '../mediaUrl'

// The CDN base is read from `import.meta.env.VITE_CDN_URL`, which Vite replaces
// statically at build time. That read cannot be driven by `vi.stubEnv` (Vitest
// inlines the same forms Vite does), so the join/normalization logic lives in
// the pure `buildMediaUrl(base, key)` and is tested directly here. `mediaUrl`
// is the thin env-reading wrapper; only its env-independent behavior (absolute
// passthrough, empty key) is asserted against it.

describe('buildMediaUrl - CDN base unset (R5.3)', () => {
  it('returns null when the base is null/undefined/empty/whitespace', () => {
    expect(buildMediaUrl(null, 'images/node-1/header.jpg')).toBeNull()
    expect(buildMediaUrl(undefined, 'images/node-1/header.jpg')).toBeNull()
    expect(buildMediaUrl('', 'images/node-1/header.jpg')).toBeNull()
    expect(buildMediaUrl('   ', 'images/node-1/header.jpg')).toBeNull()
  })

  it('still returns an absolute http(s) key as-is even with no base', () => {
    expect(buildMediaUrl(null, 'https://other.example.com/a.jpg')).toBe('https://other.example.com/a.jpg')
  })
})

describe('buildMediaUrl - empty key', () => {
  it('returns null for null, undefined, empty, and whitespace keys', () => {
    expect(buildMediaUrl('https://cdn.example.com', null)).toBeNull()
    expect(buildMediaUrl('https://cdn.example.com', undefined)).toBeNull()
    expect(buildMediaUrl('https://cdn.example.com', '')).toBeNull()
    expect(buildMediaUrl('https://cdn.example.com', '   ')).toBeNull()
  })
})

describe('buildMediaUrl - joining base and key (R5)', () => {
  it('joins base and key with a single slash', () => {
    expect(buildMediaUrl('https://cdn.example.com', 'images/node-1/header.jpg')).toBe(
      'https://cdn.example.com/images/node-1/header.jpg',
    )
  })

  it('normalizes a trailing slash on the base', () => {
    expect(buildMediaUrl('https://cdn.example.com/', 'images/x.jpg')).toBe('https://cdn.example.com/images/x.jpg')
  })

  it('normalizes a leading slash on the key', () => {
    expect(buildMediaUrl('https://cdn.example.com', '/images/x.jpg')).toBe('https://cdn.example.com/images/x.jpg')
  })

  it('normalizes both a trailing slash on base and leading slash on key', () => {
    expect(buildMediaUrl('https://cdn.example.com/', '/images/x.jpg')).toBe('https://cdn.example.com/images/x.jpg')
  })

  it('collapses repeated slashes at the seam', () => {
    expect(buildMediaUrl('https://cdn.example.com///', '///images/x.jpg')).toBe('https://cdn.example.com/images/x.jpg')
  })

  it('trims surrounding whitespace on the key before joining', () => {
    expect(buildMediaUrl('https://cdn.example.com', '  images/x.jpg  ')).toBe('https://cdn.example.com/images/x.jpg')
  })
})

describe('buildMediaUrl - absolute keys pass through', () => {
  it('returns an https key unchanged (not prefixed with the base)', () => {
    expect(buildMediaUrl('https://cdn.example.com', 'https://images.example.org/a.jpg')).toBe(
      'https://images.example.org/a.jpg',
    )
  })

  it('returns an http key unchanged', () => {
    expect(buildMediaUrl('https://cdn.example.com', 'http://images.example.org/a.jpg')).toBe(
      'http://images.example.org/a.jpg',
    )
  })

  it('matches http(s) case-insensitively', () => {
    expect(buildMediaUrl('https://cdn.example.com', 'HTTPS://images.example.org/a.jpg')).toBe(
      'HTTPS://images.example.org/a.jpg',
    )
  })
})

// Property: the join is always exactly one slash at the seam. fast-check
// predicate bodies are block statements per the repo testing rules.
describe('buildMediaUrl - join property (R5.3)', () => {
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
        const result = buildMediaUrl(base, key)
        const normalizedBase = base.replace(/\/+$/, '')
        expect(result).toBe(`${normalizedBase}/${key}`)
        // No accidental double slash after the protocol's `://`.
        expect((result ?? '').replace(/^https?:\/\//, '')).not.toContain('//')
      }),
      { numRuns: 100 },
    )
  })
})

// `mediaUrl` is the env-reading wrapper. Its env-independent behavior is stable
// regardless of whether VITE_CDN_URL is configured in the test runtime.
describe('mediaUrl - env-independent behavior', () => {
  it('passes an absolute key through without needing a base', () => {
    expect(mediaUrl('https://images.example.org/a.jpg')).toBe('https://images.example.org/a.jpg')
  })

  it('returns null for an empty key', () => {
    expect(mediaUrl('')).toBeNull()
    expect(mediaUrl(null)).toBeNull()
    expect(mediaUrl(undefined)).toBeNull()
  })
})
