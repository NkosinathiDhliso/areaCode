import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Node, MapInstance } from '../types'

interface MapStore {
  nodes: Record<string, Node>
  pulseScores: Record<string, number>
  /**
   * Live check-in count per node, populated by the `node:pulse_update` socket
   * event. Distinct from `pulseScores` (a weighted vibe score): this is the
   * raw "how many people are here right now" headcount surfaced in the
   * node-flick toast and the buzzing/popping marker badge.
   */
  checkInCounts: Record<string, number>
  /**
   * Live-resolved Archetype id per node, populated by the
   * `node:archetype_change` socket event (see `useNodeArchetype`).
   * Cleared after the 5-minute retention window or replaced wholesale on
   * reconnect from the next live nodes payload (R11.6, R11.7).
   */
  archetypeIds: Record<string, string>
  /**
   * Friends currently checked in at each venue. Keyed by nodeId, value is an
   * array of mutual-friend userIds (deduplicated on insert). Seeded from
   * `GET /v1/friends/presence` on session start, updated via socket events
   * (`toast:friend_checkin`, `friend:checkout`). Cleared on logout (R3.3).
   */
  friendsAtVenue: Record<string, string[]>
  /**
   * Whether a venue has at least one live event or offer get. Derived from
   * the rewards-near-me response via `deriveHasLiveGets`. Used as priority-4
   * signal in the lexicographic ranking (R5.1, R5.2).
   */
  hasLiveGets: Record<string, boolean>
  mapInstance: MapInstance | null
  /**
   * Cross-screen focus signal: set by surfaces like the Gets list to ask the
   * map to fly to a node and open its detail sheet. The map screen consumes
   * the id and clears it. Decouples MapScreen from the screen that triggered
   * the focus.
   */
  focusNodeId: string | null
  setNodes: (nodes: Node[]) => void
  addNode: (node: Node) => void
  updateNodePulse: (nodeId: string, score: number, checkInCount?: number) => void
  /**
   * Honest live-presence count per node, populated by the `node:presence_update`
   * socket event (see `useNodePulse`). Writes only `checkInCounts` and leaves
   * `pulseScores` untouched, because the presence event carries no pulse score.
   * The presence value drives the map's "people here now" surface and takes
   * precedence over the cumulative `node:pulse_update.checkInCount` (R7.1, R8.3).
   */
  setLivePresenceCount: (nodeId: string, livePresenceCount: number) => void
  setArchetypeId: (nodeId: string, id: string) => void
  /**
   * Drop the cached Live_Archetype id for a node. Called by
   * `useNodeArchetype` after the 5-minute retention window (R11.6) so the
   * Node falls back to `defaultArchetypeId ?? 'archetype-eclectic'` until
   * the next `node:archetype_change` event or live nodes payload arrives.
   */
  clearArchetypeId: (nodeId: string) => void
  setMapInstance: (instance: MapInstance | null) => void
  setFocusNodeId: (nodeId: string | null) => void
  /** Bulk-replace the friends presence map. Takes `filterActiveFriends`' output directly. */
  setFriendsPresence: (byNode: Record<string, string[]>) => void
  /**
   * Add a single friend to a venue's presence list. No-op if the userId is
   * already present at that node (dedup), so a repeated `toast:friend_checkin`
   * never double-counts taste-match (R3.2, R3.6).
   */
  addFriendPresence: (nodeId: string, userId: string) => void
  /** Remove a single friend from a venue's presence list. */
  removeFriendPresence: (nodeId: string, userId: string) => void
  /** Reset friends presence to empty. Called on logout (R3.3). */
  clearFriendsPresence: () => void
  /** Bulk-set the hasLiveGets map from `deriveHasLiveGets` output. */
  setHasLiveGets: (map: Record<string, boolean>) => void
}

export const useMapStore = create<MapStore>()(
  immer((set) => ({
    nodes: {},
    pulseScores: {},
    archetypeIds: {},
    checkInCounts: {},
    friendsAtVenue: {},
    hasLiveGets: {},
    mapInstance: null,
    focusNodeId: null,
    setNodes: (nodes) =>
      set((state) => {
        for (const node of nodes) {
          state.nodes[node.id] = node
          if (node.pulseScore !== undefined) {
            state.pulseScores[node.id] = node.pulseScore
          }
          if (node.liveCheckInCount !== undefined) {
            state.checkInCounts[node.id] = node.liveCheckInCount
          }
        }
      }),
    addNode: (node) =>
      set((state) => {
        state.nodes[node.id] = node
      }),
    updateNodePulse: (nodeId, score, checkInCount) =>
      set((state) => {
        state.pulseScores[nodeId] = score
        if (checkInCount !== undefined) {
          state.checkInCounts[nodeId] = checkInCount
        }
      }),
    setLivePresenceCount: (nodeId, livePresenceCount) =>
      set((state) => {
        state.checkInCounts[nodeId] = livePresenceCount
      }),
    setArchetypeId: (nodeId, id) =>
      set((state) => {
        state.archetypeIds[nodeId] = id
      }),
    clearArchetypeId: (nodeId) =>
      set((state) => {
        delete state.archetypeIds[nodeId]
      }),
    setMapInstance: (instance) =>
      set((state) => {
        state.mapInstance = instance as MapInstance | null
      }),
    setFocusNodeId: (nodeId) =>
      set((state) => {
        state.focusNodeId = nodeId
      }),
    setFriendsPresence: (byNode) =>
      set((state) => {
        state.friendsAtVenue = byNode
      }),
    addFriendPresence: (nodeId, userId) =>
      set((state) => {
        if (!state.friendsAtVenue[nodeId]) {
          state.friendsAtVenue[nodeId] = [userId]
        } else if (!state.friendsAtVenue[nodeId].includes(userId)) {
          state.friendsAtVenue[nodeId].push(userId)
        }
        // No-op when userId is already present (dedup)
      }),
    removeFriendPresence: (nodeId, userId) =>
      set((state) => {
        const arr = state.friendsAtVenue[nodeId]
        if (!arr) return
        const idx = arr.indexOf(userId)
        if (idx !== -1) {
          arr.splice(idx, 1)
        }
        // Clean up empty arrays to keep the store lean
        if (arr.length === 0) {
          delete state.friendsAtVenue[nodeId]
        }
      }),
    clearFriendsPresence: () =>
      set((state) => {
        state.friendsAtVenue = {}
      }),
    setHasLiveGets: (map) =>
      set((state) => {
        state.hasLiveGets = map
      }),
  })),
)
