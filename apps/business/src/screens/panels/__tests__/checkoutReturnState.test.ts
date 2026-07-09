/**
 * Unit tests for the pure checkout-return state machine (billing-revenue-integrity
 * R6). These run in the default node environment: computeReturnState,
 * hasPaidStateLanded, and parseReturnStatus carry no React or network.
 *
 * **Validates: Requirements 6.1, 6.2, 6.3**
 */
import { describe, it, expect } from 'vitest'

import {
  computeReturnState,
  hasPaidStateLanded,
  parseReturnStatus,
  POLL_INTERVAL_MS,
  POLL_MAX_MS,
  type ReturnProfile,
} from '../checkoutReturnState'

// Fixed reference time so paidUntil comparisons are deterministic.
const NOW = Date.parse('2026-07-09T00:00:00.000Z')
const FUTURE = new Date(NOW + 30 * 24 * 60 * 60 * 1000).toISOString()
const PAST = new Date(NOW - 1).toISOString()

describe('checkoutReturnState constants', () => {
  it('polls every 2s up to 60s (R6.1)', () => {
    expect(POLL_INTERVAL_MS).toBe(2_000)
    expect(POLL_MAX_MS).toBe(60_000)
  })
})

describe('hasPaidStateLanded', () => {
  it('is false when there is no profile yet', () => {
    expect(hasPaidStateLanded(null, NOW)).toBe(false)
  })

  it('is false for free/starter tiers regardless of paidUntil', () => {
    expect(hasPaidStateLanded({ tier: 'free', paidUntil: FUTURE }, NOW)).toBe(false)
    expect(hasPaidStateLanded({ tier: 'starter', paidUntil: FUTURE }, NOW)).toBe(false)
  })

  it('is false for a paid tier with no paidUntil', () => {
    expect(hasPaidStateLanded({ tier: 'growth', paidUntil: null }, NOW)).toBe(false)
    expect(hasPaidStateLanded({ tier: 'pro' }, NOW)).toBe(false)
  })

  it('is false for a paid tier whose paidUntil already lapsed', () => {
    expect(hasPaidStateLanded({ tier: 'growth', paidUntil: PAST }, NOW)).toBe(false)
  })

  it('is true for a paid tier with a future paidUntil', () => {
    for (const tier of ['growth', 'pro', 'payg']) {
      expect(hasPaidStateLanded({ tier, paidUntil: FUTURE }, NOW)).toBe(true)
    }
  })

  it('treats paidUntil exactly at now as landed (boundary)', () => {
    const exactly = new Date(NOW).toISOString()
    expect(hasPaidStateLanded({ tier: 'growth', paidUntil: exactly }, NOW)).toBe(true)
  })
})

describe('computeReturnState', () => {
  const base = { elapsedMs: 0, profile: null as ReturnProfile | null, nowMs: NOW }

  it('returns idle when there is no return status', () => {
    expect(computeReturnState({ ...base, status: null })).toBe('idle')
  })

  it('success + not-landed + within 60s => activating (R6.1)', () => {
    expect(computeReturnState({ status: 'success', elapsedMs: 4_000, profile: null, nowMs: NOW })).toBe('activating')
    expect(
      computeReturnState({
        status: 'success',
        elapsedMs: 59_999,
        profile: { tier: 'growth', paidUntil: PAST },
        nowMs: NOW,
      }),
    ).toBe('activating')
  })

  it('success + landed => confirmed (R6.1)', () => {
    expect(
      computeReturnState({
        status: 'success',
        elapsedMs: 4_000,
        profile: { tier: 'growth', paidUntil: FUTURE },
        nowMs: NOW,
      }),
    ).toBe('confirmed')
  })

  it('landed wins even at/after the 60s ceiling', () => {
    expect(
      computeReturnState({
        status: 'success',
        elapsedMs: 60_000,
        profile: { tier: 'pro', paidUntil: FUTURE },
        nowMs: NOW,
      }),
    ).toBe('confirmed')
  })

  it('success + not-landed + >=60s => timeout (R6.2)', () => {
    expect(computeReturnState({ status: 'success', elapsedMs: 60_000, profile: null, nowMs: NOW })).toBe('timeout')
    expect(computeReturnState({ status: 'success', elapsedMs: 75_000, profile: null, nowMs: NOW })).toBe('timeout')
  })

  it('cancelled => cancelled regardless of elapsed/profile (R6.3)', () => {
    expect(
      computeReturnState({
        status: 'cancelled',
        elapsedMs: 90_000,
        profile: { tier: 'pro', paidUntil: FUTURE },
        nowMs: NOW,
      }),
    ).toBe('cancelled')
  })

  it('failed => failed regardless of elapsed/profile (R6.3)', () => {
    expect(
      computeReturnState({
        status: 'failed',
        elapsedMs: 90_000,
        profile: { tier: 'pro', paidUntil: FUTURE },
        nowMs: NOW,
      }),
    ).toBe('failed')
  })
})

describe('parseReturnStatus', () => {
  it('parses each recognised status value', () => {
    expect(parseReturnStatus('?status=success')).toBe('success')
    expect(parseReturnStatus('?status=cancelled')).toBe('cancelled')
    expect(parseReturnStatus('?status=failed')).toBe('failed')
  })

  it('returns null for missing or unrecognised status', () => {
    expect(parseReturnStatus('')).toBeNull()
    expect(parseReturnStatus('?foo=bar')).toBeNull()
    expect(parseReturnStatus('?status=pending')).toBeNull()
    expect(parseReturnStatus('?status=SUCCESS')).toBeNull()
    expect(parseReturnStatus('?status=')).toBeNull()
  })

  it('reads status among other query params', () => {
    expect(parseReturnStatus('?plan=growth&status=success&x=1')).toBe('success')
  })
})
