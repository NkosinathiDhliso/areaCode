import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

type PermissionState = 'prompt' | 'granted' | 'denied'
type GeoStatus = 'idle' | 'requesting' | 'acquired' | 'poorAccuracy' | 'timeout' | 'denied'

interface LocationState {
  lastKnownPosition: { lat: number; lng: number } | null
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
    accuracy: null,
    permissionState: 'prompt',
    geoStatus: 'idle' as GeoStatus,
    setPosition: (lat, lng, accuracy) =>
      set((state) => {
        state.lastKnownPosition = { lat, lng }
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
