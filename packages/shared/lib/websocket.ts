// WebSocket Client for API Gateway WebSocket API
// Replaces Socket.io with native WebSocket for serverless

import type { ClientToServerEvents, ServerToClientEvents } from '../types'

import { onTokenRefresh } from './api'

type EventCallback = (payload: any) => void

// Connection lifecycle events (Socket.io compatibility)
type LifecycleEvent = 'connect' | 'disconnect' | 'connect_error'
type AnyEventKey = keyof ServerToClientEvents | LifecycleEvent

// API Gateway WebSocket closes a connection after 10 minutes with no traffic in
// either direction (and hard-caps any connection at 2 hours). Sending a small
// app-level message well inside that window resets the idle timer. Without it
// every idle socket is culled every 10 minutes, producing an endless
// connect/disconnect/reconnect loop.
const HEARTBEAT_INTERVAL_MS = 300_000 // 5 minutes, safely under the 10-min idle cap
const BASE_RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_DELAY_MS = 30_000

// API Gateway WebSocket route keys cannot contain colons, so the app-level
// event names map to the deployed route keys (infra/modules/websocket/main.tf,
// handled in backend/src/lambdas/websocket.ts).
const ROUTE_KEY_BY_EVENT: Record<keyof ClientToServerEvents, string> = {
  'room:join': 'joinroom',
  'room:leave': 'leaveroom',
}

class WebSocketManager {
  private ws: WebSocket | null = null
  private _url: string
  private reconnectAttempts = 0
  private reconnectDelay = BASE_RECONNECT_DELAY_MS
  private listeners: Map<AnyEventKey, Set<EventCallback>> = new Map()
  private isConnecting = false
  private pendingQueue: Array<{ action: string; payload: unknown }> = []
  private unsubTokenRefresh: (() => void) | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  constructor(url: string) {
    this._url = url
  }

  get url(): string {
    return this._url
  }

  /**
   * Update the connection URL (e.g. after a token refresh) and reconnect.
   * Resets reconnect attempts so the fresh-token connection isn't throttled.
   */
  reconnectWithUrl(newUrl: string): void {
    if (this._url === newUrl) return
    this._url = newUrl
    this.reconnectAttempts = 0
    this.stopHeartbeat()
    // Close existing connection - onclose will NOT auto-reconnect because
    // we call connect() explicitly below.
    if (this.ws) {
      this.ws.onclose = null // prevent double-reconnect
      this.ws.close()
      this.ws = null
    }
    this.isConnecting = false
    this.connect()
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return
    }

    // Don't attempt connection to placeholder/disabled URLs
    if (this._url === 'ws://disabled' || !this._url) {
      return
    }

    this.isConnecting = true

    try {
      this.ws = new WebSocket(this._url)

      this.ws.onopen = () => {
        console.log('WebSocket connected')
        this.reconnectAttempts = 0
        this.isConnecting = false
        this.startHeartbeat()
        this.emitLifecycle('connect')
        const queued = this.pendingQueue.splice(0)
        for (const msg of queued) {
          this.ws!.send(JSON.stringify(msg))
        }
      }

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          this.handleMessage(message)
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error)
        }
      }

      this.ws.onclose = () => {
        console.log('WebSocket disconnected')
        this.isConnecting = false
        this.stopHeartbeat()
        this.emitLifecycle('disconnect')
        this.attemptReconnect()
      }

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        this.isConnecting = false
        this.emitLifecycle('connect_error', error)
      }
    } catch (error) {
      console.error('Failed to create WebSocket:', error)
      this.isConnecting = false
    }
  }

  private attemptReconnect(): void {
    // Retry indefinitely with exponential backoff capped at MAX_RECONNECT_DELAY_MS.
    // A realtime client that permanently gives up after a transient server hiccup
    // strands the user with a dead socket until an unrelated event happens to
    // rebuild it - the backoff ceiling keeps retries gentle without abandoning.
    this.reconnectAttempts++
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), MAX_RECONNECT_DELAY_MS)

    console.log(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts})`)

    setTimeout(() => {
      this.connect()
    }, delay)
  }

  /** Keep the connection past API Gateway's 10-minute idle timeout. */
  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Unknown action routes to `$default`, which acks with 200 and, crucially,
        // resets the idle timer. Sent raw so it never enters the pending queue.
        this.ws.send(JSON.stringify({ action: 'ping' }))
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /** Subscribe to token refresh events so the socket reconnects with the new token. */
  subscribeToTokenRefresh(buildUrl: (newToken: string) => string): void {
    // Unsubscribe any previous listener
    this.unsubTokenRefresh?.()
    this.unsubTokenRefresh = onTokenRefresh((newToken) => {
      const newUrl = buildUrl(newToken)
      this.reconnectWithUrl(newUrl)
    })
  }

  private emitLifecycle(event: LifecycleEvent, payload?: any): void {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      callbacks.forEach((cb) => {
        try {
          cb(payload)
        } catch (e) {
          console.error(`Error in ${event} handler:`, e)
        }
      })
    }
  }

  private handleMessage(message: { type: keyof ServerToClientEvents; payload: any }): void {
    const { type, payload } = message
    const callbacks = this.listeners.get(type)

    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(payload)
        } catch (error) {
          console.error(`Error in ${type} handler:`, error)
        }
      })
    }
  }

  // Subscribe to server events (supports lifecycle events 'connect'/'disconnect' for Socket.io compat)
  on(event: AnyEventKey, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }

    const callbacks = this.listeners.get(event)!
    callbacks.add(callback)

    return () => {
      callbacks.delete(callback)
    }
  }

  off(event: AnyEventKey, callback: EventCallback): void {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      callbacks.delete(callback)
    }
  }

  // Emit client events - queued if not yet connected, sent immediately if open
  emit<K extends keyof ClientToServerEvents>(event: K, payload: Parameters<ClientToServerEvents[K]>[0]): void {
    // API Gateway selects the route from $request.body.action, and route keys
    // cannot contain colons - map the app-level event names to the deployed
    // route keys (infra/modules/websocket/main.tf). An unmapped action would
    // silently land in $default and be ignored by the backend.
    const message = { action: ROUTE_KEY_BY_EVENT[event], payload }

    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.pendingQueue.push(message)
      return
    }

    this.ws.send(JSON.stringify(message))
  }

  disconnect(): void {
    this.stopHeartbeat()
    this.unsubTokenRefresh?.()
    this.unsubTokenRefresh = null
    if (this.ws) {
      this.ws.onclose = null // prevent auto-reconnect on intentional close
      this.ws.close()
      this.ws = null
    }
    this.listeners.clear()
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

// Singleton instance
let wsManager: WebSocketManager | null = null

// Legacy Socket.io-style exports for backwards compatibility
type SocketLike = {
  on: WebSocketManager['on']
  off: WebSocketManager['off']
  emit: WebSocketManager['emit']
  disconnect: () => void
  connected: boolean
}

// Socket override for dev mocks - when set, getSocket/getWebSocket return this instead
let socketOverrideInstance: SocketLike | null = null

function isDevMock(): boolean {
  try {
    const env =
      typeof import.meta !== 'undefined' ? (import.meta as unknown as Record<string, Record<string, string>>).env : {}
    if (env?.VITE_DEV_MOCK === 'true') return true
  } catch {
    /* import.meta unavailable (RN) */
  }
  // Reach for `process` via `globalThis` so this compiles under the web
  // tsconfig (no `@types/node`); the web bundle never hits this branch.
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  if (proc?.env?.['EXPO_PUBLIC_DEV_MOCK'] === 'true') return true
  return false
}

function normaliseWsUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  let url = raw
  // Auto-convert http(s) URLs to ws(s)
  if (url.startsWith('https://')) url = 'wss://' + url.substring(8)
  else if (url.startsWith('http://')) url = 'ws://' + url.substring(7)
  return url
}

function getWebSocketUrl(): string | null {
  // In dev mock mode, don't resolve a real WebSocket URL - the mock layer handles events
  if (isDevMock()) return null

  // ── Web (Vite) ──
  let url: string | null = null
  try {
    if (typeof import.meta !== 'undefined') {
      const env = (import.meta as unknown as Record<string, Record<string, string>>).env

      // VITE_WEBSOCKET_URL must point to a WebSocket API Gateway (wss://)
      // VITE_SOCKET_URL is the legacy fallback (only works for local dev with Socket.io)
      url = env?.VITE_WEBSOCKET_URL ?? null

      // Fall back to VITE_SOCKET_URL only in local dev (localhost)
      if (!url) {
        const fallback = env?.VITE_SOCKET_URL
        if (fallback && (fallback.includes('localhost') || fallback.includes('127.0.0.1'))) {
          url = fallback
        }
      }
    }
  } catch {
    /* import.meta unavailable (RN) */
  }

  // ── React Native (Expo) ──
  if (!url) {
    const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    url = proc?.env?.['EXPO_PUBLIC_WEBSOCKET_URL'] ?? null
  }

  return normaliseWsUrl(url)
}

let WEBSOCKET_URL = getWebSocketUrl()

/**
 * Override the WebSocket base URL at runtime. Used by the React Native app to
 * configure the socket origin from `expo-constants` extra at boot, since the
 * module-eval-time env lookup can't see Expo's extra config. Call before the
 * first `getSocket()`/`getWebSocket()`.
 */
export function setWebSocketUrl(url: string | null): void {
  WEBSOCKET_URL = normaliseWsUrl(url)
}

export function getWebSocket(
  token?: string,
  opts?: { userId?: string; citySlug?: string; businessId?: string },
): WebSocketManager {
  if (!WEBSOCKET_URL) {
    // No WebSocket API configured , return a no-op manager
    if (!wsManager) {
      wsManager = new WebSocketManager('ws://disabled')
    }
    return wsManager
  }

  // Build URL with query params
  const params = new URLSearchParams()
  if (token) params.set('token', token)
  if (opts?.userId) params.set('userId', opts.userId)
  if (opts?.citySlug) params.set('citySlug', opts.citySlug)
  if (opts?.businessId) params.set('businessId', opts.businessId)

  const url = params.toString() ? `${WEBSOCKET_URL}?${params.toString()}` : WEBSOCKET_URL

  // Reuse existing connection when the base URL and token are unchanged.
  // Room-specific query params (businessId, userId, citySlug) may differ across
  // callers (e.g. App.tsx adds businessId; panels omit it).  Comparing only the
  // origin+path and token prevents tearing down an in-flight connection, which
  // causes the "WebSocket closed before connection established" browser warning.
  const isSameConnection =
    wsManager != null &&
    (() => {
      try {
        const a = new URL(wsManager.url)
        const b = new URL(url)
        return (
          a.origin + a.pathname === b.origin + b.pathname && a.searchParams.get('token') === b.searchParams.get('token')
        )
      } catch {
        return wsManager!.url === url
      }
    })()

  if (!isSameConnection) {
    if (wsManager) wsManager.disconnect()
    wsManager = new WebSocketManager(url)

    // Subscribe to token refreshes so the socket reconnects with the new token
    // automatically - no more disconnect/reconnect loops after a 401 refresh.
    const stableOpts = opts
    wsManager.subscribeToTokenRefresh((newToken: string) => {
      const freshParams = new URLSearchParams()
      freshParams.set('token', newToken)
      if (stableOpts?.userId) freshParams.set('userId', stableOpts.userId)
      if (stableOpts?.citySlug) freshParams.set('citySlug', stableOpts.citySlug)
      if (stableOpts?.businessId) freshParams.set('businessId', stableOpts.businessId)
      return `${WEBSOCKET_URL}?${freshParams.toString()}`
    })
  }
  wsManager!.connect()

  return wsManager!
}

export function disconnectWebSocket(): void {
  wsManager?.disconnect()
  wsManager = null
}

// Compatibility layer for existing code
export function getSocket(
  token?: string,
  opts?: { userId?: string; citySlug?: string; businessId?: string },
): SocketLike {
  // If a mock socket override is active (dev mode), return it directly
  if (socketOverrideInstance) {
    return socketOverrideInstance
  }

  const ws = getWebSocket(token, opts)

  return {
    on: ws.on.bind(ws),
    off: ws.off.bind(ws),
    emit: ws.emit.bind(ws),
    disconnect: () => disconnectWebSocket(),
    get connected() {
      return ws.connected
    },
  }
}

export function disconnectSocket(): void {
  disconnectWebSocket()
}

export function setSocketOverride(override?: unknown): void {
  if (!override) {
    socketOverrideInstance = null
    return
  }
  // Accept any object that quacks like a SocketLike (MockSocket from dev mocks)
  socketOverrideInstance = override as SocketLike
}
