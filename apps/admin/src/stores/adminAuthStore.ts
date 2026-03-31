import { create } from 'zustand'

import { storage } from '@area-code/shared/lib/storage'
import type { AdminRole } from '@area-code/shared/types'

interface AdminAuthState {
  accessToken: string | null
  adminId: string | null
  role: AdminRole | null
  isAuthenticated: boolean
  setAuth: (token: string, adminId: string, role: AdminRole) => void
  logout: () => void
}

export const useAdminAuthStore = create<AdminAuthState>()((set) => ({
  accessToken: storage.get('admin:accessToken'),
  adminId: storage.get('admin:adminId'),
  role: storage.get('admin:role') as AdminRole | null,
  isAuthenticated: storage.get('admin:accessToken') !== null,
  setAuth: (token, adminId, role) => {
    storage.set('admin:accessToken', token)
    storage.set('admin:adminId', adminId)
    storage.set('admin:role', role)
    set({ accessToken: token, adminId, role, isAuthenticated: true })
  },
  logout: () => {
    storage.remove('admin:accessToken')
    storage.remove('admin:adminId')
    storage.remove('admin:role')
    set({ accessToken: null, adminId: null, role: null, isAuthenticated: false })
  },
}))
