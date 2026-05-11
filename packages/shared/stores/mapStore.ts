import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { Node, MapInstance, NodeState } from '../types'

export interface DeltaNode {
  nodeId: string
  pulseScore?: number
  state?: NodeState
  checkInCount?: number
  consensusGenre?: string | null
  consensusGenreConfidence?: number
  consensusQueue?: 'none' | 'short' | 'long' | null
  consensusQueueConfidence?: number
  signalReportCount?: number
  lastSignalAt?: string
  isOwnerReport?: boolean
}

interface MapStore {
  nodes: Record<string, Node>
  pulseScores: Record<string, number>
  signalData: Record<string, DeltaNode>
  mapInstance: MapInstance | null
  setNodes: (nodes: Node[]) => void
  addNode: (node: Node) => void
  updateNodePulse: (nodeId: string, score: number) => void
  applyDelta: (deltaNodes: DeltaNode[]) => void
  setMapInstance: (instance: MapInstance | null) => void
}

export const useMapStore = create<MapStore>()(
  immer((set) => ({
    nodes: {},
    pulseScores: {},
    signalData: {},
    mapInstance: null,
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
    applyDelta: (deltaNodes) =>
      set((state) => {
        for (const delta of deltaNodes) {
          // Update pulse score if present
          if (delta.pulseScore !== undefined) {
            state.pulseScores[delta.nodeId] = delta.pulseScore
          }
          // Store signal data for the node
          state.signalData[delta.nodeId] = {
            ...state.signalData[delta.nodeId],
            ...delta,
          }
        }
      }),
    setMapInstance: (instance) =>
      set((state) => {
        state.mapInstance = instance as MapInstance | null
      }),
  })),
)
