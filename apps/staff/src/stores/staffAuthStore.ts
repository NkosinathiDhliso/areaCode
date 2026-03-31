import { create } from 'zustand'

import { storage } from '@area-code/shared/lib/storage'

interface StaffAuthState {
  accessToken: string | null
  staffId: string | null
  businessId: string | null
  nodeName: string | null
  isAuthenticated: boolean
  setAuth: (token: string, staffId: string, businessId: string, nodeName: string) => void
  logout: () => void
}

export const useStaffAuthStore = create<StaffAuthState>()((set) => ({
  accessToken: storage.get('staff:accessToken'),
  staffId: storage.get('staff:staffId'),
  businessId: storage.get('staff:businessId'),
  nodeName: storage.get('staff:nodeName'),
  isAuthenticated: storage.get('staff:accessToken') !== null,
  setAuth: (token, staffId, businessId, nodeName) => {
    storage.set('staff:accessToken', token)
    storage.set('staff:staffId', staffId)
    storage.set('staff:businessId', businessId)
    storage.set('staff:nodeName', nodeName)
    set({ accessToken: token, staffId, businessId, nodeName, isAuthenticated: true })
  },
  logout: () => {
    storage.remove('staff:accessToken')
    storage.remove('staff:staffId')
    storage.remove('staff:businessId')
    storage.remove('staff:nodeName')
    set({ accessToken: null, staffId: null, businessId: null, nodeName: null, isAuthenticated: false })
  },
}))
