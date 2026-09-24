/**
 * Going, client side (proof-of-demand R9.2, R9.3).
 *
 * Two things live here and nowhere else: the calls that toggle a consumer's
 * intent for tonight, and the pure rules that decide what a consumer is allowed
 * to be told about other people's intent.
 *
 * Going is INTENT. It is not presence, and no helper here may be read as one:
 * nothing in this module feeds pulse, the live count, momentum, beam brightness
 * or `vibeRank` (`honest-presence.md`, R9.4). The count is a separate line beside
 * those signals, and its wording is always "marked going", never "coming" or
 * "will arrive" (R9.3).
 *
 * Sibling of `venueOpen.ts`: a small dedicated client module for one feature's
 * calls, rather than growing `api.ts`.
 */
import { GOING_PUBLIC_THRESHOLD } from '../constants/attribution'

import { api } from './api'

/** What a toggle reports back. Mirrors the service's `GoingState` (R9.1). */
export interface GoingState {
  /** The night the server recorded the mark against (04:00 SAST rollover). */
  date: string
  goingCount: number
  viewerGoing: boolean
}

/**
 * The Going pair on a venue read: the true count and, when a token identified
 * the reader, their own mark. `viewerGoing` is absent for an anonymous read
 * because "not marked" and "we do not know who you are" are different facts.
 */
export interface GoingRead {
  goingCount: number
  viewerGoing?: boolean
}

/**
 * How many marks a consumer surface may name, or `null` for "say nothing".
 *
 * The one rule for both consumer surfaces (venue card and detail block), so the
 * card and the sheet can never disagree about whether tonight has momentum:
 * a count is shown only at or above {@link GOING_PUBLIC_THRESHOLD} AND only when
 * the venue has a Tonight (R9.2). One or two marks read as empty rather than as
 * momentum, and a count with no published night has nothing to be about.
 *
 * Total and side-effect free: a missing, null or non-finite count is "say
 * nothing", never a zero nobody measured.
 */
export function goingCountToShow(goingCount: number | null | undefined, hasTonight: boolean): number | null {
  if (!hasTonight) return null
  if (typeof goingCount !== 'number' || !Number.isFinite(goingCount)) return null
  const count = Math.floor(goingCount)
  return count >= GOING_PUBLIC_THRESHOLD ? count : null
}

/**
 * Which prompt the detail Going control offers.
 *
 * - `marked`: this consumer has already marked going; the control withdraws it.
 * - `be_first`: nobody has marked yet and there is a Tonight to be first to.
 * - `mark_going`: the plain invitation.
 *
 * `be_first` is deliberately restricted to a measured zero. The spec's rule is
 * that a count below the threshold is not shown, and that is honoured by
 * {@link goingCountToShow}; but telling someone they would be "the first" when
 * two people already marked is a claim that is simply not true, and
 * `honest-presence.md` does not allow a surface to say more than the data
 * supports. One or two marks therefore get the neutral invitation: no count, no
 * false claim about where the consumer stands.
 *
 * Without a Tonight the prompt is never `be_first` (R9.2): the card and the
 * sheet only ever talk about being first when there is a published night.
 */
export type GoingPrompt = 'marked' | 'be_first' | 'mark_going'

export function goingPrompt(input: {
  goingCount: number | null | undefined
  hasTonight: boolean
  viewerGoing: boolean
}): GoingPrompt {
  if (input.viewerGoing) return 'marked'
  if (input.hasTonight && input.goingCount === 0) return 'be_first'
  return 'mark_going'
}

/**
 * Read the Going pair for a venue from the one authoritative venue read.
 *
 * The city payload carries `goingCount` but never `viewerGoing` (it is a shared
 * cached payload), so a control that must show the consumer their own mark reads
 * the venue detail. Throws on failure: the control shows the mark as unknown
 * rather than guessing, and the caller decides what to say.
 */
export async function readGoingState(nodeId: string): Promise<GoingRead> {
  const detail = await api.get<GoingRead>(`/v1/nodes/${encodeURIComponent(nodeId)}/detail`)
  return { goingCount: detail.goingCount, viewerGoing: detail.viewerGoing }
}

/**
 * Mark going tonight. The night is the server's to derive (04:00 SAST
 * rollover), so nothing is claimed here; the response reports which night the
 * mark landed on.
 *
 * `remind` records the Tonight_Reminder opt-in on the same row (R9.6). The write
 * is idempotent, so the opt-in can arrive on a second call after the consumer
 * taps "remind me when it starts" without making a second mark. It is never
 * inferred: only an explicit tap sets it.
 *
 * Throws on failure. Unlike a Venue_Open, this is an action the consumer asked
 * for, so a failure must be visible rather than swallowed.
 */
export async function markGoing(nodeId: string, opts?: { remind?: boolean }): Promise<GoingState> {
  const body = opts?.remind === true ? { remind: true } : {}
  return api.post<GoingState>(`/v1/nodes/${encodeURIComponent(nodeId)}/going`, body)
}

/**
 * Withdraw the mark. The night is passed when the caller knows which one the
 * mark landed on, so a consumer can always undo intent they recorded, including
 * after the 04:00 rollover has moved the server's idea of "tonight" on. Omitted,
 * the server derives the current night: the rollover rule has one home, on the
 * server, and is not restated here.
 */
export async function unmarkGoing(nodeId: string, date?: string): Promise<GoingState> {
  const query = date === undefined ? '' : `?date=${encodeURIComponent(date)}`
  return api.delete<GoingState>(`/v1/nodes/${encodeURIComponent(nodeId)}/going${query}`)
}
