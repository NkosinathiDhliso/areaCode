import { io, type Socket } from 'socket.io-client'

import type { ClientToServerEvents, ServerToClientEvents } from '../types'

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>

const SOCKET_URL = typeof import.meta !== 'undefined' ? (import.meta as unknown as Record<string, Record<string, string>>).env?.VITE_SOCKET_URL ?? 'http://localhost:3001' : 'http://localhost:3001'

let socketInstance: TypedSocket | null = null

export function getSocket(token?: string): TypedSocket {
  if (socketInstance?.connected) {
    return socketInstance
  }

  socketInstance = io(SOCKET_URL, {
    auth: token ? { token } : undefined,
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    randomizationFactor: 0.5,
  }) as TypedSocket

  return socketInstance
}

export function disconnectSocket(): void {
  if (socketInstance) {
    socketInstance.disconnect()
    socketInstance = null
  }
}
