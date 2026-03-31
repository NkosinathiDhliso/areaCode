import type { MapInstance } from '../types'

export interface MapViewProps {
  className?: string
  initialCenter?: [number, number]
  initialZoom?: number
  initialPitch?: number
  initialBearing?: number
  onMapReady?: (instance: MapInstance) => void
  onNodeTap?: (nodeId: string) => void
  onNodeLongPress?: (nodeId: string) => void
  children?: React.ReactNode
}

export interface AnimatedNodeProps {
  nodeId: string
  x: number
  y: number
  size: number
  color: string
  state: 'dormant' | 'quiet' | 'active' | 'buzzing' | 'popping'
  checkInCount: number
  onTap?: () => void
  onLongPress?: () => void
}

export type { MapInstance }
