/**
 * Staff polish (item E) — manual redemption-code input.
 *
 * The validator's manual input must accept the canonical redemption code:
 * 8 characters over `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (uppercase A-Z minus
 * I/O plus digits 2-9). Any code that can be scanned must also be typable,
 * so the input filters to alphanumerics, uppercases, and caps at 8 chars.
 *
 * **Validates: Requirements 5.3**
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import * as fc from 'fast-check'

import { StaffValidator } from '../StaffValidator'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../../shared/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

vi.mock('../../../shared/components/primitives', () => ({
  Box: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  Text: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
}))

// ─── Canonical redemption code alphabet ─────────────────────────────────────────

const CANONICAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** 1–8 char strings over the canonical redemption-code alphabet. */
const canonicalCodeArb = fc.string({
  minLength: 1,
  maxLength: 8,
  unit: fc.constantFrom(...CANONICAL_ALPHABET.split('')),
})

function renderInput(): HTMLInputElement {
  const { container } = render(<StaffValidator />)
  const input = container.querySelector('input[type="text"]') as HTMLInputElement
  expect(input).not.toBeNull()
  return input
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Staff validator manual input — canonical code entry (R5.3)', () => {
  afterEach(() => {
    cleanup()
  })

  it('exposes a text input capped at the canonical 8-char length', () => {
    const input = renderInput()
    expect(input.getAttribute('inputMode')).toBe('text')
    expect(input.maxLength).toBe(8)
  })

  it('accepts every character of the canonical alphabet (A-Z minus I/O, 2-9)', () => {
    for (const ch of CANONICAL_ALPHABET.split('')) {
      cleanup()
      const input = renderInput()
      fireEvent.change(input, { target: { value: ch } })
      expect(input.value).toBe(ch)
    }
  })

  it('uppercases any canonical code typed in lowercase', () => {
    fc.assert(
      fc.property(canonicalCodeArb, (code) => {
        cleanup()
        const input = renderInput()
        fireEvent.change(input, { target: { value: code.toLowerCase() } })
        expect(input.value).toBe(code.toUpperCase())
      }),
      { numRuns: 100 },
    )
  })

  it('accepts uppercase canonical codes unchanged', () => {
    fc.assert(
      fc.property(canonicalCodeArb, (code) => {
        cleanup()
        const input = renderInput()
        fireEvent.change(input, { target: { value: code } })
        expect(input.value).toBe(code)
      }),
      { numRuns: 100 },
    )
  })

  it('strips non-alphanumeric characters from typed input', () => {
    const input = renderInput()
    fireEvent.change(input, { target: { value: 'A!B@2#' } })
    expect(input.value).toBe('AB2')
  })
})
