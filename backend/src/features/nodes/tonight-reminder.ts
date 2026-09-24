/**
 * Tonight_Reminder: telling the people who marked going that the night is
 * starting (proof-of-demand R9.6, R9.7, R9.10).
 *
 * Rides the existing schedule transition tick. At a Dated_Slot start the tick
 * calls in here with the venue and the night; there is no timer, no queue and no
 * new Lambda, because the tick already wakes on every slot boundary
 * (`serverless-only.md`, decision 4 in `docs/decisions/proof-of-demand.md`).
 *
 * Three rules hold this honest:
 *
 *  - Once per row. The row is claimed with a conditional update BEFORE the send,
 *    so a duplicate tick or a re-run cannot put a second notification on the same
 *    phone. A send that fails after the claim is a reminder lost, which is the
 *    right way round for a push that cannot be recalled.
 *  - Opt-in only. Delivery goes through `sendNotification`, whose preference gate
 *    reads `tonightReminder`, so a consumer who marked going but never asked to
 *    be told is never reached (R9.6, R10.5). The row's `remindAt` is the record
 *    of the tap; the preference is the record of the consent. Both must agree.
 *  - Only a night that is still on. The tick reads the schedule as it stands, so
 *    a deleted or moved slot produces no start and no reminder. Existing Going
 *    rows survive an edit, because the intent was real (R9.10).
 *
 * The copy states what is happening now. Nothing here may say a person is
 * "coming" or "will arrive": a mark is intent, and the reminder is about the
 * venue's night, not about anybody's movement (R9.3, `honest-presence.md`).
 */

import { pushVenueUrl } from '../../shared/links/venue-arrival.js'
import { sendNotification } from '../notifications/service.js'

import * as goingRepo from './going-repository.js'
import * as repo from './repository.js'

/** What one fan-out did, folded into the tick's own metric line. */
export interface TonightReminderOutcome {
  /** Rows that asked for a reminder and had not had one. */
  candidates: number
  /** Rows this call claimed and sent for. */
  sent: number
  /** Rows another tick had already claimed. */
  alreadyReminded: number
  /** Rows claimed whose delivery threw. */
  failed: number
}

const EMPTY: TonightReminderOutcome = { candidates: 0, sent: 0, alreadyReminded: 0, failed: 0 }

/**
 * Notify everyone who asked to be told that this venue's night is starting.
 *
 * `headline` is the owner's one line for the night when they wrote one; without
 * it the reminder names the venue and says the night is starting, which is all
 * we actually know.
 */
export async function sendTonightReminders(input: {
  nodeId: string
  date: string
  headline: string | null
  nowIso?: string
}): Promise<TonightReminderOutcome> {
  const { nodeId, date, headline } = input
  const nowIso = input.nowIso ?? new Date().toISOString()
  const nowSeconds = Math.floor(new Date(nowIso).getTime() / 1000)

  const rows = await goingRepo.listGoingAwaitingReminder(nodeId, date, nowSeconds)
  if (rows.length === 0) return EMPTY

  // One venue read for the name, and only when there is somebody to tell.
  const node = await repo.getNodeById(nodeId)
  const venueName = node?.name ?? ''
  const body = reminderBody(venueName, headline)

  const outcome: TonightReminderOutcome = { candidates: rows.length, sent: 0, alreadyReminded: 0, failed: 0 }

  for (const row of rows) {
    const claimed = await goingRepo.claimGoingReminder({ userId: row.userId, nodeId, date }, nowIso)
    if (!claimed) {
      outcome.alreadyReminded++
      continue
    }

    try {
      await sendNotification({
        userId: row.userId,
        type: 'tonight_reminder',
        title: venueName === '' ? 'Tonight is starting' : `Tonight at ${venueName}`,
        body,
        // Click-through lands on the venue card with `src=push`, through the one
        // home for that link shape (R2.1).
        data: { nodeId, date, ...pushVenueUrl(node?.slug) },
      })
      outcome.sent++
    } catch (err) {
      // The row stays claimed: one lost reminder beats a duplicate on a retry.
      // Logged loudly so a broken delivery path is visible rather than quiet.
      console.error(`[tonight-reminder] delivery failed for node ${nodeId} night ${date}`, err)
      outcome.failed++
    }
  }

  return outcome
}

/**
 * The reminder sentence. Present tense about the venue's night, never about the
 * consumer: "starting now" is a fact about the room, "coming" would be a claim
 * about a person (R9.3).
 */
function reminderBody(venueName: string, headline: string | null): string {
  const where = venueName === '' ? 'The night you marked going for' : venueName
  if (headline !== null && headline !== '') return `${headline} is starting now at ${where}.`
  return `${where} is starting now.`
}
