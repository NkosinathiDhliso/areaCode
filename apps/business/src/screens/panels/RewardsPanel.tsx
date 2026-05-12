import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import { useErrorStore } from '@area-code/shared/stores/errorStore'
import type { Node, Reward } from '@area-code/shared/types'
import { formatRelativeTime } from '@area-code/shared/lib/formatters'

export function RewardsPanel() {
  const { t } = useTranslation()
  const [rewards, setRewards] = useState<Reward[]>([])
  const [nodes, setNodes] = useState<Node[]>([])
  const [showForm, setShowForm] = useState(false)
  const [fetchError, setFetchError] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const [rewardsRes, nodesRes] = await Promise.all([
          api.get<{ items: Reward[] }>('/v1/business/rewards'),
          api.get<{ items: Node[] }>('/v1/business/me/nodes'),
        ])
        setRewards(rewardsRes.items ?? [])
        setNodes(nodesRes.items ?? [])
      } catch {
        setFetchError(true)
      }
    }
    void load()
  }, [])

  async function reload() {
    try {
      const res = await api.get<{ items: Reward[] }>('/v1/business/rewards')
      setRewards(res.items ?? [])
    } catch {
      useErrorStore.getState().showError('Couldn\'t refresh rewards. Pull down to try again.')
    }
  }

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
          {nodes.length === 0 ? (
            <p className="text-[var(--warning)] text-sm">
              No nodes found. Create a node in the Node tab before adding rewards.
            </p>
          ) : (
            <>
              <p className="text-[var(--warning)] text-xs mb-3">{t('biz.rewards.slotWarning')}</p>
              <RewardForm
                nodes={nodes}
                onCreated={() => { setShowForm(false); void reload() }}
              />
            </>
          )}
        </div>
      )}

      {fetchError && (
        <p className="text-[var(--danger)] text-sm text-center py-4">
          {t('errors.loadFailed', 'Failed to load rewards.')}
        </p>
      )}

      {!fetchError && rewards.length === 0 && !showForm && (
        <p className="text-[var(--text-muted)] text-sm text-center py-8">
          No rewards yet. Tap + to create your first Get.
        </p>
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

function RewardForm({ nodes, onCreated }: { nodes: Node[]; onCreated: () => void }) {
  const [nodeId, setNodeId] = useState(nodes[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [type, setType] = useState('nth_checkin')
  const [triggerValue, setTriggerValue] = useState('')
  const [slots, setSlots] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!nodeId) { setError('Select a node first.'); return }
    if (!title.trim()) { setError('Enter a reward title.'); return }
    setLoading(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { nodeId, title: title.trim(), type }
      if (triggerValue) body['triggerValue'] = parseInt(triggerValue, 10)
      if (slots) body['totalSlots'] = parseInt(slots, 10)
      await api.post('/v1/business/rewards', body)
      onCreated()
    } catch (err: unknown) {
      const e = err as { message?: string }
      setError(e.message ?? 'Failed to create reward. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {nodes.length > 1 && (
        <select
          value={nodeId}
          onChange={(e) => setNodeId(e.target.value)}
          className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none appearance-none"
        >
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>{n.name}</option>
          ))}
        </select>
      )}
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
        className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none appearance-none"
      >
        <option value="nth_checkin">Nth Check-in</option>
        <option value="daily_first">Daily First</option>
        <option value="streak">Streak</option>
        <option value="milestone">Milestone</option>
      </select>
      {(type === 'nth_checkin' || type === 'streak' || type === 'milestone') && (
        <input
          type="number"
          value={triggerValue}
          onChange={(e) => setTriggerValue(e.target.value)}
          placeholder={type === 'nth_checkin' ? 'Every N check-ins (e.g. 5)' : 'Trigger count'}
          className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
      )}
      <input
        type="number"
        value={slots}
        onChange={(e) => setSlots(e.target.value)}
        placeholder="Total slots (leave empty for unlimited)"
        className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
      />
      <button
        onClick={() => void handleSubmit()}
        disabled={loading || !title.trim() || !nodeId}
        className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3 text-sm disabled:opacity-50"
      >
        {loading ? '...' : 'Create Reward'}
      </button>
      {error && <p className="text-[var(--danger)] text-xs mt-1">{error}</p>}
    </div>
  )
}
