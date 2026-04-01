import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

type DefaultTab = 'gets' | 'ranks'

function getTimeBasedDefault(): DefaultTab {
  const hour = parseInt(
    new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour: 'numeric', hour12: false }),
    10,
  )
  return hour >= 17 ? 'ranks' : 'gets'
}

interface NavigationState {
  activeDefaultTab: DefaultTab
  hasNavigated: boolean
  setHasNavigated: () => void
  resetNavigation: () => void
}

export const useNavigationStore = create<NavigationState>()(
  immer((set) => ({
    activeDefaultTab: getTimeBasedDefault(),
    hasNavigated: false,
    setHasNavigated: () =>
      set((state) => {
        state.hasNavigated = true
      }),
    resetNavigation: () =>
      set((state) => {
        state.hasNavigated = false
        state.activeDefaultTab = getTimeBasedDefault()
      }),
  })),
)

export type { DefaultTab }
