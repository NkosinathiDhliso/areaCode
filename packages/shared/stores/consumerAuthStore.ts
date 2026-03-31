import { create } from 'zustand'

import { storage } from '../lib/storage'

interface ConsumerAuthState {
  accessToken: string | null
  refreshToken: string | null
  userId: string | null
  isAuthenticated: boolean
  setAuth: (accessToken: string, refreshToken: string, userId: string) => void
  setAccessToken: (token: string) => void
  logout: () => void
}

export const useConsumerAuthStore = create<ConsumerAuthState>()((set) => ({
  accessToken: storage.get('consumer:accessToken'),
  refreshToken: storage.get('consumer:refreshToken'),
  userId: storage.get('consumer:userId'),
  isAuthenticated: storage.get('consumer:accessToken') !== null,
  setAuth: (accessToken, refreshToken, userId) => {
    storage.set('consumer:accessToken', accessToken)
    storage.set('consumer:refreshToken', refreshToken)
    storage.set('consumer:userId', userId)
    set({ accessToken, refreshToken, userId, isAuthenticated: true })
  },
  setAccessToken: (token) => {
    storage.set('consumer:accessToken', token)
    set({ accessToken: token })
  },
  logout: () => {
    storage.remove('consumer:accessToken')
    storage.remove('consumer:refreshToken')
    storage.remove('consumer:userId')
    set({ accessToken: null, refreshToken: null, userId: null, isAuthenticated: false })
  },
}))
