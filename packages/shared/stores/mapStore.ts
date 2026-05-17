import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Node, MapInstance } from '../types'

interface MapStore {
  nodes: Record<string, Node>
  pulseScores: Record<string, number>
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
  updateNodePulse: (nodeId: string, score: number) => void
  setMapInstance: (instance: MapInstance | null) => void
  setFocusNodeId: (nodeId: string | null) => void
}

export const useMapStore = create<MapStore>()(
  immer((set) => ({
    nodes: {},
    pulseScores: {},
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
    updateNodePulse: (nodeId, score) =>
      set((state) => {
        state.pulseScores[nodeId] = score
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
