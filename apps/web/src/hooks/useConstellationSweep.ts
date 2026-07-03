import { useMapStore } from '@area-code/shared/stores'
import type mapboxgl from 'mapbox-gl'
import { useEffect, useRef, useState, type RefObject } from 'react'

import { DRAG_AXIS_THRESHOLD, MIN_MARKER_ZOOM } from '../lib/carouselConstants'
import { classifyDrag } from '../lib/gestureClassifier'
import { reducedMotion } from '../lib/reducedMotion'
import { computeWhisperText } from '../lib/whisperText'

const SWEEP_HIT_PX = 44

/**
 * Constellation play layer: horizontal sweeps brighten nearby beams
 * and show a one-line magnet whisper chip (belonging > momentum > aliveness).
 * Does not select venues or flip browse scope.
 */
export function useConstellationSweep(mapRef: RefObject<mapboxgl.Map | null>, mapReady: boolean) {
  const [brushedNodeId, setBrushedNodeId] = useState<string | null>(null)
  const [whisperText, setWhisperText] = useState<string | null>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const lastVibratedRef = useRef<string | null>(null)

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
        setWhisperText(null)
        return
      }

      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (classifyDrag(dx, dy, DRAG_AXIS_THRESHOLD) !== 'horizontal') {
        setBrushedNodeId(null)
        setWhisperText(null)
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
        const node = mapState.nodes[nearestId]
        const text = computeWhisperText(nearestId, node, mapState)
        setWhisperText(text)
      } else {
        setWhisperText(null)
      }

      if (
        nearestId &&
        !reducedMotion() &&
        typeof navigator !== 'undefined' &&
        navigator.vibrate &&
        lastVibratedRef.current !== nearestId
      ) {
        navigator.vibrate(8)
        lastVibratedRef.current = nearestId
      }
    }

    const onUp = () => {
      dragStartRef.current = null
      setBrushedNodeId(null)
      setWhisperText(null)
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

  return { brushedNodeId, whisperText }
}
