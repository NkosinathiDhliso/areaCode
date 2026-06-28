import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

type DefaultTab = 'map' | 'ranks'

function getTimeBasedDefault(): DefaultTab {
  const hour = parseInt(
    new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour: 'numeric', hour12: false }),
    10,
  )
  // Map-first by day (discovery), Ranks in the evening (the social pull). The
  // standalone gets/deals surface was removed: gets now live on the map and feed
  // as a reward layer, never as a deals catalog to browse.
  return hour >= 17 ? 'ranks' : 'map'
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
