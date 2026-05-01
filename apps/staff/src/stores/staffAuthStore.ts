import { create } from 'zustand'

import { storage } from '@area-code/shared/lib/storage'
import { api } from '@area-code/shared/lib/api'

interface StaffAuthState {
  accessToken: string | null
  refreshToken: string | null
  sessionId: string | null
  staffId: string | null
  businessId: string | null
  staffName: string | null
  isAuthenticated: boolean
  setAuth: (
    token: string,
    refreshToken: string,
    staffId: string,
    businessId: string,
    staffName: string,
    sessionId?: string,
  ) => void
  setAccessToken: (token: string) => void
  logout: () => void
}

export const useStaffAuthStore = create<StaffAuthState>()((set) => ({
  accessToken: storage.get('staff:accessToken'),
  refreshToken: storage.get('staff:refreshToken'),
  sessionId: storage.get('staff:sessionId'),
  staffId: storage.get('staff:staffId'),
  businessId: storage.get('staff:businessId'),
  staffName: storage.get('staff:staffName'),
  isAuthenticated: storage.get('staff:accessToken') !== null,
  setAuth: (token, refreshToken, staffId, businessId, staffName, sessionId) => {
    storage.set('staff:accessToken', token)
    storage.set('staff:refreshToken', refreshToken)
    storage.set('staff:staffId', staffId)
    storage.set('staff:businessId', businessId)
    storage.set('staff:staffName', staffName)
    if (sessionId) storage.set('staff:sessionId', sessionId)
    set({
      accessToken: token,
      refreshToken,
      sessionId: sessionId ?? null,
      staffId,
      businessId,
      staffName,
      isAuthenticated: true,
    })
  },
  setAccessToken: (token) => {
    storage.set('staff:accessToken', token)
    set({ accessToken: token })
  },
  logout: () => {
    // Revoke session on the backend (best effort)
    const sessionId = storage.get('staff:sessionId')
    api.post('/v1/auth/logout', { sessionId: sessionId ?? undefined }).catch(() => {})
    storage.remove('staff:accessToken')
    storage.remove('staff:refreshToken')
    storage.remove('staff:sessionId')
    storage.remove('staff:staffId')
    storage.remove('staff:businessId')
    storage.remove('staff:staffName')
    set({
      accessToken: null,
      refreshToken: null,
      sessionId: null,
      staffId: null,
      businessId: null,
      staffName: null,
      isAuthenticated: false,
    })
  },
}))
