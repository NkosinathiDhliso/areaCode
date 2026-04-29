// WebSocket Client for API Gateway WebSocket API
// Replaces Socket.io with native WebSocket for serverless

import type { ClientToServerEvents, ServerToClientEvents } from '../types'

type EventCallback = (payload: any) => void

// Connection lifecycle events (Socket.io compatibility)
type LifecycleEvent = 'connect' | 'disconnect' | 'connect_error'
type AnyEventKey = keyof ServerToClientEvents | LifecycleEvent

class WebSocketManager {
  private ws: WebSocket | null = null
  private url: string
  private token?: string
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private listeners: Map<AnyEventKey, Set<EventCallback>> = new Map()
  private isConnecting = false

  constructor(url: string, token?: string) {
    this.url = url
    this.token = token
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return
    }

    this.isConnecting = true

    try {
      // Add token as query parameter if present
      const wsUrl = this.token
        ? `${this.url}?token=${encodeURIComponent(this.token)}`
        : this.url

      this.ws = new WebSocket(wsUrl)

      this.ws.onopen = () => {
        console.log('WebSocket connected')
        this.reconnectAttempts = 0
        this.isConnecting = false
        this.emitLifecycle('connect')
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
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached')
      return
    }

    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)

    console.log(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts})`)

    setTimeout(() => {
      this.connect()
    }, delay)
  }

  private emitLifecycle(event: LifecycleEvent, payload?: any): void {
    const callbacks = this.listeners.get(event)
    if (callbacks) {
      callbacks.forEach((cb) => {
        try { cb(payload) } catch (e) { console.error(`Error in ${event} handler:`, e) }
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

  // Emit client events
  emit<K extends keyof ClientToServerEvents>(
    event: K,
    payload: Parameters<ClientToServerEvents[K]>[0]
  ): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, message not sent')
      return
    }

    const message = {
      action: event,
      payload,
    }

    this.ws.send(JSON.stringify(message))
  }

  disconnect(): void {
    if (this.ws) {
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

function getWebSocketUrl(): string {
  const env = typeof import.meta !== 'undefined'
    ? (import.meta as unknown as Record<string, Record<string, string>>).env
    : {}

  let url = env?.VITE_WEBSOCKET_URL ?? env?.VITE_SOCKET_URL ?? 'ws://localhost:4000'

  // Auto-convert http(s) URLs to ws(s)
  if (url.startsWith('https://')) url = 'wss://' + url.substring(8)
  else if (url.startsWith('http://')) url = 'ws://' + url.substring(7)

  return url
}

const WEBSOCKET_URL = getWebSocketUrl()

export function getWebSocket(token?: string, opts?: { userId?: string; citySlug?: string; businessId?: string }): WebSocketManager {
  if (!wsManager || !wsManager.connected) {
    // Build URL with query params
    const params = new URLSearchParams()
    if (token) params.set('token', token)
    if (opts?.userId) params.set('userId', opts.userId)
    if (opts?.citySlug) params.set('citySlug', opts.citySlug)
    if (opts?.businessId) params.set('businessId', opts.businessId)

    const url = params.toString()
      ? `${WEBSOCKET_URL}?${params.toString()}`
      : WEBSOCKET_URL

    wsManager = new WebSocketManager(url, token)
    wsManager.connect()
  }

  return wsManager
}

export function disconnectWebSocket(): void {
  wsManager?.disconnect()
  wsManager = null
}

// Legacy Socket.io-style exports for backwards compatibility
type SocketLike = {
  on: WebSocketManager['on']
  off: WebSocketManager['off']
  emit: WebSocketManager['emit']
  disconnect: () => void
  connected: boolean
}

// Compatibility layer for existing code
export function getSocket(
  token?: string,
  opts?: { userId?: string; citySlug?: string; businessId?: string }
): SocketLike {
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

export function setSocketOverride(_override?: unknown): void {
  // No-op in WebSocket mode (was for dev mocks)
  console.warn('setSocketOverride not supported in WebSocket mode')
}
