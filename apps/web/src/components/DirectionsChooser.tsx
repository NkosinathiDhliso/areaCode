import { useState, useEffect } from 'react'
import { BottomSheet } from '@area-code/shared/components/BottomSheet'
import { ActionRow } from '@area-code/shared/components/ActionRow'

const LAST_MAP_APP_KEY = 'directions_last_app'

type MapApp = 'google' | 'waze' | 'apple'

interface DirectionsChooserProps {
  isOpen: boolean
  onClose: () => void
  lat: number
  lng: number
  name: string
}

function getAvailableApps(): MapApp[] {
  const apps: MapApp[] = ['google', 'waze']
  const ua = navigator.userAgent.toLowerCase()
  const isIOS = /iphone|ipad|ipod/.test(ua)
  if (isIOS) apps.push('apple')
  return apps
}

function getDeepLinkUrl(app: MapApp, lat: number, lng: number, name: string): string {
  const encodedName = encodeURIComponent(name)
  switch (app) {
    case 'google':
      return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodedName}`
    case 'waze':
      return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes&q=${encodedName}`
    case 'apple':
      return `maps://maps.apple.com/?daddr=${lat},${lng}&q=${encodedName}`
  }
}

function getAppLabel(app: MapApp): string {
  switch (app) {
    case 'google': return 'Google Maps'
    case 'waze': return 'Waze'
    case 'apple': return 'Apple Maps'
  }
}

function getAppIcon(app: MapApp): string {
  switch (app) {
    case 'google': return '🗺️'
    case 'waze': return '🚗'
    case 'apple': return '🍎'
  }
}

function getLastUsedApp(): MapApp | null {
  try {
    return localStorage.getItem(LAST_MAP_APP_KEY) as MapApp | null
  } catch { return null }
}

function setLastUsedApp(app: MapApp): void {
  try { localStorage.setItem(LAST_MAP_APP_KEY, app) } catch { /* ignore */ }
}

export function DirectionsChooser({ isOpen, onClose, lat, lng, name }: DirectionsChooserProps) {
  const [apps] = useState(getAvailableApps)

  // If only one app available, open directly
  useEffect(() => {
    if (!isOpen) return
    if (apps.length === 1) {
      openApp(apps[0]!)
      onClose()
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // If user has a preference and it's available, open directly
  useEffect(() => {
    if (!isOpen) return
    const lastApp = getLastUsedApp()
    if (lastApp && apps.includes(lastApp)) {
      openApp(lastApp)
      onClose()
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  function openApp(app: MapApp) {
    setLastUsedApp(app)
    const url = getDeepLinkUrl(app, lat, lng, name)
    window.open(url, '_blank')
  }

  function handleSelect(app: MapApp) {
    openApp(app)
    onClose()
  }

  // Don't show chooser if auto-opening
  const lastApp = getLastUsedApp()
  if (apps.length === 1 || (lastApp && apps.includes(lastApp))) {
    return null
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Get Directions">
      <h3 className="text-[var(--text-primary)] font-bold text-lg font-[Syne] mb-4">
        Choose navigation app
      </h3>
      <div className="flex flex-col gap-1">
        {apps.map((app) => (
          <ActionRow
            key={app}
            icon={<span className="text-lg">{getAppIcon(app)}</span>}
            label={getAppLabel(app)}
            onClick={() => handleSelect(app)}
            chevron
          />
        ))}
      </div>
      <p className="text-[var(--text-muted)] text-xs mt-4 text-center">
        Your choice will be remembered for next time
      </p>
    </BottomSheet>
  )
}

/**
 * Hook to use the directions chooser.
 * Returns a function that either opens the chooser or navigates directly.
 */
export function useDirections() {
  const [state, setState] = useState<{ isOpen: boolean; lat: number; lng: number; name: string }>({
    isOpen: false, lat: 0, lng: 0, name: '',
  })

  function openDirections(lat: number, lng: number, name: string) {
    const apps = getAvailableApps()
    const lastApp = getLastUsedApp()

    // Open directly if only one app or user has preference
    if (apps.length === 1) {
      setLastUsedApp(apps[0]!)
      window.open(getDeepLinkUrl(apps[0]!, lat, lng, name), '_blank')
      return
    }
    if (lastApp && apps.includes(lastApp)) {
      window.open(getDeepLinkUrl(lastApp, lat, lng, name), '_blank')
      return
    }

    setState({ isOpen: true, lat, lng, name })
  }

  function close() {
    setState((s) => ({ ...s, isOpen: false }))
  }

  return { openDirections, chooserProps: { ...state, onClose: close } }
}
