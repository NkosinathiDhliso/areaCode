/**
 * Going service (proof-of-demand R9.1, R9.2).
 *
 * The layer between the two routes and the rows: it decides which night a mark
 * belongs to, checks the venue exists, and gives the venue reads their counts.
 *
 * Going is intent and only intent. Nothing here touches presence, pulse,
 * momentum or any ranking input, and nothing that does may read from here
 * (`honest-presence.md`, R9.4). The count is a separate number on the payload
 * next to `tonight`, never folded into an aliveness figure.
 */

import { DEV_MODE } from '../../shared/config/env.js'
import { AppError } from '../../shared/errors/AppError.js'
import { emitBusinessGoing } from '../../shared/socket/events.js'

import * as goingRepo from './going-repository.js'
import { goingNightFor } from './going.js'
import * as repo from './repository.js'

/** What a toggle reports back: the stored count and this consumer's own state. */
export interface GoingState {
  date: string
  goingCount: number
  viewerGoing: boolean
}

/**
 * Resolve the night a request is about.
 *
 * The server is the authority: it derives the night from its own clock with the
 * 04:00 SAST rollover. A client may state which night it believes it is marking,
 * and a mismatch is rejected rather than silently written to the server's night,
 * so a stale screen left open across the rollover cannot record intent for a
 * night the consumer never chose.
 *
 * Only tonight can be marked. There is no surface that offers a future night, so
 * there is no rule here for one (`no-fallbacks-no-legacy.md`: build the seam when
 * the second real caller exists).
 */
export function resolveGoingNight(claimed: string | undefined, nowIso: string): string {
  const night = goingNightFor(nowIso)
  if (claimed !== undefined && claimed !== night) {
    throw AppError.badRequest('That night has moved on. Reload the venue and mark going again.')
  }
  return night
}

/**
 * Mark going. Marking twice is one row and reports the same count (R9.1).
 *
 * `remind` is the Tonight_Reminder opt-in (R9.6). It rides the same call rather
 * than getting a route of its own: the consumer taps "remind me when it starts"
 * straight after marking, the write is idempotent, so the second call adds the
 * opt-in to the row the first one made. Omitted or false leaves an existing
 * opt-in alone; withdrawing the reminder is the notification preference's job,
 * which is the one home for what a consumer agreed to be sent.
 */
export async function markGoing(
  userId: string,
  nodeId: string,
  claimedDate: string | undefined,
  remind = false,
): Promise<GoingState> {
  const nowIso = new Date().toISOString()
  const date = resolveGoingNight(claimedDate, nowIso)
  const node = await loadNode(nodeId)

  await goingRepo.putGoing({ userId, nodeId, date }, nowIso, remind ? { remindAt: nowIso } : undefined)
  const goingCount = await countFor(nodeId, date)
  await announceGoing(node, nodeId, date, goingCount)
  return { date, goingCount, viewerGoing: true }
}

/**
 * Unmark going. Removing a mark that is not there is success, not an error, so a
 * double tap or a retry leaves the same honest count.
 *
 * The night is taken from the request when given, without the write path's
 * agreement check: a consumer must always be able to withdraw intent they
 * recorded, including for a night that has since rolled over.
 */
export async function unmarkGoing(
  userId: string,
  nodeId: string,
  claimedDate: string | undefined,
): Promise<GoingState> {
  const date = claimedDate ?? goingNightFor()
  const node = await loadNode(nodeId)

  await goingRepo.deleteGoing({ userId, nodeId, date })
  const goingCount = await countFor(nodeId, date)
  await announceGoing(node, nodeId, date, goingCount)
  return { date, goingCount, viewerGoing: false }
}

/**
 * The count for one venue tonight, plus the viewer's own state when there is a
 * viewer. Backs the node detail (R9.2); `viewerGoing` is omitted for an
 * anonymous reader rather than reported as false, because "not marked" and "we
 * do not know who you are" are different facts.
 */
export async function readGoingForNode(
  nodeId: string,
  viewerUserId: string | null,
): Promise<{ goingCount: number; viewerGoing?: boolean }> {
  const date = goingNightFor()
  const nowSeconds = nowEpochSeconds()
  const goingCount = await goingRepo.countGoing(nodeId, date, nowSeconds)
  if (viewerUserId === null) return { goingCount }
  return { goingCount, viewerGoing: await goingRepo.isGoing({ userId: viewerUserId, nodeId, date }, nowSeconds) }
}

/**
 * Going counts for the venues on the map, keyed by node id.
 *
 * Shaped like `loadTonightByBusiness` (task 9.2) rather than adding a read per
 * node to the map's hot path: the caller passes only the nodes whose count can
 * actually be shown, which is the ones with a Tonight (R9.2), so a city of
 * venues costs a handful of counts and usually none. Nodes the caller leaves out
 * are simply absent from the map, and the payload reports `null` for them rather
 * than a zero nobody measured.
 *
 * A count that fails to read is omitted and logged at error level: the map must
 * not go blank because one partition could not be counted, and saying nothing
 * about Going is the honest outcome (`no-fallbacks-no-legacy.md`).
 */
export async function loadGoingCountByNode(nodeIds: readonly string[]): Promise<Map<string, number>> {
  const distinct = [...new Set(nodeIds.filter((id) => id !== ''))]
  const counts = new Map<string, number>()
  if (distinct.length === 0) return counts

  const date = goingNightFor()
  const nowSeconds = nowEpochSeconds()
  const read = await Promise.all(
    distinct.map(async (nodeId) => {
      try {
        return await goingRepo.countGoing(nodeId, date, nowSeconds)
      } catch (err) {
        console.error(`[going] count failed for node ${nodeId} on ${date}`, err)
        return null
      }
    }),
  )

  read.forEach((count, i) => {
    if (count !== null) counts.set(distinct[i]!, count)
  })
  return counts
}

// ─── Internals ───────────────────────────────────────────────────────────────

function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

async function countFor(nodeId: string, date: string): Promise<number> {
  return goingRepo.countGoing(nodeId, date, nowEpochSeconds())
}

/**
 * Read the venue a mark is about, rejecting one that does not exist so the table
 * cannot collect rows in partitions nothing will ever count or erase.
 *
 * Returns the venue so the caller can address the owner's business room without a
 * second read. Dev venues are fixtures rather than rows (`dev-nodes.ts`), so
 * there is nothing to read there and nothing to announce; every other venue read
 * in this feature branches the same way.
 */
type GoingVenue = Awaited<ReturnType<typeof repo.getNodeById>>

async function loadNode(nodeId: string): Promise<GoingVenue> {
  if (DEV_MODE) return null
  const node = await repo.getNodeById(nodeId)
  if (!node) throw AppError.notFound('Node not found')
  return node
}

/**
 * Tell the owner their pipeline moved (R9.5).
 *
 * Awaited, not fire-and-forget: Lambda freezes the process the moment the handler
 * returns, so an un-awaited emit is silently lost. The emitter swallows its own
 * fan-out failures, so a dark socket never fails the write that has already
 * committed.
 *
 * Aggregate only: the count and the night, never who marked. A venue with no
 * owning business has no room to address, so nothing is sent.
 */
async function announceGoing(node: GoingVenue, nodeId: string, date: string, goingCount: number): Promise<void> {
  const businessId = node?.businessId
  if (!businessId) return
  await emitBusinessGoing(businessId, { nodeId, nodeName: node?.name ?? '', date, goingCount })
}
