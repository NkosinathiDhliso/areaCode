import { Spinner } from '@area-code/shared/components/Spinner'
import {
  NOTIFICATION_PREFERENCE_KEYS as PREF_KEYS,
  NOTIFICATION_PREFERENCE_DEFAULTS as DEFAULTS,
  type NotificationPreferenceKey,
} from '@area-code/shared/constants/notification-preferences'
import { api } from '@area-code/shared/lib/api'
import { useErrorStore } from '@area-code/shared/stores/errorStore'
import type { NotificationPreferences } from '@area-code/shared/types'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type PrefKey = NotificationPreferenceKey
type Prefs = NotificationPreferences

export function NotificationSettings() {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS)

  const { isLoading } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: async () => {
      const res = await api.get<Partial<Prefs>>('/v1/users/me/notification-preferences')
      setPrefs({ ...DEFAULTS, ...res })
      return res
    },
    staleTime: 60_000,
  })

  async function toggle(key: PrefKey) {
    const previous = prefs
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    try {
      await api.patch('/v1/users/me/notification-preferences', { [key]: next[key] })
    } catch {
      setPrefs(previous)
      useErrorStore.getState().showError(t('notif.settings.saveFailed'))
    }
  }

  // Marketing (win-back campaign) opt-out. Separate from the transactional
  // preferences above; controls the global campaign opt-out for this consumer
  // across every business (POPIA, reversible).
  const [marketingOptedOut, setMarketingOptedOut] = useState(false)
  const [marketingBusy, setMarketingBusy] = useState(false)

  useQuery({
    queryKey: ['campaign-optout'],
    queryFn: async () => {
      const res = await api.get<{ optedOut: boolean }>('/v1/users/me/campaign-optout')
      setMarketingOptedOut(res.optedOut)
      return res
    },
    staleTime: 60_000,
  })

  async function toggleMarketing() {
    if (marketingBusy) return
    // The switch reads "receive marketing offers": ON = not opted out.
    const currentlyOptedOut = marketingOptedOut
    setMarketingBusy(true)
    setMarketingOptedOut(!currentlyOptedOut)
    try {
      // optOut:true opts out, optOut:false opts back in. Global scope (no businessId).
      await api.post('/v1/users/me/campaign-optout', { optOut: !currentlyOptedOut })
    } catch {
      setMarketingOptedOut(currentlyOptedOut)
      useErrorStore.getState().showError(t('notif.settings.saveFailed'))
    } finally {
      setMarketingBusy(false)
    }
  }

  return (
    <div
      className="flex flex-col h-full overflow-y-auto px-5 pb-4"
      style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}
      data-scroll-container
    >
      <div className="flex flex-row items-center gap-3 mb-4">
        <button
          onClick={() => window.history.back()}
          aria-label={t('common.back', 'Back')}
          className="text-[var(--text-muted)] transition-all active:scale-95"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">{t('notif.settings.title')}</h1>
      </div>

      {isLoading ? (
        <div className="flex justify-center mt-8">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {PREF_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => void toggle(key)}
              className="flex flex-row items-center justify-between bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3 text-left"
            >
              <div className="flex-1 min-w-0 pr-3">
                <p className="text-[var(--text-primary)] text-sm font-medium">{t(`notif.settings.${key}`)}</p>
                <p className="text-[var(--text-muted)] text-xs mt-0.5">{t(`notif.settings.${key}Desc`)}</p>
              </div>
              <span
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
                  prefs[key] ? 'bg-[var(--accent)]' : 'bg-[var(--bg-raised)] border border-[var(--border)]'
                }`}
                role="switch"
                aria-checked={prefs[key]}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                    prefs[key] ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </span>
            </button>
          ))}

          {/* Marketing opt-out (win-back campaigns). ON = receiving. */}
          <button
            onClick={() => void toggleMarketing()}
            disabled={marketingBusy}
            className="flex flex-row items-center justify-between bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl px-4 py-3 text-left mt-2"
          >
            <div className="flex-1 min-w-0 pr-3">
              <p className="text-[var(--text-primary)] text-sm font-medium">
                {t('notif.settings.marketing', 'Win-back offers')}
              </p>
              <p className="text-[var(--text-muted)] text-xs mt-0.5">
                {t(
                  'notif.settings.marketingDesc',
                  'Let venues you have visited send you occasional offers to come back.',
                )}
              </p>
            </div>
            <span
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
                !marketingOptedOut ? 'bg-[var(--accent)]' : 'bg-[var(--bg-raised)] border border-[var(--border)]'
              }`}
              role="switch"
              aria-checked={!marketingOptedOut}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  !marketingOptedOut ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
