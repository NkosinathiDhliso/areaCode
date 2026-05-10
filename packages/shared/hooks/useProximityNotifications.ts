import { useEffect, useRef } from 'react'
import { useLocationStore } from '../stores/locationStore'
import { useMapStore } from '../stores/mapStore'
import {
  evaluate,
  shouldNotify,
  isOptedIn,
  getDebounceMap,
  recordNotification,
  type CachedNode,
} from '../lib/proximity'
import type { NodeState } from '../types'

/**
 * Hook that integrates the proximity module with geolocation updates.
 * Triggers web push notifications via Service Worker when app is in background.
 * No GPS is sent to backend — uses cached node data from map.
 */
export function useProximityNotifications() {
  const lastKnownPosition = useLocationStore((s) => s.lastKnownPosition)
  const watchIdRef = useRef<number | null>(null)
  const lastCheckRef = useRef<number>(0)

  useEffect(() => {
    if (!isOptedIn()) return
    if (!('geolocation' in navigator)) return

    // Watch position for continuous proximity checks
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now()
        // Throttle checks to every 30 seconds
        if (now - lastCheckRef.current < 30000) return
        lastCheckRef.current = now

        const userLat = position.coords.latitude
        const userLng = position.coords.longitude

        // Get cached nodes from map store
        const mapState = useMapStore.getState()
        const nodeRecord = mapState.nodes
        const nodes: CachedNode[] = Object.values(nodeRecord).map((n) => ({
          id: n.id,
          name: n.name,
          lat: n.lat,
          lng: n.lng,
          state: 'dormant' as NodeState, // Default; pulse state comes from pulseScores
        }))

        const alerts = evaluate(userLat, userLng, nodes)
        const debounceMap = getDebounceMap()

        for (const alert of alerts) {
          if (shouldNotify(alert.nodeId, debounceMap, now)) {
            recordNotification(alert.nodeId, now)
            triggerNotification(alert.nodeName, alert.pulseState, alert.distanceMetres)
          }
        }
      },
      () => { /* Silently handle errors */ },
      { enableHighAccuracy: false, maximumAge: 30000, timeout: 10000 },
    )

    watchIdRef.current = watchId

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

/**
 * Triggers a web push notification via Service Worker when available,
 * or falls back to the Notification API.
 */
function triggerNotification(nodeName: string, state: NodeState, distanceM: number): void {
  const title = `${nodeName} is ${state}!`
  const body = `${distanceM}m away — check it out`

  // Use Service Worker for background notifications
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'PROXIMITY_ALERT',
      payload: { title, body, nodeName, state, distanceM },
    })
    return
  }

  // Fallback: direct Notification API
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.svg' })
  }
}
