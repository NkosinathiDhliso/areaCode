import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import { formatZAR } from '@area-code/shared/lib/formatters'
import { useBusinessStore } from '@area-code/shared/stores/businessStore'
import type { Node } from '@area-code/shared/types'

interface BoostPricing {
  '2hr': number
  '6hr': number
  '24hr': number
}

const BOOST_OPTIONS: { duration: '2hr' | '6hr' | '24hr'; label: string; desc: string }[] = [
  { duration: '2hr', label: '2 Hours', desc: 'Quick burst — ideal for a lunch special or happy hour.' },
  { duration: '6hr', label: '6 Hours', desc: 'Half-day visibility — perfect for an evening event.' },
  { duration: '24hr', label: '24 Hours', desc: 'Full-day spotlight — great for launches or big nights.' },
]

function getBoostStatus(node: Node): { active: boolean; label: string } {
  if (!node.boostUntil) return { active: false, label: '' }
  const remaining = new Date(node.boostUntil).getTime() - Date.now()
  if (remaining <= 0) return { active: false, label: '' }
  const hrs = Math.floor(remaining / 3600000)
  const mins = Math.floor((remaining % 3600000) / 60000)
  const label = hrs > 0 ? `${hrs}h ${mins}m remaining` : `${mins}m remaining`
  return { active: true, label }
}

export function BoostPanel() {
  const { t } = useTranslation()
  const [pricing, setPricing] = useState<BoostPricing | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const nodes = useBusinessStore((s) => s.nodes)
  const [selectedNodeId, setSelectedNodeId] = useState<string>('')

  useEffect(() => {
    if (nodes.length > 0 && !selectedNodeId) {
      setSelectedNodeId(nodes[0]?.id ?? '')
    }
  }, [nodes, selectedNodeId])

  useEffect(() => {
    async function load() {
      try {
        const res = await api.get<{ boost: BoostPricing }>('/v1/business/plans')
        setPricing(res.boost)
      } catch {
        setError(t('biz.boost.loadError', 'Failed to load boost pricing. Please refresh.'))
      }
    }
    void load()
  }, [t])

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null
  const boostStatus = selectedNode ? getBoostStatus(selectedNode) : null

  async function handleBoost(duration: '2hr' | '6hr' | '24hr') {
    if (!selectedNodeId) {
      setError(t('biz.boost.noNode', 'No node found. Please create a node first.'))
      return
    }
    setLoading(duration)
    setError(null)
    try {
      const res = await api.post<{ checkoutUrl: string }>('/v1/business/boost', {
        nodeId: selectedNodeId,
        duration,
      })
      window.location.href = res.checkoutUrl
    } catch {
      setError(t('biz.boost.error', 'Failed to start boost. Please try again.'))
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="p-5 flex flex-col gap-5">
      <div>
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne] mb-1">
          {t('biz.boost.title', 'Boost Node')}
        </h2>
        <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
          Boosting makes your venue's marker more visible on the map — it appears larger and glows with a gold ring.
          Boosted nodes are also shown as at least "active" even during quiet hours, keeping you on people's radar.
          Pulse score still reflects real check-ins; boosting just raises the floor so you don't disappear.
        </p>
      </div>

      {nodes.length === 0 ? (
        <p className="text-[var(--warning)] text-sm">No nodes found. Create a node in the Node tab before boosting.</p>
      ) : (
        <>
          {nodes.length > 1 && (
            <div className="flex flex-col gap-1">
              <label className="text-[var(--text-secondary)] text-xs font-medium">Select venue to boost</label>
              <select
                value={selectedNodeId}
                onChange={(e) => setSelectedNodeId(e.target.value)}
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

          {boostStatus?.active && (
            <div className="bg-[var(--bg-raised)] border border-[var(--color-boost-gold)]/40 rounded-2xl px-4 py-3 flex items-center gap-3">
              <span className="text-xl">⚡</span>
              <div>
                <p className="text-[var(--text-primary)] text-sm font-medium">Boost active</p>
                <p className="text-[var(--text-secondary)] text-xs mt-0.5">{boostStatus.label}</p>
              </div>
            </div>
          )}

          {pricing && (
            <div className="flex flex-col gap-3">
              {BOOST_OPTIONS.map(({ duration, label, desc }) => (
                <button
                  key={duration}
                  onClick={() => void handleBoost(duration)}
                  disabled={loading !== null || boostStatus?.active}
                  className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-row items-start justify-between gap-3 text-left hover:border-[var(--accent)] transition-colors active:scale-[0.98] disabled:opacity-50"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[var(--text-primary)] font-semibold text-sm">{label}</p>
                    <p className="text-[var(--text-secondary)] text-xs mt-0.5">{desc}</p>
                  </div>
                  <span className="text-[var(--accent)] font-bold text-sm whitespace-nowrap shrink-0 mt-0.5">
                    {loading === duration ? '…' : formatZAR(pricing[duration] / 100)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {boostStatus?.active && (
            <p className="text-[var(--text-muted)] text-xs text-center">
              A boost is already active. You can stack a new one once this one expires.
            </p>
          )}
        </>
      )}

      {error && <p className="text-[var(--danger)] text-xs">{error}</p>}
    </div>
  )
}
