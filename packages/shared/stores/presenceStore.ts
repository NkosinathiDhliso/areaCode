import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

/**
 * Active-presence store - the single source of truth for the current user's
 * own open presence ("am I checked in here right now"), keyed by nodeId. It
 * exists so the venue surface can decide whether to show the Check_Out_CTA
 * without ever fabricating a presence the backend does not hold.
 *
 * Honesty rules (honest-presence.md, honest-presence-ui R3):
 * - A node is `present` only after the current user's own successful presence
 *   or reward check-in in this session. It is never reconstructed from
 *   persisted or third-party state.
 * - Cleared on a successful check-out, on the backend `no_active_presence`
 *   no-op result, and on logout.
 * - We do NOT infer the user's own expiry from `node:presence_update` (that
 *   event carries no identity by design), so a count dropping to 0 does not
 *   flip a local flag; a stray check-out remains a safe backend no-op.
 *
 * Client-memory only; never persisted. On reload the map starts with no active
 * presence, so the Check_Out_CTA is hidden until the user checks in again. This
 * deliberately avoids re-implementing the backend's Expiry_Window logic
 * client-side (which would duplicate a presence-integrity constant and risk
 * drift).
 *
 * Validates: Requirements 3.1, 3.3, 5.1
 */

export interface PresenceState {
  /** The current user's own open presence, keyed by nodeId. */
  activePresence: Record<string, { checkedInAt: number }>
  /** Record the user's own successful check-in at a venue. */
  setPresent: (nodeId: string) => void
  /** Clear the user's presence at a venue (on check-out / no-op result). */
  clearPresent: (nodeId: string) => void
  /** Reset all active presence. Called on logout. */
  clear: () => void
  /** True only when the current user holds active presence at the node. */
  isPresent: (nodeId: string) => boolean
}

export const usePresenceStore = create<PresenceState>()(
  immer((set, get) => ({
    activePresence: {},

    setPresent: (nodeId) =>
      set((state) => {
        state.activePresence[nodeId] = { checkedInAt: Date.now() }
      }),

    clearPresent: (nodeId) =>
      set((state) => {
        delete state.activePresence[nodeId]
      }),

    clear: () =>
      set((state) => {
        state.activePresence = {}
      }),

    isPresent: (nodeId) => nodeId in get().activePresence,
  })),
)
