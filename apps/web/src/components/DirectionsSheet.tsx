import { BottomSheet } from '@area-code/shared/components/BottomSheet'
import { Globe, Navigation } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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
  // Hex tone for the leading dot - keeps the picker visually aligned with
  // each app's brand without bundling logo assets.
  tone: string
  // Native scheme: opens the installed app.
  buildAppUrl: (lat: number, lng: number, name: string) => string
  // Same destination on the web, opened only when the user picks it.
  buildWebUrl: (lat: number, lng: number, name: string) => string
}

const PROVIDERS: Provider[] = [
  {
    id: 'apple',
    label: 'Apple Maps',
    tone: '#a9cbe0',
    buildAppUrl: (lat, lng, name) => `maps://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(name)}`,
    buildWebUrl: (lat, lng, name) => `https://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(name)}`,
  },
  {
    id: 'google',
    label: 'Google Maps',
    tone: '#34a853',
    // The comgooglemaps:// scheme launches the installed app directly.
    buildAppUrl: (lat, lng, name) =>
      `comgooglemaps://?daddr=${lat},${lng}&q=${encodeURIComponent(name)}&directionsmode=driving`,
    buildWebUrl: (lat, lng, name) =>
      `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodeURIComponent(name)}`,
  },
  {
    id: 'waze',
    label: 'Waze',
    tone: '#33ccff',
    buildAppUrl: (lat, lng) => `waze://?ll=${lat},${lng}&navigate=yes`,
    buildWebUrl: (lat, lng) => `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
  },
]

/**
 * Cross-platform directions picker.
 *
 * Why a custom picker instead of a system one?
 * iOS does not expose a "default navigation app" picker the way Android
 * does. Calling `maps://` always launches Apple Maps, regardless of
 * whether the user prefers Google Maps or Waze. To honour user choice
 * we list the three options and their native schemes.
 *
 * Each row carries two explicit choices: the app, and the same destination
 * on the web (R15.21). There is no timer that decides for the user. A
 * timed "did the app open?" guess cannot be made honestly - the browser
 * does not report whether a scheme handed off - and when it guessed wrong
 * it navigated the SPA away mid-session. So the web link is a visible
 * second action the user picks, opened in a new tab so the map survives.
 *
 * On Android, `geo:` already triggers the system app picker so we could
 * skip this sheet - but we show it anyway for consistency, and because
 * an explicit choice is faster than the system chooser two-step.
 */
export function DirectionsSheet({ isOpen, onClose, lat, lng, name }: DirectionsSheetProps) {
  const { t } = useTranslation()

  const launchApp = (provider: Provider) => {
    window.location.href = provider.buildAppUrl(lat, lng, name)
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
            <div key={p.id} className="flex items-stretch gap-2">
              <button
                onClick={() => launchApp(p)}
                data-directions-app={p.id}
                className="
                  flex-1 min-h-11 flex items-center justify-between gap-3 px-4 py-3.5
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
              <a
                href={p.buildWebUrl(lat, lng, name)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onClose}
                data-directions-web={p.id}
                aria-label={t('directions.openInBrowserFor', { label: p.label })}
                className="
                  min-w-11 min-h-11 px-3 flex items-center justify-center gap-1.5
                  rounded-xl bg-[var(--bg-raised)] border border-[var(--border)]
                  text-[var(--text-secondary)] text-xs font-semibold
                  transition-all duration-150 active:scale-[0.98]
                  hover:border-[var(--border-strong)]
                "
              >
                <Globe size={14} strokeWidth={1.75} />
                <span>{t('directions.openInBrowser', 'Browser')}</span>
              </a>
            </div>
          ))}
        </div>
      </div>
    </BottomSheet>
  )
}
