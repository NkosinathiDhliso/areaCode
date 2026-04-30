import { create } from 'zustand'

import { storage } from '@area-code/shared/lib/storage'

interface StaffAuthState {
  accessToken: string | null
  refreshToken: string | null
  staffId: string | null
  businessId: string | null
  staffName: string | null
  isAuthenticated: boolean
  setAuth: (token: string, refreshToken: string, staffId: string, businessId: string, staffName: string) => void
  setAccessToken: (token: string) => void
  logout: () => void
}

export const useStaffAuthStore = create<StaffAuthState>()((set) => ({
  accessToken: storage.get('staff:accessToken'),
  refreshToken: storage.get('staff:refreshToken'),
  staffId: storage.get('staff:staffId'),
  businessId: storage.get('staff:businessId'),
  staffName: storage.get('staff:staffName'),
  isAuthenticated: storage.get('staff:accessToken') !== null,
  setAuth: (token, refreshToken, staffId, businessId, staffName) => {
    storage.set('staff:accessToken', token)
    storage.set('staff:refreshToken', refreshToken)
    storage.set('staff:staffId', staffId)
    storage.set('staff:businessId', businessId)
    storage.set('staff:staffName', staffName)
    set({ accessToken: token, refreshToken, staffId, businessId, staffName, isAuthenticated: true })
  },
  setAccessToken: (token) => {
    storage.set('staff:accessToken', token)
    set({ accessToken: token })
  },
  logout: () => {
    storage.remove('staff:accessToken')
    storage.remove('staff:refreshToken')
    storage.remove('staff:staffId')
    storage.remove('staff:businessId')
    storage.remove('staff:staffName')
    set({ accessToken: null, refreshToken: null, staffId: null, businessId: null, staffName: null, isAuthenticated: false })
  },
}))
