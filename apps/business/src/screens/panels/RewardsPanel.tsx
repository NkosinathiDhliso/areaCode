import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
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
      // Fail silently on reload
    }
  }

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex flex-row items-center justify-between">
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">{t('biz.panel.rewards')}</h2>
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
                onCreated={() => {
                  setShowForm(false)
                  void reload()
                }}
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

const REWARD_TYPES = [
  {
    value: 'daily_first',
    label: 'First Check-in Bonus',
    emoji: '🥇',
    description: 'Reward the first person to check in each day.',
    example: 'e.g. "Free coffee for first check-in"',
    needsTrigger: false,
  },
  {
    value: 'nth_checkin',
    label: 'Every Nth Visit',
    emoji: '🔁',
    description: 'Reward every Nth check-in at your venue.',
    example: 'e.g. "Every 5th visit gets 10% off"',
    needsTrigger: true,
    triggerLabel: 'Reward every',
    triggerSuffix: 'check-ins',
    triggerPlaceholder: '5',
  },
  {
    value: 'milestone',
    label: 'Loyalty Milestone',
    emoji: '🏆',
    description: "Reward customers who've visited a set number of times total.",
    example: 'e.g. "10th visit = free meal"',
    needsTrigger: true,
    triggerLabel: 'Unlock after',
    triggerSuffix: 'total visits',
    triggerPlaceholder: '10',
  },
  {
    value: 'streak',
    label: 'Check-in Streak',
    emoji: '🔥',
    description: 'Reward customers who check in on consecutive days.',
    example: 'e.g. "3-day streak = free dessert"',
    needsTrigger: true,
    triggerLabel: 'Streak length',
    triggerSuffix: 'days in a row',
    triggerPlaceholder: '3',
  },
] as const

type RewardTypeValue = (typeof REWARD_TYPES)[number]['value']

function RewardForm({ nodes, onCreated }: { nodes: Node[]; onCreated: () => void }) {
  const [step, setStep] = useState<'type' | 'details'>('type')
  const [nodeId, setNodeId] = useState(nodes[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [type, setType] = useState<RewardTypeValue>('nth_checkin')
  const [triggerValue, setTriggerValue] = useState('')
  const [slots, setSlots] = useState('')
  const [unlimited, setUnlimited] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = REWARD_TYPES.find((r) => r.value === type)!

  async function handleSubmit() {
    if (!nodeId) {
      setError('Select a node first.')
      return
    }
    if (!title.trim()) {
      setError('Enter a reward title.')
      return
    }
    if (selected.needsTrigger && (!triggerValue || parseInt(triggerValue, 10) < 1)) {
      setError('Enter a valid trigger number.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { nodeId, title: title.trim(), type }
      if (selected.needsTrigger && triggerValue) body['triggerValue'] = parseInt(triggerValue, 10)
      if (!unlimited && slots) body['totalSlots'] = parseInt(slots, 10)
      await api.post('/v1/business/rewards', body)
      onCreated()
    } catch (err: unknown) {
      const e = err as { message?: string }
      setError(e.message ?? 'Failed to create reward. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'type') {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[var(--text-secondary)] text-sm font-medium">What kind of reward is this?</p>
        {REWARD_TYPES.map((rt) => (
          <button
            key={rt.value}
            onClick={() => {
              setType(rt.value)
              setStep('details')
            }}
            className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl p-4 flex items-start gap-3 text-left hover:border-[var(--accent)] transition-colors active:scale-[0.98]"
          >
            <span className="text-2xl leading-none mt-0.5">{rt.emoji}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[var(--text-primary)] text-sm font-semibold">{rt.label}</p>
              <p className="text-[var(--text-secondary)] text-xs mt-0.5">{rt.description}</p>
              <p className="text-[var(--text-muted)] text-xs mt-1 italic">{rt.example}</p>
            </div>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={() => setStep('type')}
        className="flex items-center gap-1.5 text-[var(--accent)] text-sm font-medium"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
        {selected.emoji} {selected.label}
      </button>

      {nodes.length > 1 && (
        <div className="flex flex-col gap-1">
          <label className="text-[var(--text-secondary)] text-xs font-medium">Venue</label>
          <select
            value={nodeId}
            onChange={(e) => setNodeId(e.target.value)}
            className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none appearance-none"
          >
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-[var(--text-secondary)] text-xs font-medium">Reward name</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={selected.example.replace('e.g. ', '').replace(/"/g, '')}
          className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
        />
      </div>

      {selected.needsTrigger && (
        <div className="flex flex-col gap-1">
          <label className="text-[var(--text-secondary)] text-xs font-medium">{selected.triggerLabel}</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              value={triggerValue}
              onChange={(e) => setTriggerValue(e.target.value)}
              placeholder={selected.triggerPlaceholder}
              className="w-24 bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
            />
            <span className="text-[var(--text-secondary)] text-sm">{selected.triggerSuffix}</span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label className="text-[var(--text-secondary)] text-xs font-medium">Available slots</label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={unlimited}
            onChange={(e) => setUnlimited(e.target.checked)}
            className="accent-[var(--accent)] w-4 h-4"
          />
          <span className="text-[var(--text-primary)] text-sm">Unlimited</span>
        </label>
        {!unlimited && (
          <input
            type="number"
            min="1"
            value={slots}
            onChange={(e) => setSlots(e.target.value)}
            placeholder="e.g. 50"
            className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
          />
        )}
        {!unlimited && (
          <p className="text-[var(--warning)] text-xs">
            Slot count cannot be raised once live. Set a realistic number.
          </p>
        )}
      </div>

      {error && <p className="text-[var(--danger)] text-xs">{error}</p>}

      <button
        onClick={() => void handleSubmit()}
        disabled={loading || !title.trim() || !nodeId}
        className="bg-[var(--accent)] text-white font-semibold rounded-xl py-3 text-sm disabled:opacity-50"
      >
        {loading ? 'Creating…' : 'Create Reward'}
      </button>
    </div>
  )
}
