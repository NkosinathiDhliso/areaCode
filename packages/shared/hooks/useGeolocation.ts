import { useCallback } from 'react'

import { hasGeolocation, getCurrentPosition } from '../lib/platform'
import { useLocationStore, type GeoStatus } from '../stores/locationStore'

const GPS_TIMEOUT = 8000
const ACCURACY_THRESHOLD = 200

export function useGeolocation() {
  const {
    setPosition, setPermissionState, setGeoStatus,
    lastKnownPosition, accuracy, permissionState, geoStatus,
  } = useLocationStore()

  const requestLocation = useCallback((): Promise<{ lat: number; lng: number; accuracy: number } | null> => {
    if (!hasGeolocation()) {
      setGeoStatus('denied')
      return Promise.resolve(null)
    }

    setGeoStatus('requesting')

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
        { enableHighAccuracy: true, timeout: GPS_TIMEOUT, maximumAge: 10000 },
      )
    })
  }, [lastKnownPosition, accuracy, setPosition, setPermissionState, setGeoStatus])

  return {
    requestLocation,
    lastKnownPosition,
    accuracy,
    permissionState,
    geoStatus,
  }
}

export type { GeoStatus }
