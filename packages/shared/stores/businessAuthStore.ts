import { create } from 'zustand'

import { storage } from '../lib/storage'

interface BusinessAuthState {
  accessToken: string | null
  refreshToken: string | null
  businessId: string | null
  isAuthenticated: boolean
  setAuth: (accessToken: string, refreshToken: string, businessId: string) => void
  setAccessToken: (token: string) => void
  logout: () => void
}

export const useBusinessAuthStore = create<BusinessAuthState>()((set) => ({
  accessToken: storage.get('business:accessToken'),
  refreshToken: storage.get('business:refreshToken'),
  businessId: storage.get('business:businessId'),
  isAuthenticated: storage.get('business:accessToken') !== null,
  setAuth: (accessToken, refreshToken, businessId) => {
    storage.set('business:accessToken', accessToken)
    storage.set('business:refreshToken', refreshToken)
    storage.set('business:businessId', businessId)
    set({ accessToken, refreshToken, businessId, isAuthenticated: true })
  },
  setAccessToken: (token) => {
    storage.set('business:accessToken', token)
    set({ accessToken: token })
  },
  logout: () => {
    storage.remove('business:accessToken')
    storage.remove('business:refreshToken')
    storage.remove('business:businessId')
    set({ accessToken: null, refreshToken: null, businessId: null, isAuthenticated: false })
  },
}))
