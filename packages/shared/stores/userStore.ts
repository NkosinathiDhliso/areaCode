import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { persist } from 'zustand/middleware'
import type { User, Tier } from '../types'
import { storage } from '../lib/storage'

interface OnboardingState {
  hintSeen: boolean
  layerHintSeen: boolean
  firstCheckIn: boolean
}

interface UserStore {
  user: User | null
  tier: Tier
  totalCheckIns: number
  streakCount: number
  onboarding: OnboardingState
  setUser: (user: User) => void
  clearUser: () => void
  incrementCheckIns: () => void
  setStreak: (count: number) => void
  markHintSeen: (hint: keyof OnboardingState) => void
}

export const useUserStore = create<UserStore>()(
  persist(
    immer((set) => ({
      user: null,
      tier: 'local' as Tier,
      totalCheckIns: 0,
      streakCount: 0,
      onboarding: { hintSeen: false, layerHintSeen: false, firstCheckIn: false },
      setUser: (user) =>
        set((state) => {
          state.user = user
          state.tier = user.tier
          state.totalCheckIns = user.totalCheckIns
        }),
      clearUser: () =>
        set((state) => {
          state.user = null
          state.tier = 'local'
          state.totalCheckIns = 0
          state.streakCount = 0
        }),
      incrementCheckIns: () =>
        set((state) => {
          state.totalCheckIns += 1
        }),
      setStreak: (count) =>
        set((state) => {
          state.streakCount = count
        }),
      markHintSeen: (hint) =>
        set((state) => {
          state.onboarding[hint] = true
        }),
    })),
    {
      name: 'area-code-user',
      storage: {
        getItem: (name) => {
          const val = storage.get(name)
          return val ? JSON.parse(val) : null
        },
        setItem: (name, value) => storage.set(name, JSON.stringify(value)),
        removeItem: (name) => storage.remove(name),
      },
    },
  ),
)

export type { OnboardingState }
