import { io, type Socket } from 'socket.io-client'

import type { ClientToServerEvents, ServerToClientEvents } from '../types'

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>

const SOCKET_URL = typeof import.meta !== 'undefined' ? (import.meta as unknown as Record<string, Record<string, string>>).env?.VITE_SOCKET_URL ?? (import.meta as unknown as Record<string, Record<string, string>>).env?.VITE_API_URL ?? 'http://localhost:4000' : 'http://localhost:4000'

let socketInstance: TypedSocket | null = null

/**
 * Allow the dev mock layer to inject a fake socket without reassigning the ES module export.
 */
export function setSocketOverride(socket: TypedSocket): void {
  socketInstance = socket
}

export function getSocket(token?: string, opts?: { userId?: string; citySlug?: string; businessId?: string }): TypedSocket {
  if (socketInstance?.connected) {
    return socketInstance
  }

  const auth: Record<string, string> = {}
  if (token) auth['token'] = token
  if (opts?.userId) auth['userId'] = opts.userId
  if (opts?.citySlug) auth['citySlug'] = opts.citySlug
  if (opts?.businessId) auth['businessId'] = opts.businessId

  const options: Parameters<typeof io>[1] = {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    randomizationFactor: 0.5,
  }

  // In dev without a backend, limit reconnection attempts to reduce console spam
  if (typeof import.meta !== 'undefined' && (import.meta as unknown as Record<string, Record<string, boolean>>).env?.DEV) {
    options.reconnectionAttempts = 3
  }

  if (Object.keys(auth).length > 0) {
    options.auth = auth
  }

  socketInstance = io(SOCKET_URL, options) as TypedSocket

  return socketInstance
}

export function disconnectSocket(): void {
  if (socketInstance) {
    socketInstance.disconnect()
    socketInstance = null
  }
}
