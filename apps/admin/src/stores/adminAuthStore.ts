import { storage } from '@area-code/shared/lib/storage'
import type { AdminRole } from '@area-code/shared/types'
import { create } from 'zustand'

interface AdminAuthState {
  accessToken: string | null
  refreshToken: string | null
  adminId: string | null
  role: AdminRole | null
  isAuthenticated: boolean
  setAuth: (token: string, refreshToken: string, adminId: string, role: AdminRole) => void
  setAccessToken: (token: string) => void
  logout: () => void
}

export const useAdminAuthStore = create<AdminAuthState>()((set) => ({
  accessToken: storage.get('admin:accessToken'),
  refreshToken: storage.get('admin:refreshToken'),
  adminId: storage.get('admin:adminId'),
  role: storage.get('admin:role') as AdminRole | null,
  isAuthenticated: storage.get('admin:accessToken') !== null,
  setAuth: (token, refreshToken, adminId, role) => {
    storage.set('admin:accessToken', token)
    storage.set('admin:refreshToken', refreshToken)
    storage.set('admin:adminId', adminId)
    storage.set('admin:role', role)
    set({ accessToken: token, refreshToken, adminId, role, isAuthenticated: true })
  },
  setAccessToken: (token) => {
    storage.set('admin:accessToken', token)
    set({ accessToken: token })
  },
  logout: () => {
    storage.remove('admin:accessToken')
    storage.remove('admin:refreshToken')
    storage.remove('admin:adminId')
    storage.remove('admin:role')
    set({ accessToken: null, refreshToken: null, adminId: null, role: null, isAuthenticated: false })
  },
}))
