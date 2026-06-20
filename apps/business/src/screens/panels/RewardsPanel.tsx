import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import { useBusinessStore } from '@area-code/shared/stores/businessStore'
import { useErrorStore } from '@area-code/shared/stores/errorStore'
import type { GetCategory, GetLifecycle, Node, Reward } from '@area-code/shared/types'
import { formatRelativeTime } from '@area-code/shared/lib/formatters'

const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function isEventOrOffer(category?: GetCategory): boolean {
  return category === 'event' || category === 'offer'
}

function LifecycleBadge({ lifecycle }: { lifecycle: GetLifecycle }) {
  const styles: Record<GetLifecycle, string> = {
    upcoming: 'bg-[var(--bg-raised)] text-[var(--text-secondary)] border border-[var(--border)]',
    live: 'bg-[var(--success)] text-white',
    ended: 'bg-[var(--bg-raised)] text-[var(--text-muted)] border border-[var(--border)]',
  }
  const labels: Record<GetLifecycle, string> = {
    upcoming: 'Upcoming',
    live: 'Live',
    ended: 'Ended',
  }
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${styles[lifecycle]}`}>
      {labels[lifecycle]}
    </span>
  )
}

/**
 * Non-blocking prompt that links a `live`/`upcoming` event/offer get to the
 * existing boost purchase flow (R6.4). It only NAVIGATES the operator to the
 * boost panel via the same `useBusinessStore.setPanel` mechanism the dashboard
 * nav uses — it never POSTs to `/v1/business/boost` and never auto-purchases or
 * auto-applies a boost (R5.5, R6.4). The copy points to the PAID boost and adds
 * no implication of free city-wide promotion (R6.5).
 *
 * NOTE: R6.4 says to suppress this prompt when the node already has an active
 * boost. No active-boost signal (e.g. `boostedUntil`/`activeBoost`/`isBoosted`)
 * is exposed to this surface today — the `Node` type carries no boost state and
 * the only boost data reachable here is the historical `BoosterPurchase` list
 * (`GET /v1/business/{businessId}/boost-purchases`), which has no live-status
 * field. Inventing a new backend boost-status endpoint is out of scope for this
 * task, so we fall back to the safe default of R6.4: always prompt for
 * `live`/`upcoming` event/offer gets. Once a node-level active-boost signal is
 * exposed, gate the render on it here.
 */
function BoostPromptBanner() {
  const setPanel = useBusinessStore((s) => s.setPanel)
  return (
    <div className="mt-3 flex flex-row items-center justify-between gap-3 bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-4 py-3">
      <span className="text-[var(--text-secondary)] text-xs flex-1">Boost this so people across the city see it</span>
      <button
        type="button"
        onClick={() => setPanel('boost')}
        className="flex-shrink-0 bg-[var(--accent)] text-white text-xs font-semibold rounded-lg px-3 py-1.5"
      >
        Boost
      </button>
    </div>
  )
}

export function RewardsPanel() {
  const { t } = useTranslation()
  const [rewards, setRewards] = useState<Reward[]>([])
  const [nodes, setNodes] = useState<Node[]>([])
  const [showForm, setShowForm] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

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
      useErrorStore.getState().showError("Couldn't refresh rewards. Try again.")
    }
  }

  async function handleToggleActive(reward: Reward) {
    try {
      await api.put(`/v1/business/rewards/${reward.id}`, { isActive: !reward.isActive })
      await reload()
    } catch {
      useErrorStore.getState().showError('Failed to update reward status.')
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
        <p className="text-[var(--text-muted)] text-sm text-center py-8">No rewards yet. Create your first Get.</p>
      )}

      <div className="flex flex-col gap-3">
        {rewards.map((r) => (
          <div key={r.id} className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
            {editingId === r.id ? (
              <RewardEditForm
                reward={r}
                onSaved={() => {
                  setEditingId(null)
                  void reload()
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <>
                <div className="flex flex-row items-center justify-between mb-1">
                  <span className="text-[var(--text-primary)] font-medium">{r.title}</span>
                  <div className="flex items-center gap-2">
                    {isEventOrOffer(r.getCategory) && r.lifecycle && <LifecycleBadge lifecycle={r.lifecycle} />}
                    <button
                      onClick={() => setEditingId(r.id)}
                      className="text-[var(--accent)] text-xs font-medium"
                      aria-label="Edit reward"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void handleToggleActive(r)}
                      className={`text-xs font-medium ${r.isActive ? 'text-[var(--danger)]' : 'text-[var(--success)]'}`}
                      aria-label={r.isActive ? 'Deactivate reward' : 'Activate reward'}
                    >
                      {r.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
                <div className="text-[var(--text-secondary)] text-xs">
                  {r.claimedCount}/{r.totalSlots ?? '∞'} claimed
                  {r.expiresAt && ` · Expires ${formatRelativeTime(r.expiresAt)}`}
                </div>
                <div className="mt-1">
                  <span className={`text-xs ${r.isActive ? 'text-[var(--success)]' : 'text-[var(--text-muted)]'}`}>
                    {r.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                {isEventOrOffer(r.getCategory) && (r.lifecycle === 'live' || r.lifecycle === 'upcoming') && (
                  <BoostPromptBanner />
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function RewardEditForm({ reward, onSaved, onCancel }: { reward: Reward; onSaved: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState(reward.title)
  const [slots, setSlots] = useState(reward.totalSlots != null ? String(reward.totalSlots) : '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { title: title.trim() }
      if (slots) body['totalSlots'] = parseInt(slots, 10)
      await api.put(`/v1/business/rewards/${reward.id}`, body)
      onSaved()
    } catch (err: unknown) {
      const e = err as { message?: string }
      setError(e.message ?? 'Failed to update reward.')
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
      <input
        type="number"
        value={slots}
        onChange={(e) => setSlots(e.target.value)}
        placeholder="Total slots (leave empty for unlimited)"
        className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
      />
      <div className="flex flex-row gap-2">
        <button
          onClick={onCancel}
          className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm"
        >
          Cancel
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={loading || !title.trim()}
          className="flex-1 bg-[var(--accent)] text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50"
        >
          {loading ? '...' : 'Save'}
        </button>
      </div>
      {error && <p className="text-[var(--danger)] text-xs">{error}</p>}
    </div>
  )
}

function RewardForm({ nodes, onCreated }: { nodes: Node[]; onCreated: () => void }) {
  const [nodeId, setNodeId] = useState(nodes[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [getCategory, setGetCategory] = useState<GetCategory>('loyalty')
  const [type, setType] = useState('nth_checkin')
  const [triggerValue, setTriggerValue] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [claimRequiresCheckIn, setClaimRequiresCheckIn] = useState(true)
  const [slots, setSlots] = useState('')
  const [isFirstGet, setIsFirstGet] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const eventOrOffer = isEventOrOffer(getCategory)

  function validateWindow(): string | null {
    if (!startsAt || !endsAt) {
      return 'Both start and end times are required.'
    }
    const startMs = new Date(startsAt).getTime()
    const endMs = new Date(endsAt).getTime()
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      return 'Enter valid start and end times.'
    }
    if (startMs >= endMs) {
      return 'Start time must be before end time.'
    }
    if (endMs - startMs > MAX_WINDOW_MS) {
      return 'The window cannot be longer than 30 days.'
    }
    return null
  }

  async function handleSubmit() {
    if (!nodeId) {
      setError('Select a node first.')
      return
    }
    if (!title.trim()) {
      setError('Enter a reward title.')
      return
    }
    if (eventOrOffer) {
      const windowError = validateWindow()
      if (windowError) {
        setError(windowError)
        return
      }
    }
    setLoading(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { nodeId, title: title.trim() }
      if (eventOrOffer) {
        body['getCategory'] = getCategory
        body['startsAt'] = new Date(startsAt).toISOString()
        body['endsAt'] = new Date(endsAt).toISOString()
        body['claimRequiresCheckIn'] = claimRequiresCheckIn
      } else {
        body['type'] = type
        if (triggerValue) body['triggerValue'] = parseInt(triggerValue, 10)
      }
      if (isFirstGet) body['isFirstGet'] = true
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
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      )}
      <select
        value={getCategory}
        onChange={(e) => setGetCategory(e.target.value as GetCategory)}
        aria-label="Get category"
        className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none appearance-none"
      >
        <option value="loyalty">Loyalty reward</option>
        <option value="event">Event</option>
        <option value="offer">Offer</option>
      </select>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Reward title"
        className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
      />
      {!eventOrOffer && (
        <>
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
            <>
              <input
                type="number"
                value={triggerValue}
                onChange={(e) => setTriggerValue(e.target.value)}
                placeholder={type === 'nth_checkin' ? 'Every N check-ins (e.g. 5)' : 'Trigger count'}
                className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
              />
              <p className="text-[var(--text-muted)] text-[11px] -mt-1">
                Existing customers stay on their original visit count. Only new customers see the new threshold.
              </p>
            </>
          )}
        </>
      )}
      {eventOrOffer && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-[var(--text-secondary)] text-[11px]">Starts at</span>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              aria-label="Starts at"
              className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[var(--text-secondary)] text-[11px]">Ends at</span>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              aria-label="Ends at"
              className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
          <label className="flex flex-row items-start gap-3 bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={claimRequiresCheckIn}
              onChange={(e) => setClaimRequiresCheckIn(e.target.checked)}
              className="mt-0.5"
            />
            <span className="flex-1">
              <span className="block text-[var(--text-primary)] text-sm font-medium">Require check-in to claim</span>
              <span className="block text-[var(--text-muted)] text-[11px] mt-0.5">
                Customers claim this by checking in at your venue while it's live, which builds your node's pulse.
              </span>
            </span>
          </label>
        </>
      )}
      <input
        type="number"
        value={slots}
        onChange={(e) => setSlots(e.target.value)}
        placeholder="Total slots (leave empty for unlimited)"
        className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-3 text-sm placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
      />
      <label className="flex flex-row items-start gap-3 bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-4 py-3 cursor-pointer">
        <input
          type="checkbox"
          checked={isFirstGet}
          onChange={(e) => setIsFirstGet(e.target.checked)}
          className="mt-0.5"
        />
        <span className="flex-1">
          <span className="block text-[var(--text-primary)] text-sm font-medium">Make this the venue's First-Get</span>
          <span className="block text-[var(--text-muted)] text-[11px] mt-0.5">
            Walk-ins without an account can claim this once with their phone number, no signup required. Only one
            First-Get allowed per venue.
          </span>
        </span>
      </label>
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
