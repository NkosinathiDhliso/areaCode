import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

type PermissionState = 'prompt' | 'granted' | 'denied'
type GeoStatus = 'idle' | 'requesting' | 'acquired' | 'poorAccuracy' | 'timeout' | 'denied'

interface LocationState {
  lastKnownPosition: { lat: number; lng: number } | null
  /**
   * `Date.now()` at the moment `lastKnownPosition` was last set.
   * Used by Map_Sidebar to gate Recenter_Button behind the 60s freshness
   * window per Live Vibe on Map R1.3 / R1.4. Lives in client memory only;
   * never persisted, never written to local storage.
   */
  capturedAt: number | null
  accuracy: number | null
  permissionState: PermissionState
  geoStatus: GeoStatus
  setPosition: (lat: number, lng: number, accuracy: number) => void
  setPermissionState: (state: PermissionState) => void
  setGeoStatus: (status: GeoStatus) => void
}

export const useLocationStore = create<LocationState>()(
  immer((set) => ({
    lastKnownPosition: null,
    capturedAt: null,
    accuracy: null,
    permissionState: 'prompt',
    geoStatus: 'idle' as GeoStatus,
    setPosition: (lat, lng, accuracy) =>
      set((state) => {
        state.lastKnownPosition = { lat, lng }
        state.capturedAt = Date.now()
        state.accuracy = accuracy
      }),
    setPermissionState: (permState) =>
      set((state) => {
        state.permissionState = permState
      }),
    setGeoStatus: (status) =>
      set((state) => {
        state.geoStatus = status
      }),
  })),
)

export type { PermissionState, GeoStatus }
