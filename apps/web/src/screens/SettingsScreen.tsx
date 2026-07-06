import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'

import { api } from '@area-code/shared/lib/api'
import { haptic } from '@area-code/shared/lib/haptics'
import { createRapidTapDetector, TROPHY_TAP_GAP_MS, type RapidTapDetector } from '@area-code/shared/lib/rapidTap'
import { isOnline } from '@area-code/shared/lib/platform'
import { isSocketConnected } from '@area-code/shared/lib/socket'
import { useErrorStore } from '@area-code/shared/stores/errorStore'
import { useConsumerAuthStore } from '@area-code/shared/stores/consumerAuthStore'
import { useTheme } from '@area-code/shared/hooks/useTheme'
import type { ThemePreference } from '@area-code/shared/hooks/useTheme'
import { useAppUpdate } from '@area-code/shared/hooks'
import { PrivacyIndicator } from '@area-code/shared/components/PrivacyIndicator'
import { Spinner } from '@area-code/shared/components/Spinner'
import type { PrivacyLevel } from '@area-code/shared/types'
import type { AppRoute } from '../types'

/** Number of fast taps on the version row that toggles the diagnostics card. */
const DIAGNOSTICS_TAP_COUNT = 7

interface SettingsScreenProps {
  onNavigate: (route: AppRoute) => void
}

/**
 * Diagnostics rapid-tap trigger (Hidden_Delight HD-3, Requirement 7). Reuses
 * the one shared `createRapidTapDetector` (no second detector) with a 7-tap
 * threshold and the shared `TROPHY_TAP_GAP_MS` gap. A fired burst toggles the
 * inline diagnostics card: opening it when closed, closing it when open
 * (Requirement 7.1). Single, double, or slow taps do nothing but the row's own
 * pressed feedback.
 *
 * The detector is pure and has no timers, so it is created once in a ref with
 * nothing to clean up. There is no hint copy anywhere: discovery is
 * word-of-mouth (Requirement 7.3, same secrecy contract as Requirement 6).
 */
function useDiagnosticsTap() {
  const [open, setOpen] = useState(false)
  const detectorRef = useRef<RapidTapDetector | null>(null)
  if (detectorRef.current === null) {
    detectorRef.current = createRapidTapDetector({ taps: DIAGNOSTICS_TAP_COUNT, gapMs: TROPHY_TAP_GAP_MS })
  }

  const onPointerDown = useCallback(() => {
    if (detectorRef.current?.tap()) {
      haptic(10)
      setOpen((prev) => !prev)
    }
  }, [])

  return { open, onPointerDown }
}

export function SettingsScreen({ onNavigate }: SettingsScreenProps) {
  const { t } = useTranslation()
  const logout = useConsumerAuthStore((s) => s.logout)
  const { preference, setPreference } = useTheme()
  const { updating, updateApp } = useAppUpdate()
  const { open: showDiagnostics, onPointerDown: onVersionRowPointerDown } = useDiagnosticsTap()
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)

  const { data: privacyData } = useQuery({
    queryKey: ['privacy'],
    queryFn: () => api.get<{ privacyLevel: PrivacyLevel }>('/v1/users/me/privacy'),
    staleTime: 60_000,
  })

  function handleLogout() {
    void api.post('/v1/auth/logout', {}).catch(() => {})
    logout()
    onNavigate('map')
  }

  function handleDataExport() {
    void api
      .get<Record<string, unknown>>('/v1/users/me/data-export')
      .then((data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `area-code-data-export-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
      })
      .catch(() => {
        useErrorStore.getState().showError(t('profile.exportFailed', "Couldn't download your data. Try again."))
      })
  }

  return (
    <div
      className="flex flex-col h-full overflow-y-auto px-5 pb-4"
      style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}
      data-scroll-container
    >
      <div className="flex flex-row items-center gap-3 mb-6">
        <button
          onClick={() => onNavigate('profile')}
          className="text-[var(--text-muted)] text-sm transition-all active:scale-95"
          aria-label={t('common.back', 'Back')}
        >
          <ChevronLeft size={16} strokeWidth={2} className="inline" /> {t('common.back', 'Back')}
        </button>
      </div>

      <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne] mb-6">{t('profile.settings')}</h1>

      {/* Preferences */}
      <SectionHeading label={t('settings.section.preferences', 'Preferences')} />
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 mb-3">
        <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider mb-3">
          {t('profile.appearance')}
        </h3>
        <div className="flex flex-row gap-2">
          {(['auto', 'light', 'dark'] as ThemePreference[]).map((opt) => (
            <button
              key={opt}
              onClick={() => setPreference(opt)}
              className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all duration-150 ${
                preference === opt
                  ? 'gradient-accent'
                  : 'bg-[var(--bg-raised)] text-[var(--text-secondary)] border border-[var(--border)]'
              }`}
            >
              {t(`profile.theme.${opt}`)}
            </button>
          ))}
        </div>
      </div>
      <NavRow label={t('notif.center.settings')} onClick={() => onNavigate('notification-settings')} />

      {/* Privacy & data */}
      <SectionHeading label={t('settings.section.privacyData', 'Privacy & data')} className="mt-3" />
      <NavRow
        label={t('privacy.settings.link')}
        onClick={() => onNavigate('privacy')}
        trailing={privacyData ? <PrivacyIndicator privacyLevel={privacyData.privacyLevel} /> : undefined}
      />
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 mb-3">
        <button onClick={handleDataExport} className="w-full text-left text-[var(--text-primary)] text-sm py-2">
          {t('profile.downloadData', 'Download my data')}
        </button>
      </div>

      {/* App */}
      <SectionHeading label={t('settings.section.app', 'App')} className="mt-3" />
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 mb-3">
        <button
          onClick={() => void updateApp()}
          disabled={updating}
          className="w-full flex flex-row items-center justify-between text-left disabled:opacity-60"
        >
          <span className="text-[var(--text-primary)] text-sm font-medium">
            {updating ? t('profile.updating', 'Updating…') : t('profile.checkForUpdates', 'Check for updates')}
          </span>
          {updating ? (
            <Spinner size="sm" />
          ) : (
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-muted)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          )}
        </button>
        <p className="text-[var(--text-muted)] text-xs mt-2">
          {t('profile.updateHint', 'Reloads the app with the latest version.')}
        </p>
      </div>
      <button
        onPointerDown={onVersionRowPointerDown}
        className="w-full flex flex-row items-center justify-between bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3 mb-3 min-h-11 transition-all active:scale-[0.98]"
      >
        <span className="text-[var(--text-primary)] text-sm font-medium">{t('profile.version', 'Version')}</span>
        <span className="text-[var(--text-muted)] text-sm tabular-nums">{__APP_VERSION__}</span>
      </button>
      {showDiagnostics && <DiagnosticsCard />}

      {/* Account */}
      <SectionHeading label={t('settings.section.account', 'Account')} className="mt-3" />
      <button
        onClick={handleLogout}
        className="w-full border border-[var(--border-strong)] text-[var(--text-primary)] rounded-xl py-3 text-sm"
      >
        {t('auth.gated.signOut')}
      </button>

      <button
        onClick={() => setShowDeleteAccountConfirm(true)}
        className="w-full text-[var(--danger)] text-sm mt-6 mb-4"
      >
        {t('profile.deleteAccount', 'Delete my account')}
      </button>

      {showDeleteAccountConfirm && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-5">
          <div className="bg-[var(--bg-modal)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-[var(--text-primary)] font-bold text-lg mb-2 font-[Syne]">
              {t('profile.deleteAccountTitle', 'Delete your account?')}
            </h3>
            <p className="text-[var(--text-secondary)] text-sm mb-4">
              {t(
                'profile.deleteAccountBody',
                'This will permanently delete your account, check-in history, rewards, and all associated data. This action cannot be undone.',
              )}
            </p>
            <div className="flex flex-row gap-3">
              <button
                onClick={() => setShowDeleteAccountConfirm(false)}
                className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                onClick={() => {
                  setDeletingAccount(true)
                  void api
                    .delete('/v1/users/me')
                    .then(() => {
                      logout()
                      onNavigate('landing')
                    })
                    .catch(() => {
                      setDeletingAccount(false)
                      setShowDeleteAccountConfirm(false)
                    })
                }}
                disabled={deletingAccount}
                className="flex-1 bg-[var(--danger)] text-white rounded-xl py-2.5 text-sm font-medium flex items-center justify-center gap-2"
              >
                {deletingAccount ? (
                  <Spinner size="sm" className="border-white border-t-transparent" />
                ) : (
                  t('profile.deleteAccountConfirm', 'Delete account')
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Inline diagnostics readout (Hidden_Delight HD-3, Requirement 7.1). Shows only
 * app version/build, environment name, online state, and websocket connected
 * state: booleans and names, never secrets, env var values, or URLs. Online and
 * socket state are live values, refreshed on a short interval while the card is
 * mounted (it only mounts while open), and the interval is cleared on unmount.
 */
function DiagnosticsCard() {
  const [state, setState] = useState(() => ({ online: isOnline(), socket: isSocketConnected() }))

  useEffect(() => {
    const id = setInterval(() => {
      setState({ online: isOnline(), socket: isSocketConnected() })
    }, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 mb-3" aria-hidden>
      <DiagnosticsRow label="Version" value={__APP_VERSION__} />
      <DiagnosticsRow label="Build" value={__BUILD_TIME__} />
      <DiagnosticsRow label="Env" value={import.meta.env.MODE} />
      <DiagnosticsRow label="Online" value={state.online ? 'yes' : 'no'} />
      <DiagnosticsRow label="Socket" value={state.socket ? 'connected' : 'disconnected'} />
    </div>
  )
}

function DiagnosticsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-row items-center justify-between py-1">
      <span className="text-[var(--text-muted)] text-xs">{label}</span>
      <span className="text-[var(--text-secondary)] text-xs tabular-nums">{value}</span>
    </div>
  )
}

function SectionHeading({ label, className = '' }: { label: string; className?: string }) {
  return (
    <h2 className={`text-[var(--text-muted)] text-xs font-medium uppercase tracking-wider mb-2 px-1 ${className}`}>
      {label}
    </h2>
  )
}

function NavRow({ label, onClick, trailing }: { label: string; onClick: () => void; trailing?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex flex-row items-center justify-between bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3 mb-3 transition-all active:scale-[0.98]"
    >
      <div className="flex items-center gap-3">
        <span className="text-[var(--text-primary)] text-sm font-medium">{label}</span>
        {trailing}
      </div>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  )
}
