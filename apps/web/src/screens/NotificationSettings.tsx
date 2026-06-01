import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { api } from '@area-code/shared/lib/api'
import { useErrorStore } from '@area-code/shared/stores/errorStore'
import { Spinner } from '@area-code/shared/components/Spinner'
import type { AppRoute } from '../types'

interface NotificationSettingsProps {
  onNavigate: (route: AppRoute) => void
}

type PrefKey =
  | 'streakAtRisk'
  | 'rewardActivated'
  | 'rewardClaimedPush'
  | 'leaderboardPrewarning'
  | 'followedUserCheckin'

type Prefs = Record<PrefKey, boolean>

const PREF_KEYS: PrefKey[] = [
  'rewardClaimedPush',
  'rewardActivated',
  'streakAtRisk',
  'leaderboardPrewarning',
  'followedUserCheckin',
]

const DEFAULTS: Prefs = {
  streakAtRisk: false,
  rewardActivated: false,
  rewardClaimedPush: true,
  leaderboardPrewarning: false,
  followedUserCheckin: false,
}

export function NotificationSettings({ onNavigate }: NotificationSettingsProps) {
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

  return (
    <div className="flex flex-col h-full overflow-y-auto px-5 pt-6 pb-4" data-scroll-container>
      <div className="flex flex-row items-center gap-3 mb-4">
        <button onClick={() => onNavigate('notifications')} aria-label="Back" className="text-[var(--text-muted)]">
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
        </div>
      )}
    </div>
  )
}
