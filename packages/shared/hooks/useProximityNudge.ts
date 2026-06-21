/**
 * GPS-Proximity Check-In Nudge - Churn-defences spec, Requirement 4.
 *
 * Pure client-side detection. The user's coordinates never leave the
 * device for this feature (POPIA constraint). We compare the user's
 * current GPS to the lat/lng of nodes they have previously visited
 * (which are public information already exposed by /v1/nodes).
 *
 * Cooldowns (also enforced in localStorage so a refresh doesn't reset):
 *   - 6 hours between nudges for the same venue
 *   - 24 hours after a dismiss for the same venue
 *   - daily cap of 5 nudges across all venues
 *
 * The hook itself fires nothing visible - it returns the next venue to
 * surface. The caller wires it to a banner / push notification.
 */

import { useEffect, useRef, useState } from 'react'

import { haversineDistance } from '../lib/geoUtils'
import { storage } from '../lib/storage'

export interface VisitedNode {
  nodeId: string
  name?: string
  lat: number
  lng: number
  radiusM: number
}

export interface ProximityNudgeOptions {
  /** Current user position. When null, the hook does nothing. */
  position: { lat: number; lng: number } | null
  /** Venues the user has previously visited. */
  visited: VisitedNode[]
  /** When false, the hook is dormant. Use for the privacy toggle. */
  enabled: boolean
  /** Override clock for tests. */
  nowMs?: () => number
  /** Override the 60s polling interval for tests. */
  pollIntervalMs?: number
}

interface NudgeState {
  lastFiredAt: Record<string, number>
  dismissedAt: Record<string, number>
  firedToday: { date: string; count: number }
}

const STORAGE_KEY = 'ac:proximity-nudges'

const NUDGE_COOLDOWN_MS = 6 * 60 * 60 * 1000
const DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000
const DAILY_CAP = 5

function emptyState(now: number): NudgeState {
  return {
    lastFiredAt: {},
    dismissedAt: {},
    firedToday: { date: dateKey(now), count: 0 },
  }
}

function dateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function loadState(now: number): NudgeState {
  const raw = storage.get(STORAGE_KEY)
  if (!raw) return emptyState(now)
  try {
    const parsed = JSON.parse(raw) as NudgeState
    if (parsed.firedToday.date !== dateKey(now)) {
      parsed.firedToday = { date: dateKey(now), count: 0 }
    }
    return parsed
  } catch {
    return emptyState(now)
  }
}

function saveState(state: NudgeState): void {
  storage.set(STORAGE_KEY, JSON.stringify(state))
}

/**
 * Pure decision: should we fire a nudge for this venue right now?
 *
 * Exported so unit tests can exhaustively probe the cooldown logic
 * without spinning up React.
 */
export function shouldFireNudge(nodeId: string, state: NudgeState, now: number): boolean {
  if (state.firedToday.count >= DAILY_CAP) return false
  const lastFired = state.lastFiredAt[nodeId] ?? 0
  if (now - lastFired < NUDGE_COOLDOWN_MS) return false
  const dismissed = state.dismissedAt[nodeId] ?? 0
  if (now - dismissed < DISMISS_COOLDOWN_MS) return false
  return true
}

export function recordFired(state: NudgeState, nodeId: string, now: number): NudgeState {
  return {
    ...state,
    lastFiredAt: { ...state.lastFiredAt, [nodeId]: now },
    firedToday: {
      date: dateKey(now),
      count: state.firedToday.date === dateKey(now) ? state.firedToday.count + 1 : 1,
    },
  }
}

export function recordDismissed(state: NudgeState, nodeId: string, now: number): NudgeState {
  return {
    ...state,
    dismissedAt: { ...state.dismissedAt, [nodeId]: now },
  }
}

export interface NudgeFiring {
  node: VisitedNode
  firedAt: number
}

export function useProximityNudge({
  position,
  visited,
  enabled,
  nowMs = () => Date.now(),
  pollIntervalMs = 60_000,
}: ProximityNudgeOptions): {
  current: NudgeFiring | null
  dismiss: () => void
} {
  const [current, setCurrent] = useState<NudgeFiring | null>(null)
  const stateRef = useRef<NudgeState>(loadState(nowMs()))

  useEffect(() => {
    if (!enabled) {
      setCurrent(null)
      return
    }
    const tick = () => {
      if (!position) return
      const now = nowMs()
      // Refresh the daily counter if the date rolled over.
      if (stateRef.current.firedToday.date !== dateKey(now)) {
        stateRef.current = { ...stateRef.current, firedToday: { date: dateKey(now), count: 0 } }
      }
      for (const node of visited) {
        const distM = haversineDistance(position.lat, position.lng, node.lat, node.lng) * 1000
        if (distM > node.radiusM) continue
        if (!shouldFireNudge(node.nodeId, stateRef.current, now)) continue
        stateRef.current = recordFired(stateRef.current, node.nodeId, now)
        saveState(stateRef.current)
        setCurrent({ node, firedAt: now })
        break // one venue at a time
      }
    }
    tick()
    const id = setInterval(tick, pollIntervalMs)
    return () => clearInterval(id)
  }, [enabled, position, visited, nowMs, pollIntervalMs])

  return {
    current,
    dismiss: () => {
      if (!current) return
      stateRef.current = recordDismissed(stateRef.current, current.node.nodeId, nowMs())
      saveState(stateRef.current)
      setCurrent(null)
    },
  }
}
