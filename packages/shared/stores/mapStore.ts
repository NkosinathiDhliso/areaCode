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
}

export const useMapStore = create<MapStore>()(
  immer((set) => ({
    nodes: {},
    pulseScores: {},
    archetypeIds: {},
    checkInCounts: {},
    mapInstance: null,
    focusNodeId: null,
    setNodes: (nodes) =>
      set((state) => {
        for (const node of nodes) {
          state.nodes[node.id] = node
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
  })),
)
