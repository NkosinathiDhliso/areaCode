import { useMapStore } from '@area-code/shared/stores'
import type mapboxgl from 'mapbox-gl'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { DRAG_AXIS_THRESHOLD, MIN_MARKER_ZOOM } from '../lib/carouselConstants'
import { classifyDrag } from '../lib/gestureClassifier'
import { getNodeState } from '../lib/mapHelpers'

const SWEEP_HIT_PX = 44

function detectReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function whisperForNode(
  nodeId: string,
  pulseScores: Record<string, number>,
  checkInCounts: Record<string, number>,
  friendsAtVenue: Record<string, string[]>,
): string {
  const score = pulseScores[nodeId] ?? 0
  const state = getNodeState(score)
  const friends = friendsAtVenue[nodeId]?.length ?? 0
  if (friends > 0) return 'Buzzing · your crowd'
  if (state === 'popping' || state === 'buzzing') return `${state === 'popping' ? 'Popping' : 'Buzzing'} · people here`
  if (state === 'active') return 'Active now'
  const count = checkInCounts[nodeId] ?? 0
  if (count > 0) return `${count} here now`
  return 'Quiet · be first'
}

/**
 * Constellation play layer: horizontal sweeps brighten nearby beams and show a
 * one-line magnet whisper. Does not select venues or flip browse scope.
 */
export function useConstellationSweep(mapRef: RefObject<mapboxgl.Map | null>, mapReady: boolean) {
  const [brushedNodeId, setBrushedNodeId] = useState<string | null>(null)
  const [whisper, setWhisper] = useState<string | null>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const lastVibratedRef = useRef<string | null>(null)
  const reducedMotionRef = useRef(detectReducedMotion())

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const canvas = map.getCanvas()

    const onDown = (e: PointerEvent) => {
      dragStartRef.current = { x: e.clientX, y: e.clientY }
      lastVibratedRef.current = null
    }

    const onMove = (e: PointerEvent) => {
      const start = dragStartRef.current
      if (!start) return
      let zoom = MIN_MARKER_ZOOM
      try {
        zoom = map.getZoom()
      } catch {
        return
      }
      if (zoom >= MIN_MARKER_ZOOM) {
        setBrushedNodeId(null)
        setWhisper(null)
        return
      }

      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (classifyDrag(dx, dy, DRAG_AXIS_THRESHOLD) !== 'horizontal') {
        setBrushedNodeId(null)
        setWhisper(null)
        return
      }

      const mapState = useMapStore.getState()
      const nodes = Object.values(mapState.nodes)
      let nearestId: string | null = null
      let nearestDist = SWEEP_HIT_PX

      for (const node of nodes) {
        const projected = map.project([node.lng, node.lat])
        const dist = Math.hypot(projected.x - e.clientX, projected.y - e.clientY)
        if (dist < nearestDist) {
          nearestDist = dist
          nearestId = node.id
        }
      }

      setBrushedNodeId(nearestId)
      if (nearestId) {
        setWhisper(whisperForNode(nearestId, mapState.pulseScores, mapState.checkInCounts, mapState.friendsAtVenue))
        if (
          !reducedMotionRef.current &&
          typeof navigator !== 'undefined' &&
          navigator.vibrate &&
          lastVibratedRef.current !== nearestId
        ) {
          navigator.vibrate(8)
          lastVibratedRef.current = nearestId
        }
      } else {
        setWhisper(null)
      }
    }

    const onUp = () => {
      dragStartRef.current = null
      setBrushedNodeId(null)
      setWhisper(null)
      lastVibratedRef.current = null
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
    }
  }, [mapRef, mapReady])

  return { brushedNodeId, whisper }
}
