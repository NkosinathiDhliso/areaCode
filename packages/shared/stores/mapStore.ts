import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Node, MapInstance } from '../types'

interface MapStore {
  nodes: Record<string, Node>
  pulseScores: Record<string, number>
  mapInstance: MapInstance | null
  setNodes: (nodes: Node[]) => void
  updateNodePulse: (nodeId: string, score: number) => void
  setMapInstance: (instance: MapInstance | null) => void
}

export const useMapStore = create<MapStore>()(
  immer((set) => ({
    nodes: {},
    pulseScores: {},
    mapInstance: null,
    setNodes: (nodes) =>
      set((state) => {
        for (const node of nodes) {
          state.nodes[node.id] = node
        }
      }),
    updateNodePulse: (nodeId, score) =>
      set((state) => {
        state.pulseScores[nodeId] = score
      }),
    setMapInstance: (instance) =>
      set((state) => {
        state.mapInstance = instance as MapInstance | null
      }),
  })),
)
