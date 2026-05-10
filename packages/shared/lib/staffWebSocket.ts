/**
 * Staff WebSocket connection — joins business room, subscribes to staff events,
 * updates store on each event, handles disconnection with exponential backoff.
 *
 * Requirements: 4.1, 4.2, 6.3
 */
import { getWebSocket } from './websocket'
import { useStaffStore } from '../stores/staffStore'
import type { StaffCheckInEvent, StaffRedemptionRecord, StaffTodayStats } from '../stores/staffStore'

type CleanupFn = () => void

let activeCleanup: CleanupFn | null = null

/**
 * Connect to the staff WebSocket room and subscribe to staff events.
 * Returns a cleanup function to disconnect.
 */
export function connectStaffWebSocket(token: string, businessId: string): CleanupFn {
  // Disconnect previous connection if any
  if (activeCleanup) {
    activeCleanup()
    activeCleanup = null
  }

  const ws = getWebSocket(token, { businessId })
  const store = useStaffStore.getState()
  const unsubscribers: Array<() => void> = []

  // Handle connection lifecycle
  const unsubConnect = ws.on('connect', () => {
    useStaffStore.getState().setWsStatus('connected')
    // Join business room
    ws.emit('room:join', { room: `business:${businessId}` })
  })
  unsubscribers.push(unsubConnect)

  const unsubDisconnect = ws.on('disconnect', () => {
    useStaffStore.getState().setWsStatus('reconnecting')
  })
  unsubscribers.push(unsubDisconnect)

  const unsubError = ws.on('connect_error', () => {
    useStaffStore.getState().setWsStatus('disconnected')
  })
  unsubscribers.push(unsubError)

  // Subscribe to staff-specific events
  const unsubCheckin = ws.on('staff:checkin' as keyof import('../types').ServerToClientEvents, (payload: unknown) => {
    const data = payload as { nodeId: string; consumerName: string; tier: string; timestamp: string }
    const event: StaffCheckInEvent = {
      id: `${data.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      nodeId: data.nodeId,
      consumerName: data.consumerName,
      tier: data.tier as StaffCheckInEvent['tier'],
      timestamp: data.timestamp,
    }
    useStaffStore.getState().addCheckIn(event)
  })
  unsubscribers.push(unsubCheckin)

  const unsubRedemption = ws.on('staff:redemption' as keyof import('../types').ServerToClientEvents, (payload: unknown) => {
    const data = payload as { code: string; rewardTitle: string; status: string; timestamp: string; consumerName?: string }
    const record: StaffRedemptionRecord = {
      id: `${data.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      code: data.code,
      rewardTitle: data.rewardTitle,
      consumerName: data.consumerName ?? '',
      status: data.status === 'success' ? 'success' : 'failed',
      timestamp: data.timestamp,
    }
    useStaffStore.getState().addRedemption(record)
  })
  unsubscribers.push(unsubRedemption)

  const unsubStats = ws.on('staff:stats_update' as keyof import('../types').ServerToClientEvents, (payload: unknown) => {
    const data = payload as Partial<StaffTodayStats>
    useStaffStore.getState().updateStats(data)
  })
  unsubscribers.push(unsubStats)

  // Set initial status
  if (ws.connected) {
    store.setWsStatus('connected')
    ws.emit('room:join', { room: `business:${businessId}` })
  } else {
    store.setWsStatus('reconnecting')
  }

  const cleanup: CleanupFn = () => {
    unsubscribers.forEach((unsub) => unsub())
    useStaffStore.getState().setWsStatus('disconnected')
  }

  activeCleanup = cleanup
  return cleanup
}
