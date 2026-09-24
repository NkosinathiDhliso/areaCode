// The Receipt, in words. One home for every owner-facing "found you" sentence.
//
// Feature: proof-of-demand (R4.4, R4.5, R4.6, R4.7, R5.5, R6.3)
//
// `computeReceipt` produces the numbers; this produces the sentences the live
// panel, the Monday digest, the trial and renewal emails, the Plans panel and
// the boost scoreboard all render. Structured strings, never JSX, so an email
// template and a React panel read the identical words and the honest-copy
// property test only has one function to quantify over.
//
// Three honesty rules are enforced here in code, not left to reviewer vigilance:
//
// 1. Measurement verbs only. Area Code recorded that a consumer found the venue
//    and checked in. It never "brought", "drove", "generated" or "boosted"
//    anyone (`BANNED_CAUSAL_VERBS`).
// 2. Suppressed values say less rather than rendering a zero. A first-timer or
//    per-source clause below the Suppression_Floor, or never measured at all, is
//    omitted. An omitted clause is honest; "0 of them" is not.
// 3. A zero Found_You window points at the missing step, never at failure. With
//    an incomplete Onboarding_Checklist the next step is the flag that is
//    actually false, so the owner reads "print the QR", not "nobody came".

import { OPEN_SOURCES, OPEN_SOURCE_PHRASE } from '@area-code/shared/constants/attribution'
import type { OnboardingChecklistStep, OnboardingStatus } from '@area-code/shared/types'

import { formatSastDate } from '../../shared/time/sast.js'

import type { Receipt } from './receipt.js'

/**
 * The window a Receipt covers, as a closed set of phrases rather than free
 * text. A caller cannot smuggle an unreviewed clause (or a causal verb) into
 * owner-facing copy through this parameter.
 *
 * - `week`: the Digest_Week (Monday digest).
 * - `trial`: the 14-day trial window (trial reminder emails, Plans panel).
 * - `paid`: the current paid period (renewal reminder).
 * - `today`: the SAST day (live panel).
 * - `window`: unqualified, for a surface that states its own window.
 */
export type ReceiptWindowLabel = 'week' | 'trial' | 'paid' | 'today' | 'window'

const WINDOW_PHRASE: Record<ReceiptWindowLabel, string> = {
  week: ' this week',
  trial: ' during your trial',
  paid: ' during your paid period',
  today: ' today',
  window: '',
}

/** The single constructive step offered when Found_You is zero. */
export type ReceiptNextStepId = 'add_venue' | 'publish_get' | 'print_qr' | 'invite_staff' | 'share_and_tonight'

/**
 * Exactly one next step, as data. `step` names the Onboarding_Checklist flag it
 * completes so the business portal can deep-link the card row to the panel
 * without the copy builder knowing anything about portal navigation.
 */
export interface ReceiptNextStep {
  id: ReceiptNextStepId
  step: OnboardingChecklistStep | null
  text: string
}

const NEXT_STEP_TEXT: Record<ReceiptNextStepId, string> = {
  add_venue: 'Add your venue so it appears on the map.',
  publish_get: 'Publish one get so a first-timer has a reason to walk in.',
  print_qr: 'Turn on QR check-in and put the code where customers order.',
  invite_staff: 'Invite a staff member so redemptions get validated at the till.',
  share_and_tonight: 'Share your venue link with your regulars, and publish what is on tonight.',
}

/**
 * The Receipt as sentences. Every field is either a finished sentence or `null`
 * (nothing to say honestly). `lines` is the same content in render order, which
 * is what a plain-text email and the dashboard card both consume.
 */
export interface ReceiptCopy {
  /** Lead sentence. The Found_You count, or the plain zero statement. */
  headline: string
  /** The "already in the room" line. Always present, never a padded number. */
  walkIn: string
  /** "N of them had never been in before." Null when below the floor or unmeasured. */
  firstTimers: string | null
  /** Per-source breakdown. Null below the Suppression_Floor. */
  bySource: string | null
  /** Partial-window annotation. Null when the whole window was measured. */
  measuredFrom: string | null
  /** Exactly one step when Found_You is zero, null otherwise. */
  nextStep: ReceiptNextStep | null
  /** Every non-null sentence above, in render order, next step last. */
  lines: string[]
}

const people = (n: number): string => (n === 1 ? 'person' : 'people')

/**
 * The one step to offer when Found_You is zero.
 *
 * Priority is the order that actually produces a first check-in: a venue on the
 * map, then a reason to walk in, then the QR that records the visit, then staff
 * to validate redemptions. When every flag is true (or no checklist was read)
 * the venue is set up and the gap is reach, so the step is the share and Tonight
 * pair (R6.3).
 */
function pickNextStep(checklist: OnboardingStatus | null): ReceiptNextStep {
  const step = ((): { id: ReceiptNextStepId; step: OnboardingChecklistStep | null } => {
    if (checklist === null) return { id: 'share_and_tonight', step: null }
    if (!checklist.hasNode) return { id: 'add_venue', step: 'venue' }
    if (!checklist.hasReward) return { id: 'publish_get', step: 'reward' }
    if (!checklist.hasQr) return { id: 'print_qr', step: 'qr' }
    if (!checklist.hasStaff) return { id: 'invite_staff', step: 'staff' }
    return { id: 'share_and_tonight', step: null }
  })()

  return { ...step, text: NEXT_STEP_TEXT[step.id] }
}

/** "6 from the map, 2 from a shared link". Zero sources are omitted. */
function bySourceClause(receipt: Receipt): string | null {
  // The per-source split divides the Found_You count, so it needs the floor
  // (R4.8). Below it the clause is dropped rather than rendered at low counts.
  if (receipt.suppressed.includes('bySource')) return null

  const parts = OPEN_SOURCES.filter((source) => receipt.bySource[source] > 0).map(
    (source) => `${receipt.bySource[source]} ${OPEN_SOURCE_PHRASE[source]}`,
  )
  if (parts.length === 0) return null

  return `Recorded sources: ${parts.join(', ')}.`
}

/**
 * Build the owner-facing Receipt copy.
 *
 * @param receipt The computed Receipt for the window.
 * @param checklist The Onboarding_Checklist flags, when the caller has read
 *   them. Pass `null` to skip the checklist nudge; the zero branch then offers
 *   the share and Tonight step.
 * @param windowLabel Which window the sentences describe.
 */
export function buildReceiptCopy(
  receipt: Receipt,
  checklist: OnboardingStatus | null = null,
  windowLabel: ReceiptWindowLabel = 'window',
): ReceiptCopy {
  const phrase = WINDOW_PHRASE[windowLabel]
  const { foundYouVisitors, walkInVisitors, foundYouFirstTimers } = receipt

  const zero = foundYouVisitors === 0

  // Zero branch: stated plainly, with no number in the headline, so a quiet
  // window never reads as "0 people found you" (R4.7, R6.3).
  const headline = zero
    ? `No one has found you on Area Code and checked in${phrase} yet.`
    : `${foundYouVisitors} ${people(foundYouVisitors)} found you on Area Code and checked in${phrase}.`

  const walkIn =
    walkInVisitors > 0
      ? `${walkInVisitors} ${people(walkInVisitors)} who ${walkInVisitors === 1 ? 'was' : 'were'} already in the room ` +
        `also checked in.`
      : 'No check-ins were recorded from people already in the room.'

  // Unmeasured and below-floor first-timers are both listed in `suppressed`, and
  // neither is the fact "zero first-timers", so the clause is omitted instead.
  const firstTimers =
    zero || receipt.suppressed.includes('foundYouFirstTimers')
      ? null
      : `${foundYouFirstTimers} of them had never been in before.`

  const bySource = zero ? null : bySourceClause(receipt)

  const measuredFrom =
    receipt.measuredFrom === null
      ? null
      : `Area Code has recorded how people found you since ${formatSastDate(receipt.measuredFrom)}, ` +
        `so part of this window predates the measurement.`

  const nextStep = zero ? pickNextStep(checklist) : null

  const lines = [headline, walkIn, firstTimers, bySource, measuredFrom, nextStep?.text ?? null].filter(
    (line): line is string => line !== null,
  )

  return { headline, walkIn, firstTimers, bySource, measuredFrom, nextStep, lines }
}
