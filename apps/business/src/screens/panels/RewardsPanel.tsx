import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import type { Reward } from '@area-code/shared/types'
import { formatRelativeTime } from '@area-code/shared/lib/formatters'

export function RewardsPanel() {
  const { t } = useTranslation()
  const [rewards, setRewards] = useState<Reward[]>([])
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    async function fetch() {
      try {
        const res = await api.get<{ items: Reward[] }>('/v1/business/rewards')
        setRewards(res.items)
      } catch {
        // Fail silently
      }
    }
    fetch()
  }, [])

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex flex-row items-center justify-between">
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
          {t('biz.panel.rewards')}
        </h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-[var(--accent)] text-white rounded-full w-10 h-10 flex items-center justify-center text-xl"
          aria-label={t('biz.rewards.create')}
        >
          +
        </button>
      </div>

      {showForm && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-5">
          <p className="text-[var(--warning)] text-xs mb-3">{t('biz.rewards.slotWarning')}</p>
          <RewardForm onCreated={() => { setShowForm(false) }} />
        </div>
      )}

      <div className="flex flex-col gap-3">
        {rewards.map((r) => (
          <div key={r.id} className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
            <div className="flex flex-row items-center justify-between mb-1">
              <span className="text-[var(--text-primary)] font-medium">{r.title}</span>
              <span className={`text-xs ${r.isActive ? 'text-[var(--success)]' : 'text-[var(--text-muted)]'}`}>
                {r.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div className="text-[var(--text-secondary)] text-xs">
              {r.claimedCount}/{r.totalSlots ?? '∞'} claimed
              {r.expiresAt && ` · Expires ${formatRelativeTime(r.expiresAt)}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RewardForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState('nth_checkin')
  const [slots, setSlots] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    setLoading(true)
    try {
      await api.post('/v1/business/rewards', {
        title,
        type,
        totalSlots: slots ? parseInt(slots, 10) : null,
      })
      onCreated()
    } catch {
      // Fail silently
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Reward title"
        className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value)}
        className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none"
      >
        <option value="nth_checkin">Nth Check-in</option>
        <option value="daily_first">Daily First</option>
        <option value="streak">Streak</option>
        <option value="milestone">Milestone</option>
      </select>
      <input
        type="number"
        value={slots}
        onChange={(e) => setSlots(e.target.value)}
        placeholder="Total slots (leave empty for unlimited)"
        className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
      />
      <button
        onClick={handleSubmit}
        disabled={loading || !title}
        className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3 text-sm disabled:opacity-50"
      >
        {loading ? '...' : 'Create Reward'}
      </button>
    </div>
  )
}
