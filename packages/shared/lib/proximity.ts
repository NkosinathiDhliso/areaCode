import type { NodeState } from '../types'

const PROXIMITY_RADIUS_M = 500
const DEBOUNCE_MS = 15 * 60 * 1000 // 15 minutes
const EARTH_RADIUS_M = 6371000
const STORAGE_KEY = 'proximity_opt_in'
const DEBOUNCE_STORAGE_KEY = 'proximity_debounce'

export interface CachedNode {
  id: string
  name: string
  lat: number
  lng: number
  state: NodeState
}

export interface ProximityAlert {
  nodeId: string
  nodeName: string
  pulseState: NodeState
  distanceMetres: number
}

/**
 * Haversine distance in metres between two coordinates.
 * Formula: R * 2 * asin(sqrt(sin²(Δlat/2) + cos(lat1)*cos(lat2)*sin²(Δlng/2)))
 */
export function haversineDistanceMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.asin(Math.sqrt(a))
  return EARTH_RADIUS_M * c
}

/**
 * Checks if a node should trigger a notification based on debounce timing.
 * Returns true if the node has NOT been notified within the last 15 minutes.
 */
export function shouldNotify(
  nodeId: string,
  lastNotifiedMap: Record<string, number>,
  now: number = Date.now(),
): boolean {
  const lastNotified = lastNotifiedMap[nodeId]
  if (lastNotified === undefined) return true
  return now - lastNotified >= DEBOUNCE_MS
}

/**
 * Checks if the user has opted in to proximity notifications.
 */
export function isOptedIn(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Sets the proximity notification opt-in preference.
 */
export function setOptIn(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    // Storage unavailable
  }
}

/**
 * Gets the debounce map from client storage.
 */
export function getDebounceMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(DEBOUNCE_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

/**
 * Records a notification timestamp for a node in the debounce map.
 */
export function recordNotification(nodeId: string, now: number = Date.now()): void {
  try {
    const map = getDebounceMap()
    map[nodeId] = now
    // Clean up old entries (> 1 hour)
    const cutoff = now - 60 * 60 * 1000
    for (const key of Object.keys(map)) {
      if (map[key]! < cutoff) delete map[key]
    }
    localStorage.setItem(DEBOUNCE_STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Storage unavailable
  }
}

/**
 * Evaluates proximity alerts for the user's current position.
 * Returns nodes within 500m that are in buzzing/popping state.
 * No GPS is sent to backend — uses cached node data from map.
 */
export function evaluate(
  userLat: number,
  userLng: number,
  nodes: CachedNode[],
): ProximityAlert[] {
  const alerts: ProximityAlert[] = []

  for (const node of nodes) {
    // Only alert for buzzing or popping nodes
    if (node.state !== 'buzzing' && node.state !== 'popping') continue

    const distance = haversineDistanceMetres(userLat, userLng, node.lat, node.lng)
    if (distance <= PROXIMITY_RADIUS_M) {
      alerts.push({
        nodeId: node.id,
        nodeName: node.name,
        pulseState: node.state,
        distanceMetres: Math.round(distance),
      })
    }
  }

  // Sort by distance (nearest first)
  alerts.sort((a, b) => a.distanceMetres - b.distanceMetres)
  return alerts
}

/**
 * Full proximity check with opt-in and debounce logic.
 * Returns alerts that should actually be shown to the user.
 */
export function getFilteredAlerts(
  userLat: number,
  userLng: number,
  nodes: CachedNode[],
  now: number = Date.now(),
): ProximityAlert[] {
  if (!isOptedIn()) return []

  const rawAlerts = evaluate(userLat, userLng, nodes)
  const debounceMap = getDebounceMap()

  return rawAlerts.filter((alert) => shouldNotify(alert.nodeId, debounceMap, now))
}
