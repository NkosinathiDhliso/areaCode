import { useCallback } from 'react'

import { hasGeolocation, getCurrentPosition } from '../lib/platform'
import { useLocationStore, type GeoStatus } from '../stores/locationStore'

const GPS_TIMEOUT = 8000
const ACCURACY_THRESHOLD = 200

export function useGeolocation() {
  const setPosition = useLocationStore((s) => s.setPosition)
  const setPermissionState = useLocationStore((s) => s.setPermissionState)
  const setGeoStatus = useLocationStore((s) => s.setGeoStatus)
  const lastKnownPosition = useLocationStore((s) => s.lastKnownPosition)
  const accuracy = useLocationStore((s) => s.accuracy)
  const permissionState = useLocationStore((s) => s.permissionState)
  const geoStatus = useLocationStore((s) => s.geoStatus)

  const requestLocation = useCallback(
    (opts?: { forceRefresh?: boolean }): Promise<{ lat: number; lng: number; accuracy: number } | null> => {
      if (!hasGeolocation()) {
        setGeoStatus('denied')
        return Promise.resolve(null)
      }

      setGeoStatus('requesting')

      // forceRefresh = true → maximumAge: 0 forces a brand-new GPS fix
      // (default) → maximumAge: 10000 allows a 10-second-old cached position
      const maxAge = opts?.forceRefresh ? 0 : 10000

      return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          setGeoStatus('timeout')
          resolve(lastKnownPosition ? { ...lastKnownPosition, accuracy: accuracy ?? Infinity } : null)
        }, GPS_TIMEOUT)

        getCurrentPosition(
          (coords) => {
            clearTimeout(timeoutId)
            setPosition(coords.latitude, coords.longitude, coords.accuracy)
            setPermissionState('granted')

            if (coords.accuracy > ACCURACY_THRESHOLD) {
              setGeoStatus('poorAccuracy')
            } else {
              setGeoStatus('acquired')
            }

            resolve({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy })
          },
          (err) => {
            clearTimeout(timeoutId)
            if (err.code === err.PERMISSION_DENIED) {
              setGeoStatus('denied')
              setPermissionState('denied')
            } else {
              setGeoStatus('timeout')
            }
            resolve(null)
          },
          { enableHighAccuracy: true, timeout: GPS_TIMEOUT, maximumAge: maxAge },
        )
      })
    },
    [lastKnownPosition, accuracy, setPosition, setPermissionState, setGeoStatus],
  )

  return {
    requestLocation,
    lastKnownPosition,
    accuracy,
    permissionState,
    geoStatus,
  }
}

export type { GeoStatus }
