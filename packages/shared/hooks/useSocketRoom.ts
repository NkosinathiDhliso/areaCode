import { useEffect } from 'react'

import { getSocket } from '../lib/socket'

export function useSocketRoom(room: string | null, token?: string, opts?: { userId?: string; citySlug?: string }) {
  useEffect(() => {
    if (!room) return

    const socketOpts: { userId?: string; citySlug?: string } = {}
    if (opts?.userId) socketOpts.userId = opts.userId
    if (opts?.citySlug) socketOpts.citySlug = opts.citySlug
    const socket = getSocket(token, Object.keys(socketOpts).length > 0 ? socketOpts : undefined)
    socket.emit('room:join', { room })

    return () => {
      socket.emit('room:leave', { room })
    }
  }, [room, token, opts?.userId, opts?.citySlug])
}
