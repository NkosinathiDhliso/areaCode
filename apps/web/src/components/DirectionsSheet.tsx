import { Navigation } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { BottomSheet } from '@area-code/shared/components/BottomSheet'

interface DirectionsSheetProps {
  isOpen: boolean
  onClose: () => void
  lat: number
  lng: number
  name: string
}

type Provider = {
  id: 'apple' | 'google' | 'waze'
  label: string
  // Hex tone for the leading dot — keeps the picker visually aligned with
  // each app's brand without bundling logo assets.
  tone: string
  buildUrl: (lat: number, lng: number, name: string) => string
}

const PROVIDERS: Provider[] = [
  {
    id: 'apple',
    label: 'Apple Maps',
    tone: '#a9cbe0',
    buildUrl: (lat, lng, name) => `maps://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(name)}`,
  },
  {
    id: 'google',
    label: 'Google Maps',
    tone: '#34a853',
    buildUrl: (lat, lng, name) =>
      // The comgooglemaps:// scheme launches the installed app directly;
      // if it's not installed iOS falls back to the https URL we open as
      // a backup right after.
      `comgooglemaps://?daddr=${lat},${lng}&q=${encodeURIComponent(name)}&directionsmode=driving`,
  },
  {
    id: 'waze',
    label: 'Waze',
    tone: '#33ccff',
    buildUrl: (lat, lng) => `waze://?ll=${lat},${lng}&navigate=yes`,
  },
]

const FALLBACK_HTTPS: Record<Provider['id'], (lat: number, lng: number, name: string) => string> = {
  apple: (lat, lng, name) => `https://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(name)}`,
  google: (lat, lng, name) =>
    `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodeURIComponent(name)}`,
  waze: (lat, lng) => `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
}

/**
 * Cross-platform directions picker.
 *
 * Why a custom picker instead of a system one?
 * iOS does not expose a "default navigation app" picker the way Android
 * does. Calling `maps://` always launches Apple Maps, regardless of
 * whether the user prefers Google Maps or Waze. To honour user choice
 * we list the three options and try each app's deep-link scheme,
 * falling back to the equivalent HTTPS URL if the app isn't installed.
 *
 * On Android, `geo:` already triggers the system app picker so we could
 * skip this sheet — but we show it anyway for consistency, and because
 * an explicit choice is faster than the system chooser two-step.
 */
export function DirectionsSheet({ isOpen, onClose, lat, lng, name }: DirectionsSheetProps) {
  const { t } = useTranslation()

  const launch = (provider: Provider) => {
    const deepUrl = provider.buildUrl(lat, lng, name)
    const fallbackUrl = FALLBACK_HTTPS[provider.id](lat, lng, name)

    // Try the deep link first. If the app isn't installed, the page
    // navigation silently fails — schedule the HTTPS fallback so the
    // user lands somewhere useful instead of a blank tab.
    // 600ms is the sweet spot: short enough that the user doesn't see
    // a delay, long enough that the OS has handed off to the app.
    const fallbackTimer = window.setTimeout(() => {
      window.location.href = fallbackUrl
    }, 600)

    // If the page becomes hidden (the app launched), cancel the fallback.
    const cancelFallback = () => {
      if (document.hidden) {
        window.clearTimeout(fallbackTimer)
        document.removeEventListener('visibilitychange', cancelFallback)
      }
    }
    document.addEventListener('visibilitychange', cancelFallback)

    window.location.href = deepUrl
    onClose()
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <div className="px-1 pb-2">
        <div className="flex items-center gap-2 mb-4 px-1">
          <Navigation size={18} strokeWidth={1.75} className="text-[var(--accent)]" />
          <h2 className="text-[var(--text-primary)] font-bold text-base">
            {t('directions.title', 'Open directions in')}
          </h2>
        </div>
        <div className="flex flex-col gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => launch(p)}
              className="
                w-full flex items-center justify-between gap-3 px-4 py-3.5
                rounded-xl bg-[var(--bg-raised)] border border-[var(--border)]
                text-[var(--text-primary)] text-sm font-semibold
                transition-all duration-150 active:scale-[0.98]
                hover:border-[var(--border-strong)]
              "
            >
              <div className="flex items-center gap-3">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{
                    background: p.tone,
                    boxShadow: `0 0 10px ${p.tone}80`,
                  }}
                />
                <span>{p.label}</span>
              </div>
              <Navigation size={14} strokeWidth={1.75} className="text-[var(--text-muted)]" />
            </button>
          ))}
        </div>
        <p className="text-[var(--text-muted)] text-xs mt-3 px-1 leading-relaxed">
          {t('directions.fallbackHint', "If the app isn't installed we'll open the web version instead.")}
        </p>
      </div>
    </BottomSheet>
  )
}
