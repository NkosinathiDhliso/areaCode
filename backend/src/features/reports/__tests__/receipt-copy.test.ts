/**
 * `buildReceiptCopy` examples: the exact sentences an owner reads, and the four
 * branches that decide whether a number is said at all. The universal rules
 * (banned verbs, one next step, no suppressed zero) are quantified in
 * `digest-copy.property.test.ts`.
 *
 * Feature: proof-of-demand (R4.4, R4.5, R4.6, R4.7, R5.5, R6.3)
 */

import type { OnboardingStatus } from '@area-code/shared/types'
import { describe, expect, it } from 'vitest'

import { buildReceiptCopy } from '../receipt-copy.js'
import type { Receipt, ReceiptMetricName } from '../receipt.js'

const COMPLETE: OnboardingStatus = { hasNode: true, hasReward: true, hasStaff: true, hasQr: true }

function receiptOf(overrides: Partial<Receipt> = {}): Receipt {
  const base: Receipt = {
    foundYouVisitors: 9,
    walkInVisitors: 12,
    uniqueVisitors: 21,
    foundYouFirstTimers: 6,
    bySource: { map: 6, share: 2, search: 1, push: 0 },
    suppressed: [],
    measuredFrom: null,
  }
  return { ...base, ...overrides }
}

describe('buildReceiptCopy — the measured window', () => {
  it('leads on Found_You and follows with the room, with the window phrase', () => {
    const copy = buildReceiptCopy(receiptOf(), COMPLETE, 'trial')

    expect(copy.headline).toBe('9 people found you on Area Code and checked in during your trial.')
    expect(copy.walkIn).toBe('12 people who were already in the room also checked in.')
    expect(copy.firstTimers).toBe('6 of them had never been in before.')
    expect(copy.bySource).toBe('Recorded sources: 6 from the map, 2 from a shared link, 1 from search.')
    expect(copy.nextStep).toBeNull()
    expect(copy.lines).toEqual([copy.headline, copy.walkIn, copy.firstTimers, copy.bySource])
  })

  it('says one person, not 1 people', () => {
    const copy = buildReceiptCopy(
      receiptOf({
        foundYouVisitors: 1,
        walkInVisitors: 1,
        uniqueVisitors: 2,
        bySource: { map: 1, share: 0, search: 0, push: 0 },
        suppressed: ['foundYouVisitors', 'walkInVisitors', 'foundYouFirstTimers', 'bySource', 'uniqueVisitors'],
      }),
    )

    expect(copy.headline).toBe('1 person found you on Area Code and checked in.')
    expect(copy.walkIn).toBe('1 person who was already in the room also checked in.')
  })

  it('states an empty room instead of a zero', () => {
    const copy = buildReceiptCopy(receiptOf({ walkInVisitors: 0, uniqueVisitors: 9 }))

    expect(copy.walkIn).toBe('No check-ins were recorded from people already in the room.')
  })

  it('omits a suppressed first-timer clause rather than rendering zero', () => {
    const suppressed: ReceiptMetricName[] = ['foundYouFirstTimers']
    const copy = buildReceiptCopy(receiptOf({ foundYouFirstTimers: 0, suppressed }))

    expect(copy.firstTimers).toBeNull()
    expect(copy.lines.join(' ')).not.toContain('never been in before')
  })

  it('omits the per-source clause below the floor', () => {
    const copy = buildReceiptCopy(receiptOf({ suppressed: ['bySource'] }))

    expect(copy.bySource).toBeNull()
  })

  it('annotates a window that opens before measurement started', () => {
    const copy = buildReceiptCopy(receiptOf({ measuredFrom: '2026-09-27T22:00:00.000Z' }))

    expect(copy.measuredFrom).toContain('has recorded how people found you since')
    expect(copy.measuredFrom).toContain('predates the measurement')
    expect(copy.lines).toContain(copy.measuredFrom)
  })
})

describe('buildReceiptCopy — the zero Found_You branch', () => {
  const zeroReceipt = receiptOf({
    foundYouVisitors: 0,
    walkInVisitors: 4,
    uniqueVisitors: 4,
    foundYouFirstTimers: 0,
    bySource: { map: 0, share: 0, search: 0, push: 0 },
    suppressed: ['foundYouVisitors', 'foundYouFirstTimers', 'bySource', 'uniqueVisitors', 'walkInVisitors'],
  })

  it('states the quiet window plainly, with no number in the headline', () => {
    const copy = buildReceiptCopy(zeroReceipt, COMPLETE, 'week')

    expect(copy.headline).toBe('No one has found you on Area Code and checked in this week yet.')
    expect(copy.headline).not.toMatch(/\d/)
    expect(copy.firstTimers).toBeNull()
    expect(copy.bySource).toBeNull()
  })

  it('points at the first missing checklist step, not at failure', () => {
    const copy = buildReceiptCopy(zeroReceipt, { ...COMPLETE, hasQr: false }, 'trial')

    expect(copy.nextStep).toEqual({
      id: 'print_qr',
      step: 'qr',
      text: 'Turn on QR check-in and put the code where customers order.',
    })
    expect(copy.lines.at(-1)).toBe(copy.nextStep?.text)
  })

  it('prefers the earliest missing step when several flags are false', () => {
    const copy = buildReceiptCopy(zeroReceipt, { hasNode: false, hasReward: false, hasStaff: false, hasQr: false })

    expect(copy.nextStep?.step).toBe('venue')
  })

  it('offers share and Tonight when the checklist is complete', () => {
    const copy = buildReceiptCopy(zeroReceipt, COMPLETE)

    expect(copy.nextStep?.id).toBe('share_and_tonight')
    expect(copy.nextStep?.step).toBeNull()
  })

  it('offers share and Tonight when no checklist was read', () => {
    const copy = buildReceiptCopy(zeroReceipt, null)

    expect(copy.nextStep?.id).toBe('share_and_tonight')
  })
})
