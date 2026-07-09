import { getTierLabel } from '@area-code/shared/constants/tier-levels'
import { api, type ApiError } from '@area-code/shared/lib/api'
import { useBusinessStore } from '@area-code/shared/stores/businessStore'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/* ------------------------------------------------------------------ */
/*  Types matching backend campaigns feature (features/campaigns)     */
/* ------------------------------------------------------------------ */

type Segment = 'lapsed' | 'first_timers' | 'regulars' | 'all_past_visitors'
type Channel = 'push' | 'email'
type CampaignStatus = 'draft' | 'sending' | 'sent' | 'cancelled' | 'failed'

interface CampaignSummary {
  campaignId: string
  status: CampaignStatus
  segment: Segment
  title: string
  channels: Channel[]
  createdAt: string
  sentAt?: string
  recipients: number
  delivered: number
  attributedReturnVisits: number
}

interface Campaign {
  campaignId: string
  status: CampaignStatus
  segment: Segment
}

interface RecipientEstimate {
  segmentSize: number
  afterConsentFilter: number
  estimatedRecipients: number
  truncated: boolean
}

interface ListResponse {
  items: CampaignSummary[]
  nextCursor?: string
}

interface BusinessProfile {
  tier?: 'starter' | 'growth' | 'pro' | 'payg' | 'free'
}

interface RewardItem {
  id: string
  title: string
}

const SEGMENTS: { value: Segment; label: string; hint: string }[] = [
  { value: 'lapsed', label: 'Lapsed visitors', hint: 'Visited before but not recently' },
  { value: 'first_timers', label: 'First-timers', hint: 'Checked in exactly once' },
  // The `regulars` segment resolves to the `regular` rank or higher, so its
  // label tracks the one rank-label source (getTierLabel) and never shows a
  // retired rank name.
  { value: 'regulars', label: `${getTierLabel('regular')}s`, hint: 'Your loyal crowd' },
  { value: 'all_past_visitors', label: 'All past visitors', hint: 'Everyone who has checked in' },
]

const TIER_CAN_SEND = (tier: BusinessProfile['tier']): boolean => tier === 'growth' || tier === 'pro'

function statusColor(status: CampaignStatus): string {
  if (status === 'sent') return 'var(--success, #22c55e)'
  if (status === 'sending') return 'var(--accent)'
  if (status === 'failed') return 'var(--danger, #ef4444)'
  return 'var(--text-muted)'
}

/* ------------------------------------------------------------------ */
/*  Main panel                                                        */
/* ------------------------------------------------------------------ */

export function CampaignsPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const nodes = useBusinessStore((s) => s.nodes)
  const prefill = useBusinessStore((s) => s.campaignPrefill)
  const setCampaignPrefill = useBusinessStore((s) => s.setCampaignPrefill)
  const [composing, setComposing] = useState(false)

  // Open the composer automatically when arriving via the report one-tap CTA.
  useEffect(() => {
    if (prefill) setComposing(true)
  }, [prefill])

  const { data: profile } = useQuery({
    queryKey: ['business', 'me'],
    queryFn: () => api.get<BusinessProfile>('/v1/business/me'),
    staleTime: 60_000,
  })
  const canSend = TIER_CAN_SEND(profile?.tier)

  const {
    data: list,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['business', 'campaigns'],
    queryFn: () => api.get<ListResponse>('/v1/business/me/campaigns'),
    staleTime: 30_000,
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['business', 'campaigns'] })
  }

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex flex-row items-center justify-between gap-2">
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">{t('biz.panel.campaigns')}</h2>
        {!composing && (
          <button
            onClick={() => setComposing(true)}
            className="bg-[var(--accent)] text-white font-semibold rounded-xl px-4 py-2 text-sm transition-all active:scale-95"
          >
            New campaign
          </button>
        )}
      </div>

      {!canSend && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4">
          <p className="text-[var(--text-primary)] text-sm font-medium">Win-back campaigns are a Growth feature</p>
          <p className="text-[var(--text-secondary)] text-xs mt-1">
            You can compose and preview reach now. Upgrade to Growth or Pro to send.
          </p>
        </div>
      )}

      {composing && (
        <CampaignComposer
          nodes={nodes}
          canSend={canSend}
          prefill={prefill}
          onConsumePrefill={() => setCampaignPrefill(null)}
          onClose={() => {
            setComposing(false)
            setCampaignPrefill(null)
          }}
          onSent={() => {
            setComposing(false)
            setCampaignPrefill(null)
            refresh()
          }}
        />
      )}

      {/* History */}
      {isLoading && <p className="text-[var(--text-muted)] text-sm">Loading campaigns…</p>}
      {error && <p className="text-[var(--danger)] text-sm">Couldn&apos;t load campaigns. Please try again.</p>}
      {list && list.items.length === 0 && !composing && (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <p className="text-[var(--text-muted)] text-sm text-center max-w-[280px]">
            No campaigns yet. Reach lapsed visitors with a reason to come back.
          </p>
        </div>
      )}
      {list && list.items.length > 0 && (
        <div className="flex flex-col gap-2">
          {list.items.map((c) => (
            <CampaignRow key={c.campaignId} campaign={c} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  History row                                                       */
/* ------------------------------------------------------------------ */

function CampaignRow({ campaign }: { campaign: CampaignSummary }) {
  const segmentLabel = SEGMENTS.find((s) => s.value === campaign.segment)?.label ?? campaign.segment
  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-2">
      <div className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[var(--text-primary)] text-sm font-medium truncate">{campaign.title}</p>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">
            {segmentLabel} · {campaign.channels.join(' + ')}
          </p>
        </div>
        <span
          className="text-[10px] px-2 py-0.5 rounded-full capitalize flex-shrink-0"
          style={{ color: statusColor(campaign.status), background: 'var(--bg-raised)' }}
        >
          {campaign.status}
        </span>
      </div>
      {(campaign.status === 'sent' || campaign.status === 'sending') && (
        <div className="grid grid-cols-3 gap-2 pt-1">
          <Metric label="Recipients" value={campaign.recipients} />
          <Metric label="Delivered" value={campaign.delivered} />
          <Metric label="Return visits" value={campaign.attributedReturnVisits} />
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center bg-[var(--bg-raised)] rounded-xl py-2">
      <span className="text-[var(--text-primary)] text-base font-bold font-[Syne]">{value}</span>
      <span className="text-[var(--text-muted)] text-[10px]">{label}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Composer                                                          */
/* ------------------------------------------------------------------ */

interface ComposerProps {
  nodes: { id: string; name: string }[]
  canSend: boolean
  prefill: ReturnType<typeof useBusinessStore.getState>['campaignPrefill']
  onConsumePrefill: () => void
  onClose: () => void
  onSent: () => void
}

function CampaignComposer({ nodes, canSend, prefill, onConsumePrefill, onClose, onSent }: ComposerProps) {
  const [segment, setSegment] = useState<Segment>(prefill?.segment ?? 'lapsed')
  const [lapsedWindowDays, setLapsedWindowDays] = useState(21)
  const [title, setTitle] = useState(prefill?.title ?? '')
  const [body, setBody] = useState(prefill?.body ?? '')
  const [channels, setChannels] = useState<Channel[]>(['push', 'email'])
  const [selectedNodes, setSelectedNodes] = useState<string[]>(
    prefill?.nodeIds && prefill.nodeIds.length > 0 ? prefill.nodeIds : nodes.map((n) => n.id),
  )
  const [rewardId, setRewardId] = useState<string>('')

  const [draft, setDraft] = useState<Campaign | null>(null)
  const [estimate, setEstimate] = useState<RecipientEstimate | null>(null)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const reportId = prefill?.reportId

  // Consume the prefill once it has seeded local state.
  useEffect(() => {
    if (prefill) onConsumePrefill()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { data: rewards } = useQuery({
    queryKey: ['business', 'rewards'],
    queryFn: () => api.get<{ items: RewardItem[] }>('/v1/business/rewards').then((r) => r.items ?? []),
    staleTime: 60_000,
  })

  const canReview = useMemo(
    () => title.trim().length > 0 && body.trim().length > 0 && channels.length > 0 && selectedNodes.length > 0,
    [title, body, channels, selectedNodes],
  )

  function toggleChannel(ch: Channel) {
    setChannels((prev) => (prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]))
  }

  function toggleNode(id: string) {
    setSelectedNodes((prev) => (prev.includes(id) ? prev.filter((n) => n !== id) : [...prev, id]))
  }

  async function handleReview() {
    if (!canReview || busy) return
    setBusy(true)
    setErrorMsg(null)
    try {
      const created = await api.post<Campaign>('/v1/business/me/campaigns', {
        segment,
        title: title.trim(),
        body: body.trim(),
        channels,
        nodeIds: selectedNodes,
        ...(segment === 'lapsed' ? { lapsedWindowDays } : {}),
        ...(rewardId ? { rewardId } : {}),
        ...(reportId ? { reportId } : {}),
      })
      setDraft(created)
      const est = await api.post<RecipientEstimate>(`/v1/business/me/campaigns/${created.campaignId}/estimate`)
      setEstimate(est)
    } catch (err) {
      setErrorMsg((err as ApiError)?.message ?? 'Could not prepare the campaign. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSend() {
    if (!draft || busy) return
    setBusy(true)
    setErrorMsg(null)
    try {
      await api.post(`/v1/business/me/campaigns/${draft.campaignId}/send`, {})
      onSent()
    } catch (err) {
      const e = err as ApiError
      if (e?.statusCode === 402) {
        setErrorMsg('Sending is a Growth feature. Upgrade your plan to send this campaign.')
      } else {
        setErrorMsg(e?.message ?? 'Could not send the campaign. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleDiscard() {
    if (draft) {
      try {
        await api.post(`/v1/business/me/campaigns/${draft.campaignId}/cancel`, {})
      } catch {
        /* draft will expire via TTL even if cancel fails */
      }
    }
    onClose()
  }

  const inputCls =
    'w-full bg-[var(--bg-base)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none'

  // Step 2: review + send
  if (draft && estimate) {
    return (
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-4">
        <h3 className="text-[var(--text-primary)] font-semibold text-sm">Review reach</h3>
        <div className="grid grid-cols-3 gap-2">
          <Metric label="In segment" value={estimate.segmentSize} />
          <Metric label="Consented" value={estimate.afterConsentFilter} />
          <Metric label="Will receive" value={estimate.estimatedRecipients} />
        </div>
        {estimate.truncated && (
          <p className="text-[var(--text-muted)] text-xs">
            Large audience: the estimate is based on a recent sample of check-ins.
          </p>
        )}
        {estimate.estimatedRecipients === 0 && (
          <p className="text-[var(--text-secondary)] text-xs">
            No eligible recipients right now (after consent and frequency limits). Try a wider segment.
          </p>
        )}
        {errorMsg && <p className="text-[var(--danger)] text-xs">{errorMsg}</p>}
        <div className="flex flex-row gap-2">
          <button
            onClick={handleDiscard}
            disabled={busy}
            className="flex-1 border border-[var(--border)] text-[var(--text-secondary)] rounded-xl py-2.5 text-sm disabled:opacity-50"
          >
            Discard
          </button>
          <button
            onClick={handleSend}
            disabled={busy || !canSend || estimate.estimatedRecipients === 0}
            className="flex-1 bg-[var(--accent)] text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 transition-all active:scale-95"
          >
            {busy ? 'Sending…' : canSend ? 'Send now' : 'Upgrade to send'}
          </button>
        </div>
      </div>
    )
  }

  // Step 1: compose
  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-4">
      <div className="flex flex-row items-center justify-between">
        <h3 className="text-[var(--text-primary)] font-semibold text-sm">New win-back campaign</h3>
        <button onClick={onClose} className="text-[var(--text-muted)] text-xs">
          Cancel
        </button>
      </div>

      {/* Segment */}
      <div className="flex flex-col gap-2">
        <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">Audience</label>
        <div className="grid grid-cols-2 gap-2">
          {SEGMENTS.map((s) => (
            <button
              key={s.value}
              onClick={() => setSegment(s.value)}
              className={`text-left rounded-xl px-3 py-2 border transition-all ${
                segment === s.value
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                  : 'border-[var(--border)] bg-[var(--bg-base)]'
              }`}
            >
              <p className="text-[var(--text-primary)] text-sm font-medium">{s.label}</p>
              <p className="text-[var(--text-muted)] text-[10px] mt-0.5">{s.hint}</p>
            </button>
          ))}
        </div>
        {segment === 'lapsed' && (
          <label className="flex flex-row items-center justify-between text-xs text-[var(--text-secondary)] mt-1">
            <span>Lapsed after (days)</span>
            <input
              type="number"
              min={7}
              max={90}
              value={lapsedWindowDays}
              onChange={(e) => setLapsedWindowDays(Math.min(90, Math.max(7, Number(e.target.value) || 21)))}
              className="w-20 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg px-2 py-1 text-right text-[var(--text-primary)]"
            />
          </label>
        )}
      </div>

      {/* Message */}
      <div className="flex flex-col gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          placeholder="Title (e.g. We miss you)"
          className={inputCls}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="Message (e.g. Come back this week for a free drink on us)"
          className={inputCls}
        />
      </div>

      {/* Channels */}
      <div className="flex flex-col gap-2">
        <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">Channels</label>
        <div className="flex flex-row gap-2">
          {(['push', 'email'] as Channel[]).map((ch) => (
            <button
              key={ch}
              onClick={() => toggleChannel(ch)}
              className={`flex-1 rounded-xl py-2 text-sm capitalize border transition-all ${
                channels.includes(ch)
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text-primary)]'
                  : 'border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-muted)]'
              }`}
            >
              {ch}
            </button>
          ))}
        </div>
      </div>

      {/* Venues */}
      {nodes.length > 1 && (
        <div className="flex flex-col gap-2">
          <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">Venues</label>
          <div className="flex flex-wrap gap-2">
            {nodes.map((n) => (
              <button
                key={n.id}
                onClick={() => toggleNode(n.id)}
                className={`rounded-full px-3 py-1 text-xs border transition-all ${
                  selectedNodes.includes(n.id)
                    ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text-primary)]'
                    : 'border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-muted)]'
                }`}
              >
                {n.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Optional reward */}
      {rewards && rewards.length > 0 && (
        <div className="flex flex-col gap-2">
          <label className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">
            Attach a get (optional)
          </label>
          <select value={rewardId} onChange={(e) => setRewardId(e.target.value)} className={inputCls}>
            <option value="">No get</option>
            {rewards.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {errorMsg && <p className="text-[var(--danger)] text-xs">{errorMsg}</p>}

      <button
        onClick={handleReview}
        disabled={!canReview || busy}
        className="bg-[var(--accent)] text-white font-semibold rounded-xl py-2.5 text-sm disabled:opacity-50 transition-all active:scale-95"
      >
        {busy ? 'Preparing…' : 'Review reach'}
      </button>
    </div>
  )
}
