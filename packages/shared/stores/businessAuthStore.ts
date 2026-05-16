import { create } from 'zustand'

import { storage } from '../lib/storage'

export type BusinessMemberRole = 'owner' | 'manager' | 'staff'

interface BusinessAuthState {
  accessToken: string | null
  refreshToken: string | null
  businessId: string | null
  role: BusinessMemberRole | null
  permissions: string[]
  isAuthenticated: boolean
  setAuth: (accessToken: string, refreshToken: string, businessId: string) => void
  setAccessToken: (token: string) => void
  setRole: (role: BusinessMemberRole, permissions: string[]) => void
  hasPermission: (permission: string) => boolean
  logout: () => void
}

export const useBusinessAuthStore = create<BusinessAuthState>()((set, get) => ({
  accessToken: storage.get('business:accessToken'),
  refreshToken: storage.get('business:refreshToken'),
  businessId: storage.get('business:businessId'),
  role: (storage.get('business:role') as BusinessMemberRole | null) ?? null,
  permissions: JSON.parse(storage.get('business:permissions') ?? '[]') as string[],
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
  setRole: (role, permissions) => {
    storage.set('business:role', role)
    storage.set('business:permissions', JSON.stringify(permissions))
    set({ role, permissions })
  },
  hasPermission: (permission) => {
    return get().permissions.includes(permission)
  },
  logout: () => {
    storage.remove('business:accessToken')
    storage.remove('business:refreshToken')
    storage.remove('business:businessId')
    storage.remove('business:role')
    storage.remove('business:permissions')
    set({
      accessToken: null,
      refreshToken: null,
      businessId: null,
      role: null,
      permissions: [],
      isAuthenticated: false,
    })
  },
}))
