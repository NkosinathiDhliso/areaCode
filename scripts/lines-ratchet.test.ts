import fc from 'fast-check'
import { describe, it, expect } from 'vitest'

import { evaluateRatchet, countLines, isSourceFile, LINE_LIMIT } from './lines-ratchet.mjs'

// Unit tests for the Lines_Baseline ratchet core (Audit Gap Closure R5.1/R5.2).
//
// **Validates: Requirements 5.1, 5.2**

describe('countLines', () => {
  it('counts every physical line including blanks', () => {
    expect(countLines('a\nb\nc')).toBe(3)
    expect(countLines('a\n\nb')).toBe(3)
  })

  it('does not count the phantom line from a trailing newline', () => {
    expect(countLines('a\nb\n')).toBe(2)
  })

  it('handles CRLF and lone CR the same as LF', () => {
    expect(countLines('a\r\nb\r\n')).toBe(2)
    expect(countLines('a\rb\r')).toBe(2)
  })

  it('is 0 for empty content', () => {
    expect(countLines('')).toBe(0)
  })
})

describe('isSourceFile', () => {
  it('accepts ts/tsx source under the source roots', () => {
    expect(isSourceFile('apps/web/src/App.tsx')).toBe(true)
    expect(isSourceFile('backend/src/features/auth/service.ts')).toBe(true)
    expect(isSourceFile('packages/shared/lib/websocket.ts')).toBe(true)
  })

  it('rejects tests, specs, declarations, and configs', () => {
    expect(isSourceFile('apps/web/src/App.test.tsx')).toBe(false)
    expect(isSourceFile('backend/src/x.spec.ts')).toBe(false)
    expect(isSourceFile('apps/web/src/__tests__/foo.ts')).toBe(false)
    expect(isSourceFile('packages/shared/types/index.d.ts')).toBe(false)
    expect(isSourceFile('apps/web/vite.config.ts')).toBe(false)
    expect(isSourceFile('apps/web/src/styles.css')).toBe(false)
  })
})

describe('evaluateRatchet', () => {
  const baseline = { limit: 400, files: { 'a.ts': 500, 'b.ts': 420 } }

  it('passes when nothing changed', () => {
    const { failures } = evaluateRatchet(baseline, { 'a.ts': 500, 'b.ts': 420, 'new.ts': 100 })
    expect(failures).toEqual([])
  })

  it('fails when a new file exceeds the limit', () => {
    const { failures } = evaluateRatchet(baseline, { 'new.ts': 401 })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ path: 'new.ts', kind: 'new_over_limit' })
  })

  it('fails when a baselined file grows past its frozen count', () => {
    const { failures } = evaluateRatchet(baseline, { 'a.ts': 501, 'b.ts': 420 })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ path: 'a.ts', kind: 'grew', count: 501, frozen: 500 })
  })

  it('allows a baselined file to shrink and reports it prunable', () => {
    const { failures, prunable } = evaluateRatchet(baseline, { 'a.ts': 450, 'b.ts': 420 })
    expect(failures).toEqual([])
    expect(prunable).toContainEqual({ path: 'a.ts', reason: 'shrank', count: 450, frozen: 500 })
  })

  it('allows a baselined file to drop under the limit and marks it removable', () => {
    const { failures, prunable } = evaluateRatchet(baseline, { 'a.ts': 500, 'b.ts': 399 })
    expect(failures).toEqual([])
    expect(prunable).toContainEqual({ path: 'b.ts', reason: 'under_limit', count: 399, frozen: 420 })
  })

  it('marks a deleted baselined file prunable, not a failure', () => {
    const { failures, prunable } = evaluateRatchet(baseline, { 'a.ts': 500 })
    expect(failures).toEqual([])
    expect(prunable).toContainEqual({ path: 'b.ts', reason: 'deleted', frozen: 420 })
  })
})

describe('ratchet properties', () => {
  const pathArb = fc.string({ minLength: 1, maxLength: 8 }).map((s) => `${s}.ts`)
  const countArb = fc.integer({ min: 1, max: 3000 })

  it('never fails a file whose current count is at or below its frozen baseline', () => {
    fc.assert(
      fc.property(fc.dictionary(pathArb, countArb), (frozen) => {
        const baselineArb = { limit: LINE_LIMIT, files: frozen }
        // Current = each frozen file at or below its frozen count.
        const current = {}
        for (const [p, c] of Object.entries(frozen)) current[p] = Math.max(1, c - 1)
        const { failures } = evaluateRatchet(baselineArb, current)
        expect(failures).toEqual([])
      }),
      { numRuns: 200 },
    )
  })

  it('flags exactly the new files that exceed the limit', () => {
    fc.assert(
      fc.property(fc.dictionary(pathArb, countArb), (current) => {
        const empty = { limit: LINE_LIMIT, files: {} }
        const { failures } = evaluateRatchet(empty, current)
        const expected = Object.entries(current)
          .filter(([, c]) => c > LINE_LIMIT)
          .map(([p]) => p)
          .sort()
        expect(failures.map((f) => f.path).sort()).toEqual(expected)
      }),
      { numRuns: 200 },
    )
  })
})
