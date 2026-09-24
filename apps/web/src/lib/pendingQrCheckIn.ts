/**
 * Pending QR check-in stash (R15.19).
 *
 * An unauthenticated visitor who scans a venue poster lands on `/qr/{nodeId}/
 * {token}` and is sent to sign in. The pair is stashed for the tab so `App`
 * can send them back to the same deep link once authenticated, which is the
 * only reason the check-in survives the round trip.
 *
 * Both sides of that round trip live here so the key and the payload shape have
 * one home, and both go through `safeStorage`: private-mode browsers throw, and
 * the write reports whether it landed so the screen can stop promising a return
 * it cannot deliver. Sibling of `venueArrival.ts`.
 */
import { readStoredJson, removeStored, writeStoredJson } from '@area-code/shared/lib/safeStorage'

/** sessionStorage key for the pending scan. */
export const PENDING_QR_CHECK_IN_KEY = 'pendingQrCheckIn'

export interface PendingQrCheckIn {
  nodeId: string
  token: string
}

/** Stash the scan, returning whether it will survive the sign-in round trip. */
export function stashQrCheckIn(pending: PendingQrCheckIn): boolean {
  return writeStoredJson('session', PENDING_QR_CHECK_IN_KEY, pending)
}

/** The stashed scan, or null when there is none or it is unreadable. */
export function readQrCheckIn(): PendingQrCheckIn | null {
  const parsed = readStoredJson('session', PENDING_QR_CHECK_IN_KEY) as {
    nodeId?: unknown
    token?: unknown
  } | null
  if (!parsed) return null
  const { nodeId, token } = parsed
  if (typeof nodeId !== 'string' || typeof token !== 'string') return null
  if (nodeId.length === 0 || token.length === 0) return null
  return { nodeId, token }
}

export function clearQrCheckIn(): void {
  removeStored('session', PENDING_QR_CHECK_IN_KEY)
}
