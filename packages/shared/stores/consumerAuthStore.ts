import { create } from 'zustand'

import { storage } from '../lib/storage'

interface ConsumerAuthState {
  accessToken: string | null
  refreshToken: string | null
  userId: string | null
  sessionId: string | null
  isAuthenticated: boolean
  setAuth: (accessToken: string, refreshToken: string, userId: string, sessionId?: string) => void
  setAccessToken: (token: string) => void
  logout: () => void
}

export const useConsumerAuthStore = create<ConsumerAuthState>()((set) => ({
  accessToken: storage.get('consumer:accessToken'),
  refreshToken: storage.get('consumer:refreshToken'),
  userId: storage.get('consumer:userId'),
  sessionId: storage.get('consumer:sessionId'),
  isAuthenticated: storage.get('consumer:accessToken') !== null,
  setAuth: (accessToken, refreshToken, userId, sessionId) => {
    storage.set('consumer:accessToken', accessToken)
    storage.set('consumer:refreshToken', refreshToken)
    storage.set('consumer:userId', userId)
    if (sessionId) storage.set('consumer:sessionId', sessionId)
    set({ accessToken, refreshToken, userId, sessionId: sessionId ?? null, isAuthenticated: true })
  },
  setAccessToken: (token) => {
    storage.set('consumer:accessToken', token)
    set({ accessToken: token })
  },
  logout: () => {
    storage.remove('consumer:accessToken')
    storage.remove('consumer:refreshToken')
    storage.remove('consumer:userId')
    storage.remove('consumer:sessionId')
    set({ accessToken: null, refreshToken: null, userId: null, sessionId: null, isAuthenticated: false })
  },
}))
