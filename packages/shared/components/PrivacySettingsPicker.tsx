import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api'
import type { PrivacyLevel } from '../types'

interface PrivacyOption {
  level: PrivacyLevel
  titleKey: string
  descriptionKey: string
  recommended?: boolean
}

const PRIVACY_OPTIONS: PrivacyOption[] = [
  {
    level: 'public',
    titleKey: 'privacy.level.public',
    descriptionKey: 'privacy.level.publicDesc',
  },
  {
    level: 'friends_only',
    titleKey: 'privacy.level.friendsOnly',
    descriptionKey: 'privacy.level.friendsOnlyDesc',
    recommended: true,
  },
  {
    level: 'private',
    titleKey: 'privacy.level.private',
    descriptionKey: 'privacy.level.privateDesc',
  },
]

export function PrivacySettingsPicker() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<PrivacyLevel>('friends_only')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .get<{ privacyLevel: PrivacyLevel }>('/v1/users/me/privacy')
      .then((res) => {
        if (!cancelled) setSelected(res.privacyLevel)
      })
      .catch(() => {
        // Keep default on error
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSelect(level: PrivacyLevel) {
    if (level === selected || saving) return
    const previous = selected
    setSelected(level)
    setSaving(true)
    try {
      await api.patch('/v1/users/me/privacy', { privacyLevel: level })
    } catch {
      setSelected(previous)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider mb-1">
        {t('privacy.settings.title')}
      </h3>
      {PRIVACY_OPTIONS.map((option) => {
        const isSelected = selected === option.level
        return (
          <button
            key={option.level}
            onClick={() => handleSelect(option.level)}
            disabled={loading || saving}
            className={`w-full flex flex-row items-start gap-3 p-4 rounded-2xl border text-left transition-all duration-150 ${
              isSelected
                ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                : 'border-[var(--border)] bg-[var(--bg-surface)]'
            } ${loading || saving ? 'opacity-60' : 'active:scale-[0.98]'}`}
          >
            {/* Radio indicator */}
            <div
              className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                isSelected
                  ? 'border-[var(--accent)]'
                  : 'border-[var(--border-strong)]'
              }`}
            >
              {isSelected && (
                <div className="w-2.5 h-2.5 rounded-full bg-[var(--accent)]" />
              )}
            </div>

            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[var(--text-primary)] text-sm font-medium">
                  {t(option.titleKey)}
                </span>
                {option.recommended && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-medium">
                    {t('privacy.recommended')}
                  </span>
                )}
              </div>
              <p className="text-[var(--text-muted)] text-xs mt-1">
                {t(option.descriptionKey)}
              </p>
            </div>

            {saving && isSelected && (
              <div className="mt-1 w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin flex-shrink-0" />
            )}
          </button>
        )
      })}
    </div>
  )
}
