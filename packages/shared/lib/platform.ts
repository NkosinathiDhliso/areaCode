export const isWeb = typeof document !== 'undefined'

export function setPageTitle(title: string): void {
  if (isWeb) {
    document.title = title
  }
}

export function getDeviceInfo(): { platform: 'web' | 'ios' | 'android'; cores: number } {
  if (!isWeb) {
    return { platform: 'web', cores: 4 }
  }

  const ua = navigator.userAgent.toLowerCase()
  const platform =
    ua.includes('iphone') || ua.includes('ipad')
      ? ('ios' as const)
      : ua.includes('android')
        ? ('android' as const)
        : ('web' as const)

  return {
    platform,
    cores: navigator.hardwareConcurrency ?? 4,
  }
}

export function isOnline(): boolean {
  if (!isWeb) return true
  return navigator.onLine
}

export function isSaveDataEnabled(): boolean {
  if (!isWeb) return false
  const connection = (navigator as unknown as Record<string, unknown>).connection as { saveData?: boolean } | undefined
  return connection?.saveData ?? false
}

export function hasGeolocation(): boolean {
  if (injectedGeolocation) return true
  return isWeb && 'geolocation' in navigator
}

// ── Injectable geolocation (React Native) ────────────────────────────────────
// On web we use the browser `navigator.geolocation` API. React Native has no
// such global, so the native app injects an implementation backed by
// `expo-location` at boot via `setGeolocationProvider`.

interface GeolocationProvider {
  getCurrentPosition(
    onSuccess: (coords: { latitude: number; longitude: number; accuracy: number }) => void,
    onError: (error: { code: number; PERMISSION_DENIED: number }) => void,
    options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
  ): void
}

let injectedGeolocation: GeolocationProvider | null = null

/** Wire a native geolocation implementation (e.g. expo-location). No-op on web. */
export function setGeolocationProvider(provider: GeolocationProvider | null): void {
  injectedGeolocation = provider
}

export function getCurrentPosition(
  onSuccess: (coords: { latitude: number; longitude: number; accuracy: number }) => void,
  onError: (error: { code: number; PERMISSION_DENIED: number }) => void,
  options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
): void {
  if (injectedGeolocation) {
    injectedGeolocation.getCurrentPosition(onSuccess, onError, options)
    return
  }
  if (!isWeb || !('geolocation' in navigator)) {
    onError({ code: 2, PERMISSION_DENIED: 1 })
    return
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => onSuccess(pos.coords),
    (err) => onError({ code: err.code, PERMISSION_DENIED: err.PERMISSION_DENIED }),
    options,
  )
}
