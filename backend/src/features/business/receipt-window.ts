// Which window a Receipt request describes, resolved from the subscription.
//
// Feature: proof-of-demand (R6.2)
//
// `computeReceipt` owns the arithmetic and `buildReceiptCopy` owns the words;
// this owns only the question "which instants does 'during your trial' mean for
// this business". Pure and total apart from a stated-fact failure, so the three
// windows are property- and unit-testable without DynamoDB.

import type { ReceiptWindowName } from '@area-code/shared/types'

import { AppError } from '../../shared/errors/AppError.js'
import { digestWeekFor } from '../reports/digest.js'
import type { ReceiptWindowLabel } from '../reports/receipt-copy.js'
import type { ReceiptWindow } from '../reports/receipt.js'

import { TRIAL_DAYS } from './types.js'

/**
 * The three windows the endpoint accepts. `satisfies` ties them to the copy
 * builder's window labels, so a window can never reach `buildReceiptCopy`
 * without a reviewed phrase to render.
 */
export const RECEIPT_WINDOW_NAMES = ['trial', 'paid', 'week'] as const satisfies readonly ReceiptWindowLabel[]

/**
 * What the subscription states about the business's windows. Read once by the
 * service; `paidPeriodStart` is the `paidAt` of the most recent
 * Subscription_Payment_Row (the moment the current paid window was bought), so
 * the paid period is a stored fact rather than a second piece of billing
 * arithmetic.
 */
export interface SubscriptionWindowFacts {
  trialEndsAt: string | null
  paidPeriodStart: string | null
  paidPeriodEnd: string | null
}

function instant(iso: string, field: string): number {
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) {
    throw new Error(`resolveReceiptWindow: invalid ${field} "${iso}"`)
  }
  return ms
}

/**
 * Resolve the half-open window a Receipt request covers.
 *
 * - `trial`: the 14-day trial, `trialEndsAt - TRIAL_DAYS` to `trialEndsAt`.
 * - `paid`: the current paid period, from the payment that bought it to
 *   `paidUntil`.
 * - `week`: the current Digest_Week, straight from `digestWeekFor` so the panel
 *   and the Monday digest can never disagree about where a week starts.
 *
 * Trial and paid windows are clamped to `now`: a window that has not finished
 * yet is reported up to this instant, never out to a future end date that would
 * read as a measured period the business has not lived through.
 *
 * A business with no such window gets a stated 400, not a substituted window: a
 * receipt for a period that does not exist would be a fabricated number.
 */
export function resolveReceiptWindow(
  window: ReceiptWindowName,
  facts: SubscriptionWindowFacts,
  nowIso: string = new Date().toISOString(),
): ReceiptWindow {
  const nowMs = instant(nowIso, 'now')

  if (window === 'week') {
    const week = digestWeekFor(nowIso)
    return { windowStartUtc: week.windowStartUtc, windowEndUtc: week.windowEndUtc }
  }

  if (window === 'trial') {
    if (facts.trialEndsAt === null) {
      throw AppError.badRequest('This business has no trial window on record.')
    }
    const endsAtMs = instant(facts.trialEndsAt, 'trialEndsAt')
    return {
      windowStartUtc: new Date(endsAtMs - TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      windowEndUtc: new Date(Math.min(nowMs, endsAtMs)).toISOString(),
    }
  }

  if (facts.paidPeriodStart === null || facts.paidPeriodEnd === null) {
    throw AppError.badRequest('This business has no paid period on record.')
  }
  const startMs = instant(facts.paidPeriodStart, 'paidPeriodStart')
  const endMs = instant(facts.paidPeriodEnd, 'paidPeriodEnd')
  return {
    windowStartUtc: new Date(startMs).toISOString(),
    windowEndUtc: new Date(Math.min(nowMs, endMs)).toISOString(),
  }
}
