import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import type { User, Tier } from '@area-code/shared/types'
import { useAdminAuthStore } from '../stores/adminAuthStore'

interface ConsumerDetail extends User {
  isDisabled: boolean
  streakCount: number
  abuseFlags: number
}

export function ConsumerManagement() {
  const { t } = useTranslation()
  const role = useAdminAuthStore((s) => s.role)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ConsumerDetail[]>([])
  const [selected, setSelected] = useState<ConsumerDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [actionNote, setActionNote] = useState('')

  async function handleSearch() {
    if (!query.trim()) return
    setLoading(true)
    try {
      const res = await api.get<{ items: ConsumerDetail[] }>(
        `/v1/admin/consumers?q=${encodeURIComponent(query)}`,
      )
      setResults(res.items)
    } catch {
      // Fail silently
    } finally {
      setLoading(false)
    }
  }

  async function handleAction(action: string, userId: string) {
    try {
      await api.post(`/v1/admin/consumers/${userId}/${action}`, {
        note: actionNote || undefined,
      })
      setActionNote('')
      handleSearch()
    } catch {
      // Fail silently
    }
  }

  const canModify = role === 'super_admin' || role === 'support_agent'

  return (
    <div className="p-5">
      <h2 className="text-[var(--text-primary)] font-bold text-xl mb-4 font-[Syne]">
        {t('admin.consumers.title')}
      </h2>

      <div className="flex flex-row gap-3 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder={t('admin.consumers.search')}
          className="flex-1 bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="bg-[var(--accent)] text-white font-semibold rounded-xl px-6 py-3 text-sm"
        >
          Search
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {results.map((user) => (
          <div
            key={user.id}
            onClick={() => setSelected(selected?.id === user.id ? null : user)}
            className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 cursor-pointer"
          >
            <div className="flex flex-row items-center justify-between">
              <div>
                <span className="text-[var(--text-primary)] font-medium">{user.username}</span>
                <span className="text-[var(--text-muted)] text-xs ml-2">{user.phone}</span>
              </div>
              <div className="flex flex-row items-center gap-2">
                <TierLabel tier={user.tier} />
                {user.isDisabled && (
                  <span className="text-[var(--danger)] text-xs">Disabled</span>
                )}
              </div>
            </div>

            {selected?.id === user.id && canModify && (
              <div className="mt-4 pt-4 border-t border-[var(--border)] flex flex-col gap-3">
                <div className="text-[var(--text-secondary)] text-xs">
                  Check-ins: {user.totalCheckIns} · Streak: {user.streakCount} · Flags: {user.abuseFlags}
                </div>
                <input
                  type="text"
                  value={actionNote}
                  onChange={(e) => setActionNote(e.target.value)}
                  placeholder="Reason (required for some actions)"
                  className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-xs placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
                />
                <div className="flex flex-row flex-wrap gap-2">
                  <ActionButton
                    label={user.isDisabled ? t('admin.consumers.enable') : t('admin.consumers.disable')}
                    onClick={() => handleAction(user.isDisabled ? 'enable' : 'disable', user.id)}
                  />
                  <ActionButton
                    label={t('admin.consumers.resetFlags')}
                    onClick={() => handleAction('reset-flags', user.id)}
                  />
                  <ActionButton
                    label={t('admin.consumers.recalcTier')}
                    onClick={() => handleAction('recalc-tier', user.id)}
                  />
                  <ActionButton
                    label={t('admin.consumers.overrideStreak')}
                    onClick={() => handleAction('override-streak', user.id)}
                  />
                  {role === 'super_admin' && (
                    <ActionButton
                      label={t('admin.consumers.processErasure')}
                      onClick={() => handleAction('process-erasure', user.id)}
                      danger
                    />
                  )}
                  <ActionButton
                    label={t('admin.consumers.sendMessage')}
                    onClick={() => handleAction('send-message', user.id)}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function TierLabel({ tier }: { tier: Tier }) {
  return (
    <span className="text-[var(--text-muted)] text-xs capitalize">{tier}</span>
  )
}

function ActionButton({
  label,
  onClick,
  danger = false,
}: {
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`border rounded-xl px-3 py-1.5 text-xs transition-all duration-150 active:scale-95 ${
        danger
          ? 'border-[var(--danger)] text-[var(--danger)]'
          : 'border-[var(--border-strong)] text-[var(--text-primary)]'
      }`}
    >
      {label}
    </button>
  )
}
