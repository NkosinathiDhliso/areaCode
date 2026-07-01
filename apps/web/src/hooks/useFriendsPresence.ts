import { useEffect, useRef } from 'react'

import { getSocket } from '@area-code/shared/lib/socket'
import { api } from '@area-code/shared/lib/api'
import { useMapStore } from '@area-code/shared/stores/mapStore'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { usePresenceStore } from '@area-code/shared/stores/presenceStore'

import { filterActiveFriends } from '../lib/carouselRanking'

interface FriendsPresenceResponse {
  items: Array<{ nodeId: string; userId: string; expiresAt: string }>
}

/**
 * Wires socket events and API seeding for the friends-at-venue presence store.
 *
 * - Seeds from `GET /v1/friends/presence` on session start (authenticated consumer only)
 * - Listens for `toast:friend_checkin` -> `addFriendPresence`
 * - Listens for `friend:checkout` -> `removeFriendPresence`
 * - Re-seeds on socket reconnect (recovers checkouts missed while offline)
 * - Clears store on logout
 * - No polling (R14.1): entirely event-driven + session-start seed
 *
 * Requirements: 3.1, 3.4, 3.5, 14.1
 */
export function useFriendsPresence(token?: string) {
  const addFriendPresence = useMapStore((s) => s.addFriendPresence)
  const removeFriendPresence = useMapStore((s) => s.removeFriendPresence)
  const setFriendsPresence = useMapStore((s) => s.setFriendsPresence)
  const clearFriendsPresence = useMapStore((s) => s.clearFriendsPresence)
  const isAuthenticated = useConsumerAuthStore((s) => s.isAuthenticated)

  // Track whether the initial seed has been issued so the reconnect handler
  // can distinguish between a fresh session and a reconnection.
  const seededRef = useRef(false)

  // Seed friends presence from the API. Shared between initial mount and reconnect.
  const seedRef = useRef<() => Promise<void>>()
  seedRef.current = async () => {
    try {
      const data = await api.get<FriendsPresenceResponse>('/v1/friends/presence')
      const active = filterActiveFriends(data.items, Date.now())
      setFriendsPresence(active)
    } catch {
      // If fetch fails (network error, 5xx), store remains empty / retains
      // last-known state. Ranking proceeds without friends signal. (Design: Error Handling)
      console.warn('[useFriendsPresence] Failed to seed friends presence')
    }
  }

  // Seed on session start (once authenticated)
  useEffect(() => {
    if (!isAuthenticated || !token) {
      // Clear store on logout (R3.3)
      clearFriendsPresence()
      // Clear the current user's own Active_Presence on logout, parity with
      // friends presence (honest-presence-ui R3).
      usePresenceStore.getState().clear()
      seededRef.current = false
      return
    }

    // Seed from API
    seededRef.current = true
    void seedRef.current?.()
  }, [isAuthenticated, token, clearFriendsPresence, setFriendsPresence])

  // Socket event listeners for real-time updates + reconnect re-seed
  useEffect(() => {
    if (!isAuthenticated || !token) return

    const socket = getSocket(token)

    // toast:friend_checkin -> add friend to venue presence
    const checkinHandler = (payload: {
      type: 'checkin'
      message: string
      userId: string
      nodeId: string
      avatarUrl?: string
    }) => {
      addFriendPresence(payload.nodeId, payload.userId)
    }

    // friend:checkout -> remove friend from venue presence
    const checkoutHandler = (payload: { userId: string; nodeId: string }) => {
      removeFriendPresence(payload.nodeId, payload.userId)
    }

    // Re-seed on socket reconnect to recover any checkouts missed while offline
    const connectHandler = () => {
      if (seededRef.current) {
        // Only re-seed if we've already done the initial seed (avoids double-seed
        // race with the mount useEffect above on first connect)
        void seedRef.current?.()
      }
    }

    socket.on('toast:friend_checkin', checkinHandler)
    socket.on('friend:checkout', checkoutHandler)
    socket.on('connect', connectHandler)

    return () => {
      socket.off('toast:friend_checkin', checkinHandler)
      socket.off('friend:checkout', checkoutHandler)
      socket.off('connect', connectHandler)
    }
  }, [isAuthenticated, token, addFriendPresence, removeFriendPresence, setFriendsPresence])
}
